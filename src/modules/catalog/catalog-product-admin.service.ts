import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CuratedCollectionKind, Prisma, ProductPriceMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { adminListResult, parseAdminListQuery } from '../../common/admin-list-pagination';
import { ProductSearchIndexService } from '../../meilisearch/product-search-index.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  CreateProductAdminDto,
  ProductGalleryItemDto,
  UpdateProductShellAdminDto,
} from './dto/catalog-admin.dto';
import { CatalogVariantAdminService } from './catalog-variant-admin.service';
import { slugifyProductBase } from './slug-transliteration';
import { buildCategoryPathLabel } from './catalog-category-path';
import { priceToNumber } from '../../meilisearch/product-search-doc';

function parseProductVisibilityFilter(raw?: string): boolean | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v || v === 'all') return undefined;
  if (v === 'catalog' || v === 'active' || v === 'published' || v === 'true' || v === '1') {
    return true;
  }
  if (v === 'hidden' || v === 'inactive' || v === 'false' || v === '0') {
    return false;
  }
  return undefined;
}

export const PRODUCT_ADMIN_HYGIENE_KEYS = [
  'no_modifications',
  'no_variants',
  'active_empty',
  'element_empty_pool',
  'composite_incomplete',
] as const;

export type ProductAdminHygieneKey = (typeof PRODUCT_ADMIN_HYGIENE_KEYS)[number];

export type AdminProductListQueryFilters = {
  brandId?: string;
  categoryId?: string;
  tagId?: string;
  collectionId?: string;
  productSetId?: string;
  hygiene?: string;
};

export type DashboardCatalogSummary = {
  noModifications: number;
  noVariants: number;
  activeEmpty: number;
  elementEmptyPool: number;
  compositeIncomplete: number;
};

export function parseProductAdminHygieneFilter(raw?: string): ProductAdminHygieneKey | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  return (PRODUCT_ADMIN_HYGIENE_KEYS as readonly string[]).includes(v)
    ? (v as ProductAdminHygieneKey)
    : undefined;
}

/** Критерии «дыр» в модификациях / элементах для списка и дашборда.
 * Базовые бакеты (no_modifications / no_variants / element_empty_pool / composite_incomplete)
 * взаимно исключают друг друга. `active_empty` — rollup «опубликован и пустой» (пересекается
 * с no_modifications / no_variants / composite по задумке фильтра списка). */
export function productAdminHygieneWhere(key: ProductAdminHygieneKey): Prisma.ProductWhereInput {
  switch (key) {
    case 'no_modifications':
      return { modifications: { none: {} } };
    case 'no_variants':
      // Простой товар: моды есть, вариантов нет, элементов нет (составные → composite_*).
      return {
        AND: [
          { modifications: { some: {} } },
          { variants: { none: {} } },
          { elements: { none: {} } },
        ],
      };
    case 'active_empty':
      // Витрина с дырой: в каталоге и (нет модов или нет вариантов). Rollup для списка.
      return {
        isActive: true,
        OR: [
          { modifications: { none: {} } },
          {
            AND: [{ modifications: { some: {} } }, { variants: { none: {} } }],
          },
        ],
      };
    case 'element_empty_pool':
      return { elements: { some: { availabilities: { none: {} } } } };
    case 'composite_incomplete':
      // Есть элементы, нет вариантов; дыры пула — только в element_empty_pool.
      return {
        AND: [
          { elements: { some: {} } },
          { variants: { none: {} } },
          { NOT: { elements: { some: { availabilities: { none: {} } } } } },
        ],
      };
  }
}

