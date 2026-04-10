import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductPriceMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductSearchIndexService } from '../../meilisearch/product-search-index.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { UpdateProductVariantAdminDto } from './dto/catalog-admin.dto';
import { CatalogVariantPricingService } from './catalog-variant-pricing.service';
import { slugifyVariantLabel } from './slug-transliteration';
import { assertMaterialColorPairForProduct } from './variant-material-color';

/** Достаточно для ensureUniqueVariantSlug (в т.ч. Prisma.TransactionClient). */
type ProductVariantDelegate = Pick<PrismaService, 'productVariant'>;

@Injectable()
export class CatalogVariantAdminService {
  private readonly logger = new Logger(CatalogVariantAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly productSearchIndex: ProductSearchIndexService,
    private readonly variantPricing: CatalogVariantPricingService,
  ) {}

  async ensureUniqueVariantSlug(
    db: ProductVariantDelegate,
    productId: string,
    base: string,
  ): Promise<string> {
    let s = slugifyVariantLabel(base).slice(0, 80) || 'v';
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? s : `${s}-${n}`;
      const taken = await db.productVariant.findFirst({
        where: { productId, variantSlug: candidate },
      });
      if (!taken) return candidate;
      n++;
    }
  }

  async getVariantForAdmin(productId: string, variantId: string) {
    const row = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        variantProductImages: {
          orderBy: { sortOrder: 'asc' },
          include: { productImage: true },
        },
        product: {
          select: {
            id: true,
            name: true,
            categoryId: true,
            images: { orderBy: { sortOrder: 'asc' } },
            materialOptions: {
              orderBy: { sortOrder: 'asc' },
              include: { colors: { orderBy: { sortOrder: 'asc' } } },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Вариант не найден');
    const addCats = await this.prisma.productCategory.findMany({
      where: { productId },
      select: { categoryId: true },
    });
    const displayName = row.variantLabel?.trim() || row.product.name;
    return {
      id: row.id,
      productId: row.productId,
      productName: row.product.name,
      variantLabel: row.variantLabel,
      variantSlug: row.variantSlug,
      materialOptionId: row.materialOptionId,
      colorOptionId: row.colorOptionId,
      materialColorOptions: row.product.materialOptions.map((m) => ({
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
      productGalleryImages: row.product.images.map((i) => ({
        id: i.id,
        url: i.url,
        alt: i.alt,
        sortOrder: i.sortOrder,
      })),
      galleryProductImageIds: row.variantProductImages.map((l) => l.productImageId),
      displayName,
      optionAttributes: (row.optionAttributes as Record<string, string> | null) ?? null,
      priceMode: row.priceMode === ProductPriceMode.FORMULA ? 'formula' : 'manual',
      costPriceCny: row.costPriceCny?.toString() ?? null,
      price: row.price.toString(),
      currency: row.currency,
      isActive: row.isActive,
      isDefault: row.isDefault,
      images: row.images.map((i) => ({
        url: i.url,
        alt: i.alt,
        sortOrder: i.sortOrder,
      })),
      specsJson: row.specsJson,
      sku: row.sku,
      lengthMm: row.lengthMm,
      widthMm: row.widthMm,
      heightMm: row.heightMm,
      volumeLiters: row.volumeLiters?.toString() ?? null,
      weightKg: row.weightKg?.toString() ?? null,
      netLengthMm: row.netLengthMm,
      netWidthMm: row.netWidthMm,
      netHeightMm: row.netHeightMm,
      netVolumeLiters: row.netVolumeLiters?.toString() ?? null,
      netWeightKg: row.netWeightKg?.toString() ?? null,
      model3dUrl: row.model3dUrl,
      drawingUrl: row.drawingUrl,
      categoryIdForPricing: row.product.categoryId,
      additionalCategoryIds: addCats.map((c) => c.categoryId),
    };
  }

  async updateProductVariant(productId: string, variantId: string, dto: UpdateProductVariantAdminDto) {
    const existing = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      include: {
        product: {
          select: {
            categoryId: true,
            productCategories: { select: { categoryId: true } },
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('Вариант не найден');

    const additionalCatIds = [
      ...new Set([
        existing.product.categoryId,
        ...existing.product.productCategories.map((c) => c.categoryId),
      ]),
    ];

    const skuRaw = dto.sku?.trim();
    const sku = skuRaw === undefined ? existing.sku : skuRaw || null;
    if (sku !== existing.sku && sku) {
      const taken = await this.prisma.productVariant.findFirst({
        where: { sku, NOT: { id: variantId } },
      });
      if (taken) throw new ConflictException('SKU уже занят');
    }

    if (dto.variantSlug !== undefined) {
      const raw = dto.variantSlug?.trim();
      if (raw) {
        const dup = await this.prisma.productVariant.findFirst({
          where: { productId, variantSlug: raw, NOT: { id: variantId } },
        });
        if (dup) throw new ConflictException('Slug варианта уже занят');
      }
    }

    const colors = (dto.colors ?? []).filter((c) => c.name?.trim() && c.imageUrl?.trim());
    const materials = (dto.materials ?? []).filter((m) => m.name?.trim());
    const sizes = (dto.sizes ?? []).filter((s) => s.value?.trim());
    const labels = [...new Set((dto.labels ?? []).map((l) => l.trim()).filter(Boolean))].slice(0, 40);

    const specsJson: Prisma.InputJsonValue | undefined =
      dto.colors !== undefined ||
      dto.materials !== undefined ||
      dto.sizes !== undefined ||
      dto.labels !== undefined
        ? {
            colors: colors.map((c) => ({ name: c.name.trim(), imageUrl: c.imageUrl.trim() })),
            materials: materials.map((m) => ({ name: m.name.trim() })),
            sizes: sizes.map((s) => ({ value: s.value.trim() })),
            labels,
          }
        : undefined;

    const mergedForPrice = {
      price: dto.price ?? existing.price.toNumber(),
      priceMode: dto.priceMode ?? (existing.priceMode === ProductPriceMode.FORMULA ? 'formula' : 'manual'),
      costPriceCny:
        dto.costPriceCny !== undefined
          ? dto.costPriceCny
          : existing.costPriceCny?.toNumber() ?? null,
      weightKg:
        dto.weightKg !== undefined ? dto.weightKg : existing.weightKg?.toNumber() ?? null,
      volumeLiters:
        dto.volumeLiters !== undefined
          ? dto.volumeLiters
          : existing.volumeLiters?.toNumber() ?? null,
    };

    const priceBlock = await this.variantPricing.resolveVariantPriceForWrite(
      mergedForPrice,
      additionalCatIds,
    );

    const currency = (dto.currency?.trim().toUpperCase() || existing.currency || 'RUB').slice(0, 8);

    const gallery = dto.gallery ?? [];

    for (const g of gallery) {
      const u = g.url?.trim();
      if (u) this.objectStorage.assertProductImageUrlAllowed(u);
    }
    for (const c of dto.colors ?? []) {
      const u = c.imageUrl?.trim();
      if (u) this.objectStorage.assertProductImageUrlAllowed(u);
    }
    if (dto.model3dUrl !== undefined) {
      const u = dto.model3dUrl?.trim();
      if (u) this.objectStorage.assertProductImageUrlAllowed(u);
    }
    if (dto.drawingUrl !== undefined) {
      const u = dto.drawingUrl?.trim();
      if (u) this.objectStorage.assertProductImageUrlAllowed(u);
    }

    const prevVImgs = (
      await this.prisma.productVariantImage.findMany({
        where: { variantId },
        select: { url: true },
      })
    ).map((r) => r.url.trim());
    const newVSet = new Set(gallery.map((g) => g.url.trim()).filter(Boolean));
    const removedV =
      dto.galleryProductImageIds !== undefined
        ? prevVImgs
        : dto.gallery !== undefined
          ? prevVImgs.filter((u) => !newVSet.has(u))
          : [];

    const variantUpdate: Prisma.ProductVariantUpdateInput = {
      priceMode: priceBlock.priceMode,
      costPriceCny: priceBlock.costPriceCny,
      price: priceBlock.price,
      currency,
      sku,
    };

    const nextMatId =
      dto.materialOptionId !== undefined
        ? (dto.materialOptionId?.trim() || null)
        : existing.materialOptionId;
    const nextColId =
      dto.colorOptionId !== undefined
        ? (dto.colorOptionId?.trim() || null)
        : existing.colorOptionId;

    if (dto.materialOptionId !== undefined || dto.colorOptionId !== undefined) {
      if ((nextMatId && !nextColId) || (!nextMatId && nextColId)) {
        throw new BadRequestException('Укажите материал и цвет вместе или очистите оба');
      }
      if (nextMatId && nextColId) {
        const { materialName, colorName } = await assertMaterialColorPairForProduct(
          this.prisma,
          productId,
          nextMatId,
          nextColId,
        );
        variantUpdate.materialOption = { connect: { id: nextMatId } };
        variantUpdate.colorOption = { connect: { id: nextColId } };
        if (dto.optionAttributes === undefined) {
          variantUpdate.optionAttributes = { material: materialName, color: colorName };
        }
      } else {
        variantUpdate.materialOption = { disconnect: true };
        variantUpdate.colorOption = { disconnect: true };
      }
    }

    if (dto.optionAttributes !== undefined) {
      variantUpdate.optionAttributes = dto.optionAttributes as Prisma.InputJsonValue;
    }
    if (dto.variantLabel !== undefined) {
      variantUpdate.variantLabel = dto.variantLabel?.trim() || null;
    }
    if (dto.variantSlug !== undefined) {
      variantUpdate.variantSlug = dto.variantSlug?.trim() || null;
    }
    if (specsJson !== undefined) {
      variantUpdate.specsJson = specsJson;
    }
    if (dto.lengthMm !== undefined) variantUpdate.lengthMm = dto.lengthMm;
    if (dto.widthMm !== undefined) variantUpdate.widthMm = dto.widthMm;
    if (dto.heightMm !== undefined) variantUpdate.heightMm = dto.heightMm;
    if (dto.volumeLiters !== undefined) {
      variantUpdate.volumeLiters = this.variantPricing.normalizeOptionalVolumeM3(dto.volumeLiters);
    }
    if (dto.weightKg !== undefined) {
      variantUpdate.weightKg =
        dto.weightKg != null && Number.isFinite(dto.weightKg)
          ? new Prisma.Decimal(dto.weightKg)
          : null;
    }
    if (dto.netLengthMm !== undefined) variantUpdate.netLengthMm = dto.netLengthMm;
    if (dto.netWidthMm !== undefined) variantUpdate.netWidthMm = dto.netWidthMm;
    if (dto.netHeightMm !== undefined) variantUpdate.netHeightMm = dto.netHeightMm;
    if (dto.netVolumeLiters !== undefined) {
      variantUpdate.netVolumeLiters = this.variantPricing.normalizeOptionalVolumeM3(dto.netVolumeLiters);
    }
    if (dto.netWeightKg !== undefined) {
      variantUpdate.netWeightKg =
        dto.netWeightKg != null && Number.isFinite(dto.netWeightKg)
          ? new Prisma.Decimal(dto.netWeightKg)
          : null;
    }
    if (dto.isActive !== undefined) variantUpdate.isActive = dto.isActive;
    if (dto.model3dUrl !== undefined) {
      const u = dto.model3dUrl?.trim();
      variantUpdate.model3dUrl = u || null;
    }
    if (dto.drawingUrl !== undefined) {
      const u = dto.drawingUrl?.trim();
      variantUpdate.drawingUrl = u || null;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.productVariant.update({
          where: { id: variantId },
          data: variantUpdate,
        });

        if (dto.galleryProductImageIds !== undefined) {
          await this.syncVariantProductImages(tx, productId, variantId, dto.galleryProductImageIds);
          await tx.productVariantImage.deleteMany({ where: { variantId } });
        } else if (dto.gallery !== undefined) {
          await tx.productVariantImage.deleteMany({ where: { variantId } });
          if (gallery.length > 0) {
            await tx.productVariantImage.createMany({
              data: gallery.map((g, i) => ({
                variantId,
                url: g.url.trim(),
                alt: g.alt?.trim() || null,
                sortOrder: i,
              })),
            });
          }
        }
      });
      void this.productSearchIndex.syncProduct(productId);
      if (removedV.length) {
        void this.objectStorage
          .deleteStorageObjectsForRemovedUrls(removedV)
          .catch((e) =>
            this.logger.warn(
              `Очистка S3 после смены галереи варианта: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
      }
      return this.getVariantForAdmin(productId, variantId);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('SKU уже занят');
      }
      throw e;
    }
  }

  async createProductVariant(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { orderBy: { sortOrder: 'desc' }, take: 1 },
      },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    const base = await this.prisma.productVariant.findFirst({
      where: { productId, isDefault: true },
    });
    if (!base) throw new BadRequestException('Нет базового варианта');
    const nextSort = (product.variants[0]?.sortOrder ?? 0) + 1;
    const variantSlug = await this.ensureUniqueVariantSlug(this.prisma, productId, `v-${nextSort}`);
    const v = await this.prisma.productVariant.create({
      data: {
        productId,
        variantSlug,
        sortOrder: nextSort,
        isDefault: false,
        isActive: true,
        specsJson: base.specsJson === null ? Prisma.JsonNull : base.specsJson,
        sku: null,
        lengthMm: base.lengthMm,
        widthMm: base.widthMm,
        heightMm: base.heightMm,
        volumeLiters: base.volumeLiters,
        weightKg: base.weightKg,
        netLengthMm: base.netLengthMm,
        netWidthMm: base.netWidthMm,
        netHeightMm: base.netHeightMm,
        netVolumeLiters: base.netVolumeLiters,
        netWeightKg: base.netWeightKg,
        priceMode: base.priceMode,
        costPriceCny: base.costPriceCny,
        price: base.price,
        currency: base.currency,
        model3dUrl: base.model3dUrl,
        drawingUrl: base.drawingUrl,
        optionAttributes: Prisma.JsonNull,
      },
    });
    void this.productSearchIndex.syncProduct(productId);
    return { id: v.id };
  }

  async deleteProductVariant(productId: string, variantId: string) {
    const count = await this.prisma.productVariant.count({ where: { productId } });
    if (count <= 1) {
      throw new BadRequestException('Нельзя удалить единственный вариант');
    }
    const row = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });
    if (!row) throw new NotFoundException('Вариант не найден');
    await this.prisma.productVariant.delete({ where: { id: variantId } });
    if (row.isDefault) {
      const first = await this.prisma.productVariant.findFirst({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
      });
      if (first) {
        await this.prisma.productVariant.update({
          where: { id: first.id },
          data: { isDefault: true },
        });
      }
    }
    void this.productSearchIndex.syncProduct(productId);
    return { ok: true as const };
  }

  async syncVariantProductImages(
    tx: Prisma.TransactionClient,
    productId: string,
    variantId: string,
    productImageIds: string[],
  ) {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const id of productImageIds) {
      if (seen.has(id)) {
        throw new BadRequestException('Повторы кадров в списке галереи варианта');
      }
      seen.add(id);
      unique.push(id);
    }
    const rows = await tx.productImage.findMany({
      where: { productId, id: { in: unique } },
    });
    if (rows.length !== unique.length) {
      throw new BadRequestException('Один из кадров не принадлежит товару');
    }
    await tx.productVariantProductImage.deleteMany({ where: { variantId } });
    if (unique.length) {
      await tx.productVariantProductImage.createMany({
        data: unique.map((productImageId, i) => ({
          variantId,
          productImageId,
          sortOrder: i,
        })),
      });
    }
  }
}
