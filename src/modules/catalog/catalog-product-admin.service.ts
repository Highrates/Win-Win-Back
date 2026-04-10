import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CuratedCollectionKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductSearchIndexService } from '../../meilisearch/product-search-index.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  CreateProductAdminDto,
  ProductGalleryItemDto,
  ProductMaterialOptionShellDto,
  UpdateProductShellAdminDto,
} from './dto/catalog-admin.dto';
import { CatalogVariantAdminService } from './catalog-variant-admin.service';
import { CatalogVariantPricingService } from './catalog-variant-pricing.service';
import { slugifyProductBase } from './slug-transliteration';
import { buildCategoryPathLabel } from './catalog-category-path';

@Injectable()
export class CatalogProductAdminService {
  private readonly logger = new Logger(CatalogProductAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly productSearchIndex: ProductSearchIndexService,
    private readonly variantAdmin: CatalogVariantAdminService,
    private readonly variantPricing: CatalogVariantPricingService,
  ) {}

  private async ensureUniqueProductSlug(base: string): Promise<string> {
    let slug = base.slice(0, 80) || 'product';
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? slug : `${slug}-${n}`;
      const exists = await this.prisma.product.findUnique({ where: { slug: candidate } });
      if (!exists) return candidate;
      n += 1;
    }
  }

  private async ensureUniqueProductSlugExcept(base: string, excludeProductId: string): Promise<string> {
    let slug = base.slice(0, 80) || 'product';
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? slug : `${slug}-${n}`;
      const exists = await this.prisma.product.findFirst({
        where: { slug: candidate, NOT: { id: excludeProductId } },
      });
      if (!exists) return candidate;
      n += 1;
    }
  }

  private normProductShortDescription(raw: string | null | undefined): string | null {
    const t = raw?.trim() ?? '';
    return t || null;
  }

  private validateProductMediaAndActiveRules(dto: CreateProductAdminDto): void {
    for (const g of dto.gallery ?? []) {
      const u = g.url?.trim();
      if (u) this.objectStorage.assertProductImageUrlAllowed(u);
    }
    for (const c of dto.colors ?? []) {
      const u = c.imageUrl?.trim();
      if (u) this.objectStorage.assertProductImageUrlAllowed(u);
    }
    const m3d = dto.model3dUrl?.trim();
    if (m3d) this.objectStorage.assertProductImageUrlAllowed(m3d);
    const dw = dto.drawingUrl?.trim();
    if (dw) this.objectStorage.assertProductImageUrlAllowed(dw);
    const galleryCount = (dto.gallery ?? []).filter((g) => g.url?.trim()).length;
    const isActive = dto.isActive ?? true;
    if (isActive && galleryCount < 1) {
      throw new BadRequestException(
        'Активный товар должен иметь хотя бы одно изображение в галерее (или снимите «В каталоге»).',
      );
    }
  }

  private normalizeAdditionalCategoryIds(primaryId: string, raw?: string[] | null): string[] {
    const seen = new Set<string>();
    for (const id of raw ?? []) {
      const t = typeof id === 'string' ? id.trim() : '';
      if (!t || t === primaryId) continue;
      seen.add(t);
    }
    return [...seen];
  }

  private async assertAdditionalCategoriesExist(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const n = await this.prisma.category.count({ where: { id: { in: ids } } });
    if (n !== ids.length) {
      throw new BadRequestException('Одна из дополнительных категорий не найдена');
    }
  }

  private dedupeIdList(raw?: string[] | null): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of raw ?? []) {
      const t = typeof id === 'string' ? id.trim() : '';
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  private async syncProductCuratedCollections(
    tx: Prisma.TransactionClient,
    productId: string,
    rawIds: string[] | undefined,
  ): Promise<void> {
    const desired = this.dedupeIdList(rawIds);
    if (desired.length) {
      const cols = await tx.curatedCollection.findMany({
        where: { id: { in: desired } },
        select: { id: true, kind: true },
      });
      if (cols.length !== desired.length) {
        throw new BadRequestException('Одна из коллекций не найдена');
      }
      for (const c of cols) {
        if (c.kind !== CuratedCollectionKind.PRODUCT) {
          throw new BadRequestException('В коллекцию с типом «бренды» нельзя добавить товар');
        }
      }
    }
    const current = await tx.curatedCollectionProductItem.findMany({
      where: { productId },
      select: { id: true, collectionId: true },
    });
    const desiredSet = new Set(desired);
    for (const row of current) {
      if (!desiredSet.has(row.collectionId)) {
        await tx.curatedCollectionProductItem.delete({ where: { id: row.id } });
      }
    }
    const have = new Set(current.map((r) => r.collectionId));
    for (const collectionId of desired) {
      if (have.has(collectionId)) continue;
      const agg = await tx.curatedCollectionProductItem.aggregate({
        where: { collectionId },
        _max: { sortOrder: true },
      });
      const sortOrder = (agg._max.sortOrder ?? -1) + 1;
      await tx.curatedCollectionProductItem.create({
        data: { collectionId, productId, sortOrder },
      });
    }
  }

  private async syncProductCuratedSets(
    tx: Prisma.TransactionClient,
    productId: string,
    rawIds: string[] | undefined,
  ): Promise<void> {
    const desired = this.dedupeIdList(rawIds);
    if (desired.length) {
      const n = await tx.curatedProductSet.count({ where: { id: { in: desired } } });
      if (n !== desired.length) {
        throw new BadRequestException('Один из наборов не найден');
      }
    }
    const current = await tx.curatedProductSetItem.findMany({
      where: { productId },
      select: { id: true, setId: true },
    });
    const desiredSet = new Set(desired);
    for (const row of current) {
      if (!desiredSet.has(row.setId)) {
        await tx.curatedProductSetItem.delete({ where: { id: row.id } });
      }
    }
    const have = new Set(current.map((r) => r.setId));
    for (const setId of desired) {
      if (have.has(setId)) continue;
      const agg = await tx.curatedProductSetItem.aggregate({
        where: { setId },
        _max: { sortOrder: true },
      });
      const sortOrder = (agg._max.sortOrder ?? -1) + 1;
      await tx.curatedProductSetItem.create({
        data: { setId, productId, sortOrder },
      });
    }
  }

  private async syncProductGallery(tx: Prisma.TransactionClient, productId: string, gallery: ProductGalleryItemDto[]) {
    const existing = await tx.productImage.findMany({ where: { productId } });
    const existingById = new Map<string, { id: string }>(
      existing.map((r: { id: string }) => [r.id, r]),
    );
    const idsToKeep = new Set<string>();

    let sortIdx = 0;
    for (const g of gallery) {
      const url = g.url.trim();
      if (!url) continue;
      const alt = g.alt?.trim() || null;
      if (g.id && existingById.has(g.id)) {
        await tx.productImage.update({
          where: { id: g.id },
          data: { url, alt, sortOrder: sortIdx },
        });
        idsToKeep.add(g.id);
      } else {
        const created = await tx.productImage.create({
          data: { productId, url, alt, sortOrder: sortIdx },
        });
        idsToKeep.add(created.id);
      }
      sortIdx++;
    }
    const toDelete = existing.filter((r: { id: string }) => !idsToKeep.has(r.id));
    if (toDelete.length) {
      const delIds = toDelete.map((r: { id: string }) => r.id);
      await tx.productVariantProductImage.deleteMany({
        where: { productImageId: { in: delIds } },
      });
      await tx.productImage.deleteMany({ where: { id: { in: delIds } } });
    }
  }

  private async syncMaterialColorOptions(
    tx: Prisma.TransactionClient,
    productId: string,
    rows: ProductMaterialOptionShellDto[],
  ) {
    const keptMatIds: string[] = [];

    for (const m of rows) {
      const name = m.name.trim();
      if (!name) throw new BadRequestException('У материала должно быть название');

      let matId: string;
      if (m.id) {
        const existingMat = await tx.productMaterialOption.findFirst({
          where: { id: m.id, productId },
        });
        if (existingMat) {
          await tx.productMaterialOption.update({
            where: { id: m.id },
            data: { name, sortOrder: m.sortOrder },
          });
          matId = m.id;
        } else {
          const created = await tx.productMaterialOption.create({
            data: { productId, name, sortOrder: m.sortOrder },
          });
          matId = created.id;
        }
      } else {
        const created = await tx.productMaterialOption.create({
          data: { productId, name, sortOrder: m.sortOrder },
        });
        matId = created.id;
      }
      keptMatIds.push(matId);

      const keptColorIds: string[] = [];
      for (const c of m.colors ?? []) {
        const cn = c.name?.trim();
        const imageUrl = c.imageUrl?.trim();
        if (!cn || !imageUrl) continue;
        this.objectStorage.assertProductImageUrlAllowed(imageUrl);

        if (c.id) {
          const col = await tx.productColorOption.findFirst({
            where: { id: c.id, materialOptionId: matId },
          });
          if (col) {
            await tx.productColorOption.update({
              where: { id: c.id },
              data: { name: cn, imageUrl, sortOrder: c.sortOrder },
            });
            keptColorIds.push(c.id);
          } else {
            const created = await tx.productColorOption.create({
              data: { materialOptionId: matId, name: cn, imageUrl, sortOrder: c.sortOrder },
            });
            keptColorIds.push(created.id);
          }
        } else {
          const created = await tx.productColorOption.create({
            data: { materialOptionId: matId, name: cn, imageUrl, sortOrder: c.sortOrder },
          });
          keptColorIds.push(created.id);
        }
      }

      await tx.productColorOption.deleteMany({
        where: {
          materialOptionId: matId,
          ...(keptColorIds.length ? { id: { notIn: keptColorIds } } : {}),
        },
      });
    }

    if (keptMatIds.length) {
      await tx.productMaterialOption.deleteMany({
        where: { productId, id: { notIn: keptMatIds } },
      });
    } else {
      await tx.productMaterialOption.deleteMany({ where: { productId } });
    }
  }

  async listProductsForAdmin(q?: string) {
    const trim = q?.trim();
    const where: Prisma.ProductWhereInput = trim
      ? {
          OR: [
            { name: { contains: trim, mode: 'insensitive' } },
            { slug: { contains: trim, mode: 'insensitive' } },
          ],
        }
      : {};
    const [rows, cats] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          isActive: true,
          category: { select: { id: true, name: true } },
          productCategories: { select: { categoryId: true } },
          images: {
            take: 1,
            orderBy: { sortOrder: 'asc' },
            select: { url: true },
          },
          variants: {
            where: { isDefault: true },
            take: 1,
            select: {
              price: true,
              currency: true,
              images: {
                take: 1,
                orderBy: { sortOrder: 'asc' },
                select: { url: true },
              },
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
      }),
      this.prisma.category.findMany({
        select: { id: true, name: true, parentId: true },
      }),
    ]);
    const byId = new Map(cats.map((c) => [c.id, { name: c.name, parentId: c.parentId }]));
    return rows.map((r) => {
      const dv = r.variants[0];
      const thumbUrl = r.images[0]?.url ?? dv?.images[0]?.url ?? null;
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        price: dv?.price.toString() ?? '0',
        currency: dv?.currency ?? 'RUB',
        isActive: r.isActive,
        category: r.category,
        categoryPath: buildCategoryPathLabel(r.category.id, byId),
        additionalCategoryCount: r.productCategories.length,
        thumbUrl,
      };
    });
  }

  async deleteProducts(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    const deleted: string[] = [];
    const skipped: string[] = [];
    const imageUrlsToRemoveFromStorage: string[] = [];
    for (const id of unique) {
      const row = await this.prisma.product.findUnique({
        where: { id },
        include: {
          _count: { select: { orderItems: true } },
          images: { select: { url: true } },
        },
      });
      if (!row) {
        skipped.push(id);
        continue;
      }
      if (row._count.orderItems > 0) {
        skipped.push(id);
        continue;
      }
      try {
        await this.prisma.product.delete({ where: { id } });
        deleted.push(id);
        for (const im of row.images) {
          if (im.url?.trim()) imageUrlsToRemoveFromStorage.push(im.url.trim());
        }
      } catch {
        skipped.push(id);
      }
    }
    if (deleted.length) void this.productSearchIndex.removeProducts(deleted);
    if (imageUrlsToRemoveFromStorage.length) {
      void this.objectStorage
        .deleteStorageObjectsForRemovedUrls(imageUrlsToRemoveFromStorage)
        .catch((e) =>
          this.logger.warn(
            `Очистка S3 после удаления товаров: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
    }
    return { deleted, skipped };
  }

  async createProduct(dto: CreateProductAdminDto) {
    const brandIdNorm =
      dto.brandId != null && String(dto.brandId).trim() !== '' ? String(dto.brandId).trim() : null;

    const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new BadRequestException('Категория не найдена');
    if (brandIdNorm) {
      const brand = await this.prisma.brand.findUnique({ where: { id: brandIdNorm } });
      if (!brand) throw new BadRequestException('Бренд не найден');
    }

    const baseSlug = dto.slug?.trim() ? dto.slug.trim() : slugifyProductBase(dto.name);
    const slug = await this.ensureUniqueProductSlug(baseSlug);

    const skuRaw = dto.sku?.trim();
    const sku = skuRaw || null;
    if (sku) {
      const taken = await this.prisma.productVariant.findUnique({ where: { sku } });
      if (taken) throw new ConflictException('SKU уже занят');
    }

    this.validateProductMediaAndActiveRules(dto);

    const additionalCatIds = this.normalizeAdditionalCategoryIds(
      dto.categoryId,
      dto.additionalCategoryIds,
    );
    await this.assertAdditionalCategoriesExist(additionalCatIds);

    const gallery = dto.gallery ?? [];
    const useMaterialColorShell = dto.materialColorOptions !== undefined;

    const colors = (dto.colors ?? []).filter((c) => c.name?.trim() && c.imageUrl?.trim());
    const materials = (dto.materials ?? []).filter((m) => m.name?.trim());
    const sizes = (dto.sizes ?? []).filter((s) => s.value?.trim());
    const labels = [...new Set((dto.labels ?? []).map((l) => l.trim()).filter(Boolean))].slice(0, 40);

    const specsJson: Prisma.InputJsonValue = useMaterialColorShell
      ? { colors: [], materials: [], sizes: [], labels: [] }
      : {
          colors: colors.map((c) => ({ name: c.name.trim(), imageUrl: c.imageUrl.trim() })),
          materials: materials.map((m) => ({ name: m.name.trim() })),
          sizes: sizes.map((s) => ({ value: s.value.trim() })),
          labels,
        };

    const agg = await this.prisma.product.aggregate({
      where: { categoryId: dto.categoryId },
      _max: { sortOrder: true },
    });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;

    const currency = (dto.currency?.trim().toUpperCase() || 'RUB').slice(0, 8);

    const priceNum = dto.price ?? 0;
    const priceBlock = await this.variantPricing.resolveVariantPriceForWrite(
      {
        price: priceNum,
        priceMode: dto.priceMode === 'formula' ? 'formula' : 'manual',
        costPriceCny: dto.costPriceCny ?? null,
        weightKg: dto.weightKg ?? null,
        volumeLiters: dto.volumeLiters ?? null,
      },
      [dto.categoryId, ...additionalCatIds],
    );

    try {
      const full = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            slug,
            name: dto.name.trim(),
            categoryId: dto.categoryId,
            brandId: brandIdNorm,
            shortDescription: this.normProductShortDescription(dto.shortDescription),
            description: null,
            additionalInfoHtml: dto.additionalInfoHtml?.trim() || null,
            deliveryText: dto.deliveryText?.trim() || null,
            technicalSpecs: dto.technicalSpecs?.trim() || null,
            seoTitle: dto.seoTitle?.trim() || null,
            seoDescription: dto.seoDescription?.trim() || null,
            isActive: dto.isActive ?? true,
            sortOrder,
          },
        });

        const variantSlug = await this.variantAdmin.ensureUniqueVariantSlug(tx, product.id, 'v-0');

        await tx.productVariant.create({
          data: {
            productId: product.id,
            variantSlug,
            sortOrder: 0,
            isDefault: true,
            isActive: true,
            specsJson,
            sku,
            lengthMm: dto.lengthMm ?? null,
            widthMm: dto.widthMm ?? null,
            heightMm: dto.heightMm ?? null,
            volumeLiters: this.variantPricing.normalizeOptionalVolumeM3(dto.volumeLiters),
            weightKg:
              dto.weightKg != null && Number.isFinite(dto.weightKg)
                ? new Prisma.Decimal(dto.weightKg)
                : null,
            netLengthMm: dto.netLengthMm ?? null,
            netWidthMm: dto.netWidthMm ?? null,
            netHeightMm: dto.netHeightMm ?? null,
            netVolumeLiters: this.variantPricing.normalizeOptionalVolumeM3(dto.netVolumeLiters),
            netWeightKg:
              dto.netWeightKg != null && Number.isFinite(dto.netWeightKg)
                ? new Prisma.Decimal(dto.netWeightKg)
                : null,
            priceMode: priceBlock.priceMode,
            costPriceCny: priceBlock.costPriceCny,
            price: priceBlock.price,
            currency,
            model3dUrl: dto.model3dUrl?.trim() || null,
            drawingUrl: dto.drawingUrl?.trim() || null,
          },
        });

        if (additionalCatIds.length) {
          await tx.productCategory.createMany({
            data: additionalCatIds.map((categoryId) => ({
              productId: product.id,
              categoryId,
            })),
          });
        }

        if (gallery.length > 0) {
          await tx.productImage.createMany({
            data: gallery.map((g, i) => ({
              productId: product.id,
              url: g.url.trim(),
              alt: g.alt?.trim() || null,
              sortOrder: i,
            })),
          });
        }

        if (useMaterialColorShell) {
          await this.syncMaterialColorOptions(tx, product.id, dto.materialColorOptions ?? []);
        }

        await this.syncProductCuratedCollections(tx, product.id, dto.curatedCollectionIds ?? []);
        await this.syncProductCuratedSets(tx, product.id, dto.curatedProductSetIds ?? []);

        const created = await tx.product.findUnique({
          where: { id: product.id },
          include: {
            images: { orderBy: { sortOrder: 'asc' } },
            category: true,
            brand: true,
          },
        });
        if (!created) throw new BadRequestException('Не удалось прочитать созданный товар');
        return created;
      });
      void this.productSearchIndex.syncProduct(full.id);
      return full;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          throw new ConflictException('Такой slug или SKU уже существует');
        }
        if (e.code === 'P2003') {
          throw new BadRequestException('Неверная категория или бренд');
        }
        if (e.code === 'P2022') {
          throw new BadRequestException(
            'База данных без новых колонок товара — выполните: npx prisma migrate deploy',
          );
        }
      }
      throw e;
    }
  }

  async getProductForAdmin(id: string) {
    const row = await this.prisma.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        materialOptions: {
          orderBy: { sortOrder: 'asc' },
          include: { colors: { orderBy: { sortOrder: 'asc' } } },
        },
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        productCategories: { select: { categoryId: true } },
        variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!row) throw new NotFoundException('Товар не найден');
    const [colLinks, setLinks] = await Promise.all([
      this.prisma.curatedCollectionProductItem.findMany({
        where: { productId: id },
        select: { collectionId: true },
      }),
      this.prisma.curatedProductSetItem.findMany({
        where: { productId: id },
        select: { setId: true },
      }),
    ]);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      categoryId: row.categoryId,
      additionalCategoryIds: row.productCategories.map((p) => p.categoryId),
      curatedCollectionIds: colLinks.map((r) => r.collectionId),
      curatedProductSetIds: setLinks.map((r) => r.setId),
      brandId: row.brandId,
      shortDescription: row.shortDescription,
      isActive: row.isActive,
      images: row.images.map((i) => ({
        id: i.id,
        url: i.url,
        alt: i.alt,
        sortOrder: i.sortOrder,
      })),
      materialColorOptions: row.materialOptions.map((m) => ({
        id: m.id,
        name: m.name,
        sortOrder: m.sortOrder,
        colors: m.colors.map((c) => ({
          id: c.id,
          name: c.name,
          imageUrl: c.imageUrl,
          sortOrder: c.sortOrder,
        })),
      })),
      additionalInfoHtml: row.additionalInfoHtml,
      deliveryText: row.deliveryText,
      technicalSpecs: row.technicalSpecs,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      category: row.category,
      brand: row.brand,
      variants: row.variants.map((v) => ({
        id: v.id,
        displayName: v.variantLabel?.trim() || row.name,
        price: v.price.toString(),
        currency: v.currency,
        isActive: v.isActive,
        isDefault: v.isDefault,
      })),
    };
  }

  async updateProduct(id: string, dto: UpdateProductShellAdminDto) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Товар не найден');

    const brandIdNorm =
      dto.brandId != null && String(dto.brandId).trim() !== '' ? String(dto.brandId).trim() : null;

    const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new BadRequestException('Категория не найдена');
    if (brandIdNorm) {
      const brand = await this.prisma.brand.findUnique({ where: { id: brandIdNorm } });
      if (!brand) throw new BadRequestException('Бренд не найден');
    }

    let nextSlug = existing.slug;
    const slugTrim = dto.slug?.trim();
    if (slugTrim && slugTrim !== existing.slug) {
      nextSlug = await this.ensureUniqueProductSlugExcept(slugTrim, id);
    }

    this.validateProductMediaAndActiveRules(dto as unknown as CreateProductAdminDto);

    const additionalCatIds = this.normalizeAdditionalCategoryIds(
      dto.categoryId,
      dto.additionalCategoryIds,
    );
    await this.assertAdditionalCategoriesExist(additionalCatIds);

    const prevGalleryUrls = (
      await this.prisma.productImage.findMany({
        where: { productId: id },
        select: { url: true },
      })
    ).map((r) => r.url.trim());
    const newGalleryUrlSet = new Set(
      (dto.gallery ?? []).map((g) => g.url.trim()).filter(Boolean),
    );
    const removedGalleryUrls =
      dto.gallery !== undefined
        ? prevGalleryUrls.filter((u) => !newGalleryUrlSet.has(u))
        : [];

    const data: Prisma.ProductUpdateInput = {
      slug: nextSlug,
      name: dto.name.trim(),
      category: { connect: { id: dto.categoryId } },
      brand: brandIdNorm ? { connect: { id: brandIdNorm } } : { disconnect: true },
      shortDescription: this.normProductShortDescription(dto.shortDescription),
      additionalInfoHtml: dto.additionalInfoHtml?.trim() || null,
      deliveryText: dto.deliveryText?.trim() || null,
      technicalSpecs: dto.technicalSpecs?.trim() || null,
      seoTitle: dto.seoTitle?.trim() || null,
      seoDescription: dto.seoDescription?.trim() || null,
      isActive: dto.isActive ?? true,
    };

    if (dto.categoryId !== existing.categoryId) {
      const agg = await this.prisma.product.aggregate({
        where: { categoryId: dto.categoryId },
        _max: { sortOrder: true },
      });
      data.sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }

    try {
      const full = await this.prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data,
        });

        await tx.productCategory.deleteMany({ where: { productId: id } });
        if (additionalCatIds.length) {
          await tx.productCategory.createMany({
            data: additionalCatIds.map((categoryId) => ({ productId: id, categoryId })),
          });
        }

        if (dto.curatedCollectionIds !== undefined) {
          await this.syncProductCuratedCollections(tx, id, dto.curatedCollectionIds);
        }
        if (dto.curatedProductSetIds !== undefined) {
          await this.syncProductCuratedSets(tx, id, dto.curatedProductSetIds);
        }

        if (dto.gallery !== undefined) {
          await this.syncProductGallery(tx, id, dto.gallery);
        }
        if (dto.materialColorOptions !== undefined) {
          await this.syncMaterialColorOptions(tx, id, dto.materialColorOptions);
        }

        const row = await tx.product.findUnique({
          where: { id },
          include: {
            images: { orderBy: { sortOrder: 'asc' } },
            materialOptions: {
              orderBy: { sortOrder: 'asc' },
              include: { colors: { orderBy: { sortOrder: 'asc' } } },
            },
            category: true,
            brand: true,
            productCategories: { select: { categoryId: true } },
            variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
          },
        });
        if (!row) throw new BadRequestException('Не удалось прочитать товар после сохранения');
        return row;
      });
      void this.productSearchIndex.syncProduct(id);
      if (removedGalleryUrls.length) {
        void this.objectStorage
          .deleteStorageObjectsForRemovedUrls(removedGalleryUrls)
          .catch((e) =>
            this.logger.warn(
              `Очистка S3 после смены галереи: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
      }
      const [colLinks, setLinks] = await Promise.all([
        this.prisma.curatedCollectionProductItem.findMany({
          where: { productId: id },
          select: { collectionId: true },
        }),
        this.prisma.curatedProductSetItem.findMany({
          where: { productId: id },
          select: { setId: true },
        }),
      ]);
      return {
        id: full.id,
        slug: full.slug,
        name: full.name,
        categoryId: full.categoryId,
        additionalCategoryIds: full.productCategories.map((p) => p.categoryId),
        curatedCollectionIds: colLinks.map((r) => r.collectionId),
        curatedProductSetIds: setLinks.map((r) => r.setId),
        brandId: full.brandId,
        shortDescription: full.shortDescription,
        isActive: full.isActive,
        images: full.images.map((i) => ({
          id: i.id,
          url: i.url,
          alt: i.alt,
          sortOrder: i.sortOrder,
        })),
        materialColorOptions: full.materialOptions.map((m) => ({
          id: m.id,
          name: m.name,
          sortOrder: m.sortOrder,
          colors: m.colors.map((c) => ({
            id: c.id,
            name: c.name,
            imageUrl: c.imageUrl,
            sortOrder: c.sortOrder,
          })),
        })),
        additionalInfoHtml: full.additionalInfoHtml,
        deliveryText: full.deliveryText,
        technicalSpecs: full.technicalSpecs,
        seoTitle: full.seoTitle,
        seoDescription: full.seoDescription,
        category: full.category,
        brand: full.brand,
        variants: full.variants.map((v) => ({
          id: v.id,
          displayName: v.variantLabel?.trim() || full.name,
          price: v.price.toString(),
          currency: v.currency,
          isActive: v.isActive,
          isDefault: v.isDefault,
        })),
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          throw new ConflictException('Такой slug уже существует');
        }
        if (e.code === 'P2003') {
          throw new BadRequestException('Неверная категория или бренд');
        }
        if (e.code === 'P2022') {
          throw new BadRequestException(
            'База данных без новых колонок товара — выполните: npx prisma migrate deploy',
          );
        }
      }
      throw e;
    }
  }
}