/** Цена для колонки списка: min среди вариантов с price > 0 (как на витрине), не только isDefault. */
export function pickAdminListPrice(variants: {
  price: { toString(): string };
  currency: string;
  isActive: boolean;
}[]): { price: string; currency: string } {
  const withNums = variants.map((v) => ({
    price: v.price.toString(),
    currency: v.currency,
    isActive: v.isActive,
    n: priceToNumber(v.price),
  }));
  const positiveActive = withNums.filter((v) => v.isActive && v.n > 0);
  const positiveAny = withNums.filter((v) => v.n > 0);
  const pool = positiveActive.length ? positiveActive : positiveAny;
  if (!pool.length) {
    const fb = withNums[0];
    return { price: fb?.price ?? '0', currency: fb?.currency ?? 'RUB' };
  }
  pool.sort((a, b) => a.n - b.n);
  const min = pool[0]!;
  return { price: min.price, currency: min.currency || 'RUB' };
}

function buildProductAdminListWhere(
  q?: string,
  visibility?: string,
  filters: AdminProductListQueryFilters = {},
): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];
  const trim = q?.trim();
  if (trim) {
    and.push({
      OR: [
        { name: { contains: trim, mode: 'insensitive' } },
        { slug: { contains: trim, mode: 'insensitive' } },
        {
          variants: {
            some: { sku: { contains: trim, mode: 'insensitive' } },
          },
        },
      ],
    });
  }

  const visibilityFilter = parseProductVisibilityFilter(visibility);
  if (visibilityFilter !== undefined) {
    and.push({ isActive: visibilityFilter });
  }

  const brandRaw = filters.brandId?.trim();
  if (brandRaw) {
    if (brandRaw === '_none') {
      and.push({ brandId: null });
    } else {
      and.push({ brandId: brandRaw });
    }
  }

  const categoryId = filters.categoryId?.trim();
  if (categoryId) {
    and.push({
      OR: [
        { categoryId },
        { productCategories: { some: { categoryId } } },
      ],
    });
  }

  const tagId = filters.tagId?.trim();
  if (tagId) {
    and.push({ catalogTags: { some: { tagId } } });
  }

  const collectionId = filters.collectionId?.trim();
  if (collectionId) {
    and.push({
      curatedCollectionProductItems: { some: { collectionId } },
    });
  }

  const productSetId = filters.productSetId?.trim();
  if (productSetId) {
    and.push({
      curatedProductSetItems: { some: { setId: productSetId } },
    });
  }

  const hygiene = parseProductAdminHygieneFilter(filters.hygiene);
  if (hygiene) {
    and.push(productAdminHygieneWhere(hygiene));
  }

  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

