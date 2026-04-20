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
import {
  CreateProductVariantAdminDto,
  UpdateProductVariantAdminDto,
  VariantElementSelectionDto,
} from './dto/catalog-admin.dto';
import { CatalogVariantPricingService } from './catalog-variant-pricing.service';
import { slugifyVariantLabel } from './slug-transliteration';

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

  /**
   * Проверяет selection[]: все элементы товара (у которых задан пул материал-цветов) покрыты,
   * и каждый выбранный brandMaterialColorId находится в пуле соответствующего элемента.
   * Элементы без пула (пустые availabilities) — пропускаются: им нечего выбирать.
   */
  private async assertAndNormalizeSelections(
    tx: Prisma.TransactionClient,
    productId: string,
    raw: VariantElementSelectionDto[] | undefined,
  ): Promise<{ productElementId: string; brandMaterialColorId: string }[]> {
    const selections = raw ?? [];
    const elements = await tx.productElement.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      include: { availabilities: { select: { brandMaterialColorId: true } } },
    });
    if (elements.length === 0) {
      if (selections.length) {
        throw new BadRequestException(
          'У товара нет настраиваемых элементов — selections должен быть пустым',
        );
      }
      return [];
    }

    const byId = new Map(elements.map((e) => [e.id, e]));
    const seen = new Set<string>();
    const result: { productElementId: string; brandMaterialColorId: string }[] = [];

    for (const s of selections) {
      const el = byId.get(s.productElementId);
      if (!el) {
        throw new BadRequestException('Один из selection.productElementId не относится к товару');
      }
      if (seen.has(s.productElementId)) {
        throw new BadRequestException('Повтор элемента в selections');
      }
      seen.add(s.productElementId);

      const allowed = new Set(el.availabilities.map((a) => a.brandMaterialColorId));
      if (!allowed.has(s.brandMaterialColorId)) {
        throw new BadRequestException(
          `Выбранный «материал-цвет» недоступен для элемента «${el.name}»`,
        );
      }
      result.push({
        productElementId: s.productElementId,
        brandMaterialColorId: s.brandMaterialColorId,
      });
    }

    const missing = elements.filter(
      (e) => e.availabilities.length > 0 && !seen.has(e.id),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Не задан выбор для элементов: ${missing.map((m) => m.name).join(', ')}`,
      );
    }
    return result;
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

  async getVariantForAdmin(productId: string, variantId: string) {
    const row = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      include: {
        variantProductImages: {
          orderBy: { sortOrder: 'asc' },
          include: { productImage: true },
        },
        modification: { select: { id: true } },
        elementSelections: true,
        product: {
          select: {
            id: true,
            name: true,
            categoryId: true,
            images: { orderBy: { sortOrder: 'asc' } },
            modifications: {
              orderBy: { sortOrder: 'asc' },
              select: { id: true, name: true, modificationSlug: true, sortOrder: true },
            },
            elements: {
              orderBy: { sortOrder: 'asc' },
              include: {
                availabilities: {
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    brandMaterialColor: {
                      select: {
                        id: true,
                        name: true,
                        imageUrl: true,
                        sortOrder: true,
                        brandMaterial: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
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
    return {
      id: row.id,
      productId: row.productId,
      productName: row.product.name,
      variantLabel: row.variantLabel,
      variantSlug: row.variantSlug,
      modificationId: row.modificationId,
      modificationsForProduct: row.product.modifications,
      productElements: row.product.elements.map((el) => ({
        id: el.id,
        name: el.name,
        sortOrder: el.sortOrder,
        availableMaterialColors: el.availabilities.map((a) => ({
          brandMaterialColorId: a.brandMaterialColor.id,
          materialId: a.brandMaterialColor.brandMaterial.id,
          materialName: a.brandMaterialColor.brandMaterial.name,
          colorName: a.brandMaterialColor.name,
          imageUrl: a.brandMaterialColor.imageUrl,
          sortOrder: a.sortOrder,
        })),
      })),
      selections: row.elementSelections.map((s) => ({
        productElementId: s.productElementId,
        brandMaterialColorId: s.brandMaterialColorId,
      })),
      productGalleryImages: row.product.images.map((i) => ({
        id: i.id,
        url: i.url,
        alt: i.alt,
        sortOrder: i.sortOrder,
      })),
      galleryProductImageIds: row.variantProductImages.map((l) => l.productImageId),
      priceMode: row.priceMode === ProductPriceMode.FORMULA ? 'formula' : 'manual',
      costPriceCny: row.costPriceCny?.toString() ?? null,
      price: row.price.toString(),
      currency: row.currency,
      isActive: row.isActive,
      isDefault: row.isDefault,
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

  async createProductVariant(productId: string, dto: CreateProductVariantAdminDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { orderBy: { sortOrder: 'desc' }, take: 1, select: { sortOrder: true } },
      },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    const modification = await this.prisma.productModification.findFirst({
      where: { id: dto.modificationId, productId },
    });
    if (!modification) throw new BadRequestException('Модификация не принадлежит товару');

    const nextSort = (product.variants[0]?.sortOrder ?? -1) + 1;
    const hasAny = await this.prisma.productVariant.count({ where: { productId } });
    const isDefault = hasAny === 0;

    /**
     * При создании варианта можно не передавать selections — тогда для каждого
     * элемента с непустым пулом материал-цветов подставим первый по порядку.
     * Пользователь отредактирует их уже в карточке варианта.
     */
    let selectionsForCreate = dto.selections;
    if (selectionsForCreate === undefined || selectionsForCreate.length === 0) {
      const elements = await this.prisma.productElement.findMany({
        where: { productId },
        orderBy: { sortOrder: 'asc' },
        include: {
          availabilities: {
            orderBy: { sortOrder: 'asc' },
            take: 1,
            select: { brandMaterialColorId: true },
          },
        },
      });
      selectionsForCreate = elements
        .filter((el) => el.availabilities.length > 0)
        .map((el) => ({
          productElementId: el.id,
          brandMaterialColorId: el.availabilities[0]!.brandMaterialColorId,
        }));
    }

    try {
      const v = await this.prisma.$transaction(async (tx) => {
        const selections = await this.assertAndNormalizeSelections(
          tx,
          productId,
          selectionsForCreate,
        );
        const slug = await this.ensureUniqueVariantSlug(tx, productId, `v-${nextSort}`);
        const created = await tx.productVariant.create({
          data: {
            productId,
            modificationId: modification.id,
            variantSlug: slug,
            sortOrder: nextSort,
            isDefault,
            isActive: true,
            price: new Prisma.Decimal(0),
            currency: 'RUB',
            priceMode: ProductPriceMode.MANUAL,
          },
        });
        if (selections.length) {
          await tx.productVariantElementSelection.createMany({
            data: selections.map((s) => ({
              variantId: created.id,
              productElementId: s.productElementId,
              brandMaterialColorId: s.brandMaterialColorId,
            })),
          });
        }
        return created;
      });
      void this.productSearchIndex.syncProduct(productId);
      return { id: v.id };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Slug варианта уже занят');
      }
      throw e;
    }
  }

  async updateProductVariant(
    productId: string,
    variantId: string,
    dto: UpdateProductVariantAdminDto,
  ) {
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

    const mergedForPrice = {
      price: dto.price ?? existing.price.toNumber(),
      priceMode:
        dto.priceMode ??
        (existing.priceMode === ProductPriceMode.FORMULA ? 'formula' : 'manual'),
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

    if (dto.model3dUrl) this.objectStorage.assertProductImageUrlAllowed(dto.model3dUrl.trim());
    if (dto.drawingUrl) this.objectStorage.assertProductImageUrlAllowed(dto.drawingUrl.trim());

    const variantUpdate: Prisma.ProductVariantUpdateInput = {
      priceMode: priceBlock.priceMode,
      costPriceCny: priceBlock.costPriceCny,
      price: priceBlock.price,
      currency,
      sku,
    };

    const nextModificationId =
      dto.modificationId !== undefined && dto.modificationId.trim() !== ''
        ? dto.modificationId.trim()
        : existing.modificationId;

    if (nextModificationId !== existing.modificationId) {
      const ok = await this.prisma.productModification.findFirst({
        where: { id: nextModificationId, productId },
      });
      if (!ok) throw new BadRequestException('Модификация не принадлежит товару');
      variantUpdate.modification = { connect: { id: nextModificationId } };
    }

    if (dto.variantLabel !== undefined) {
      variantUpdate.variantLabel = dto.variantLabel?.trim() || null;
    }
    if (dto.variantSlug !== undefined) {
      variantUpdate.variantSlug = dto.variantSlug?.trim() || null;
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
      variantUpdate.netVolumeLiters = this.variantPricing.normalizeOptionalVolumeM3(
        dto.netVolumeLiters,
      );
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
        await tx.productVariant.update({ where: { id: variantId }, data: variantUpdate });

        if (dto.selections !== undefined) {
          const canonical = await this.assertAndNormalizeSelections(
            tx,
            productId,
            dto.selections,
          );
          await tx.productVariantElementSelection.deleteMany({ where: { variantId } });
          if (canonical.length) {
            await tx.productVariantElementSelection.createMany({
              data: canonical.map((s) => ({
                variantId,
                productElementId: s.productElementId,
                brandMaterialColorId: s.brandMaterialColorId,
              })),
            });
          }
        }

        if (dto.galleryProductImageIds !== undefined) {
          await this.syncVariantProductImages(
            tx,
            productId,
            variantId,
            dto.galleryProductImageIds,
          );
        }
      });
      void this.productSearchIndex.syncProduct(productId);
      return this.getVariantForAdmin(productId, variantId);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('SKU или slug уже занят');
      }
      throw e;
    }
  }

  async deleteProductVariant(productId: string, variantId: string) {
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
}