@Injectable()
export class CatalogProductAdminService {
  private readonly logger = new Logger(CatalogProductAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly productSearchIndex: ProductSearchIndexService,
    private readonly variantAdmin: CatalogVariantAdminService,
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

  private validateProductMediaAndActiveRules(dto: CreateProductAdminDto | UpdateProductShellAdminDto): void {
    for (const g of dto.gallery ?? []) {
      const u = g.url?.trim();
      if (u) this.objectStorage.assertProductImageUrlAllowed(u);
    }
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

  private async syncProductCatalogTags(
    tx: Prisma.TransactionClient,
    productId: string,
    rawIds: string[] | undefined,
  ): Promise<void> {
    if (rawIds === undefined) return;
    const desired = this.dedupeIdList(rawIds);
    if (desired.length) {
      const n = await tx.catalogTag.count({ where: { id: { in: desired } } });
      if (n !== desired.length) {
        throw new BadRequestException('Один из тегов контекста не найден');
      }
    }
    await tx.productCatalogTag.deleteMany({ where: { productId } });
    if (desired.length) {
      await tx.productCatalogTag.createMany({
        data: desired.map((tagId) => ({ productId, tagId })),
        skipDuplicates: true,
      });
    }
  }

  private async syncProductGallery(
    tx: Prisma.TransactionClient,
    productId: string,
    gallery: ProductGalleryItemDto[],
  ) {
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

  async getDashboardCatalogSummary(): Promise<DashboardCatalogSummary> {
    const [
      noModifications,
      noVariants,
      activeEmpty,
      elementEmptyPool,
      compositeIncomplete,
    ] = await Promise.all([
      this.prisma.product.count({ where: productAdminHygieneWhere('no_modifications') }),
      this.prisma.product.count({ where: productAdminHygieneWhere('no_variants') }),
      this.prisma.product.count({ where: productAdminHygieneWhere('active_empty') }),
      this.prisma.product.count({ where: productAdminHygieneWhere('element_empty_pool') }),
      this.prisma.product.count({ where: productAdminHygieneWhere('composite_incomplete') }),
    ]);
    return {
      noModifications,
      noVariants,
      activeEmpty,
      elementEmptyPool,
      compositeIncomplete,
    };
  }

  async listProductsForAdmin(
    q?: string,
    pageRaw?: number,
    limitRaw?: number,
    visibility?: string,
    filters: AdminProductListQueryFilters = {},
  ) {
    const where = buildProductAdminListWhere(q, visibility, filters);
    const { page, limit, skip } = parseAdminListQuery(pageRaw, limitRaw);
    const [rows, total, cats] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
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
            orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { sortOrder: 'asc' }],
            select: {
              price: true,
              currency: true,
              isActive: true,
            },
          },
        },
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      }),
      this.prisma.product.count({ where }),
      this.prisma.category.findMany({
        select: { id: true, name: true, parentId: true },
      }),
    ]);
    const byId = new Map(cats.map((c) => [c.id, { name: c.name, parentId: c.parentId }]));
    const items = rows.map((r) => {
      const { price, currency } = pickAdminListPrice(r.variants);
      const thumbUrl = r.images[0]?.url ?? null;
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        price,
        currency,
        isActive: r.isActive,
        category: r.category,
        categoryPath: buildCategoryPathLabel(r.category.id, byId),
        additionalCategoryCount: r.productCategories.length,
        thumbUrl,
      };
    });
    return adminListResult(items, total, page, limit);
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

  /**
   * Создаёт товар. Варианты не создаёт — их добавляют через
   * /catalog/admin/products/:id/modifications → /variants.
   */
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

    this.validateProductMediaAndActiveRules(dto);

    const additionalCatIds = this.normalizeAdditionalCategoryIds(
      dto.categoryId,
      dto.additionalCategoryIds,
    );
    await this.assertAdditionalCategoriesExist(additionalCatIds);

    const gallery = dto.gallery ?? [];

    const agg = await this.prisma.product.aggregate({
      where: { categoryId: dto.categoryId },
      _max: { sortOrder: true },
    });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;

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

        await this.syncProductCuratedCollections(tx, product.id, dto.curatedCollectionIds ?? []);
        await this.syncProductCuratedSets(tx, product.id, dto.curatedProductSetIds ?? []);
        await this.syncProductCatalogTags(tx, product.id, dto.catalogTagIds ?? []);

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
          throw new ConflictException('Такой slug уже существует');
        }
        if (e.code === 'P2003') {
          throw new BadRequestException('Неверная категория или бренд');
        }
      }
      throw e;
    }
  }

  private formatVariantLabel(v: {
    variantLabel: string | null;
    modification: { name: string };
    elementSelections: {
      productElement: { name: string };
      brandMaterialColor: { name: string; brandMaterial: { name: string } };
    }[];
  }): string {
    if (v.variantLabel?.trim()) return v.variantLabel.trim();
    const mod = v.modification.name.trim();
    const parts = v.elementSelections.map((s) => {
      const el = s.productElement.name.trim();
      const mat = s.brandMaterialColor.brandMaterial.name.trim();
      const col = s.brandMaterialColor.name.trim();
      return `${el}: ${mat}/${col}`;
    });
    return parts.length ? `${mod} · ${parts.join(', ')}` : mod;
  }

  private mapVariantSummary(
    v: {
      id: string;
      variantLabel: string | null;
      price: Prisma.Decimal;
      currency: string;
      isActive: boolean;
      isDefault: boolean;
      modification: { id: string; name: string };
      elementSelections: {
        productElement: { name: string };
        brandMaterialColor: { name: string; brandMaterial: { name: string } };
      }[];
    },
    productName: string,
  ) {
    const displayName = this.formatVariantLabel(v) || productName;
    return {
      id: v.id,
      displayName,
      price: v.price.toString(),
      currency: v.currency,
      isActive: v.isActive,
      isDefault: v.isDefault,
      modificationId: v.modification.id,
      modificationLabel: v.modification.name,
      selectionsLabel:
        v.elementSelections
          .map(
            (s) =>
              `${s.productElement.name}: ${s.brandMaterialColor.brandMaterial.name}/${s.brandMaterialColor.name}`,
          )
          .join(' · ') || null,
    };
  }

  async getProductForAdmin(id: string) {
    const row = await this.prisma.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        productCategories: { select: { categoryId: true } },
        modifications: {
          orderBy: { sortOrder: 'asc' },
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
        catalogTags: {
          include: {
            tag: { select: { id: true, slug: true, name: true, sortOrder: true } },
          },
        },
        variants: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: {
            modification: { select: { id: true, name: true } },
            elementSelections: {
              include: {
                productElement: { select: { name: true } },
                brandMaterialColor: {
                  select: { name: true, brandMaterial: { select: { name: true } } },
                },
              },
            },
          },
        },
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
      catalogTagIds: row.catalogTags.map((t) => t.tagId),
      catalogTags: row.catalogTags
        .map((t) => t.tag)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru')),
      brandId: row.brandId,
      shortDescription: row.shortDescription,
      isActive: row.isActive,
      images: row.images.map((i) => ({
        id: i.id,
        url: i.url,
        alt: i.alt,
        sortOrder: i.sortOrder,
      })),
      modifications: row.modifications.map((m) => ({
        id: m.id,
        name: m.name,
        modificationSlug: m.modificationSlug,
        sortOrder: m.sortOrder,
      })),
      elements: row.elements.map((el) => ({
        id: el.id,
        name: el.name,
        sortOrder: el.sortOrder,
        availabilities: el.availabilities.map((a) => ({
          brandMaterialColorId: a.brandMaterialColor.id,
          sortOrder: a.sortOrder,
          materialName: a.brandMaterialColor.brandMaterial.name,
          colorName: a.brandMaterialColor.name,
          imageUrl: a.brandMaterialColor.imageUrl,
        })),
      })),
      additionalInfoHtml: row.additionalInfoHtml,
      deliveryText: row.deliveryText,
      technicalSpecs: row.technicalSpecs,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      likesUserCount: row.likesUserCount,
      likesAdminBoost: row.likesAdminBoost,
      category: row.category,
      brand: row.brand,
      variants: row.variants.map((v) => this.mapVariantSummary(v, row.name)),
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

    this.validateProductMediaAndActiveRules(dto);

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

    if (dto.likesAdminBoost !== undefined) {
      const n = Math.floor(Number(dto.likesAdminBoost));
      data.likesAdminBoost = Number.isFinite(n) ? Math.max(0, Math.min(10_000_000, n)) : 0;
    }

    if (dto.categoryId !== existing.categoryId) {
      const agg = await this.prisma.product.aggregate({
        where: { categoryId: dto.categoryId },
        _max: { sortOrder: true },
      });
      data.sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id }, data });

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
        if (dto.catalogTagIds !== undefined) {
          await this.syncProductCatalogTags(tx, id, dto.catalogTagIds);
        }

        if (dto.gallery !== undefined) {
          await this.syncProductGallery(tx, id, dto.gallery);
        }
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
      return this.getProductForAdmin(id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          throw new ConflictException('Такой slug уже существует');
        }
        if (e.code === 'P2003') {
          throw new BadRequestException('Неверная категория или бренд');
        }
      }
      throw e;
    }
  }

  /** Использовано в preview-формул — по FORMULA-вариантам. */
  resolveVariantFormulaMode(mode: string | null | undefined): ProductPriceMode {
    return mode === 'formula' ? ProductPriceMode.FORMULA : ProductPriceMode.MANUAL;
  }

  /** Проксирование на variantAdmin для обратной совместимости контроллера. */
  get variantsAdmin() {
    return this.variantAdmin;
  }

  async listCatalogTags() {
    return this.prisma.catalogTag.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, sortOrder: true },
    });
  }
}
