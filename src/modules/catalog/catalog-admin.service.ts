import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CuratedCollectionKind, Prisma, ProductPriceMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductSearchIndexService } from '../../meilisearch/product-search-index.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MediaLibraryService } from '../media-library/media-library.service';
import {
  CreateBrandAdminDto,
  CreateCategoryAdminDto,
  CreateProductAdminDto,
  ProductGalleryItemDto,
  ProductMaterialOptionShellDto,
  UpdateBrandAdminDto,
  UpdateCategoryAdminDto,
  UpdateProductShellAdminDto,
  UpdateProductVariantAdminDto,
} from './dto/catalog-admin.dto';
import { PricingAdminService } from './pricing-admin.service';
import { calcMskAndRetailRub, type PricingProfileCalcInput } from './pricing-calculation';

const CYR_TO_LAT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function transliterateRu(input: string): string {
  return [...input.toLowerCase()].map((ch) => CYR_TO_LAT[ch] ?? ch).join('');
}

function slugifyBase(name: string): string {
  const raw = transliterateRu(name)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return raw || 'category';
}

function slugifyProductBase(name: string): string {
  const raw = transliterateRu(name)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return raw || 'product';
}

@Injectable()
export class CatalogAdminService {
  private readonly logger = new Logger(CatalogAdminService.name);

  constructor(
    private prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly mediaLibrary: MediaLibraryService,
    private readonly productSearchIndex: ProductSearchIndexService,
    private readonly pricingAdmin: PricingAdminService,
  ) {}

  private normUrl(u: string): string {
    return u.trim().replace(/\/+$/, '');
  }

  /** Объём в м³ из поля формы (вручную). */
  private normalizeOptionalVolumeM3(raw: number | null | undefined): Prisma.Decimal | null {
    if (raw == null || !Number.isFinite(raw) || raw < 0) return null;
    return new Prisma.Decimal(raw);
  }

  private prismaPricingProfileToCalc(p: {
    containerType: string;
    containerMaxWeightKg: Prisma.Decimal | null;
    containerMaxVolumeM3: Prisma.Decimal | null;
    cnyRate: Prisma.Decimal;
    usdRate: Prisma.Decimal;
    eurRate: Prisma.Decimal;
    transferCommissionPct: Prisma.Decimal;
    customsAdValoremPct: Prisma.Decimal;
    customsWeightPct: Prisma.Decimal;
    vatPct: Prisma.Decimal;
    markupPct: Prisma.Decimal;
    agentRub: Prisma.Decimal;
    warehousePortUsd: Prisma.Decimal;
    fobUsd: Prisma.Decimal;
    portMskRub: Prisma.Decimal;
    extraLogisticsRub: Prisma.Decimal;
  }): PricingProfileCalcInput {
    return {
      containerType: p.containerType,
      containerMaxWeightKg: p.containerMaxWeightKg?.toNumber() ?? null,
      containerMaxVolumeM3: p.containerMaxVolumeM3?.toNumber() ?? null,
      cnyRate: p.cnyRate.toNumber(),
      usdRate: p.usdRate.toNumber(),
      eurRate: p.eurRate.toNumber(),
      transferCommissionPct: p.transferCommissionPct.toNumber(),
      customsAdValoremPct: p.customsAdValoremPct.toNumber(),
      customsWeightPct: p.customsWeightPct.toNumber(),
      vatPct: p.vatPct.toNumber(),
      markupPct: p.markupPct.toNumber(),
      agentRub: p.agentRub.toNumber(),
      warehousePortUsd: p.warehousePortUsd.toNumber(),
      fobUsd: p.fobUsd.toNumber(),
      portMskRub: p.portMskRub.toNumber(),
      extraLogisticsRub: p.extraLogisticsRub.toNumber(),
    };
  }

  private async resolveVariantPriceForWrite(
    dto: Pick<
      CreateProductAdminDto,
      'price' | 'priceMode' | 'costPriceCny' | 'weightKg' | 'volumeLiters'
    >,
    categoryIdsForMatch: string[],
  ): Promise<{
    price: Prisma.Decimal;
    priceMode: ProductPriceMode;
    costPriceCny: Prisma.Decimal | null;
  }> {
    const mode =
      dto.priceMode === 'formula' ? ProductPriceMode.FORMULA : ProductPriceMode.MANUAL;

    const costRaw = dto.costPriceCny;
    const costDec =
      costRaw != null && Number.isFinite(costRaw) && costRaw > 0
        ? new Prisma.Decimal(costRaw)
        : null;

    if (mode === ProductPriceMode.MANUAL) {
      const p = dto.price ?? 0;
      return {
        price: new Prisma.Decimal(p),
        priceMode: mode,
        costPriceCny: costDec,
      };
    }

    const cny = costRaw;
    const wkg = dto.weightKg;
    const vm3 = dto.volumeLiters;
    if (cny == null || !Number.isFinite(cny) || cny <= 0) {
      throw new BadRequestException('Укажите закупочную цену в юанях (CNY) для расчёта по формуле');
    }
    if (wkg == null || !Number.isFinite(wkg) || wkg <= 0) {
      throw new BadRequestException('Укажите вес брутто (кг) для расчёта по формуле');
    }
    if (vm3 == null || !Number.isFinite(vm3) || vm3 <= 0) {
      throw new BadRequestException('Укажите объём брутто (м³) для расчёта по формуле');
    }

    const profile = await this.pricingAdmin.findProfileForCategoryIds(categoryIdsForMatch);
    if (!profile) {
      throw new BadRequestException(
        'Нет профиля ценообразования для категорий этого товара. Создайте профиль в Настройки → Ценообразование.',
      );
    }

    const { retailRub } = calcMskAndRetailRub(this.prismaPricingProfileToCalc(profile), {
      costPriceCny: cny,
      grossWeightKg: wkg,
      volumeM3: vm3,
    });

    return {
      price: new Prisma.Decimal(retailRub),
      priceMode: ProductPriceMode.FORMULA,
      costPriceCny: new Prisma.Decimal(cny),
    };
  }

  /**
   * После изменения профилей ценообразования пересчитывает цену всех товаров в режиме «по формуле».
   */
  async recalculateAllFormulaProductPrices(): Promise<void> {
    const variants = await this.prisma.productVariant.findMany({
      where: { priceMode: ProductPriceMode.FORMULA },
      select: {
        id: true,
        productId: true,
        costPriceCny: true,
        weightKg: true,
        volumeLiters: true,
        product: {
          select: {
            categoryId: true,
            productCategories: { select: { categoryId: true } },
          },
        },
      },
    });
    const touchedProducts = new Set<string>();
    for (const v of variants) {
      const cny = v.costPriceCny?.toNumber();
      const wkg = v.weightKg?.toNumber();
      const vm3 = v.volumeLiters?.toNumber();
      if (
        cny == null ||
        !Number.isFinite(cny) ||
        cny <= 0 ||
        wkg == null ||
        !Number.isFinite(wkg) ||
        wkg <= 0 ||
        vm3 == null ||
        !Number.isFinite(vm3) ||
        vm3 <= 0
      ) {
        continue;
      }
      const categoryIds = [
        v.product.categoryId,
        ...v.product.productCategories.map((c) => c.categoryId),
      ];
      const profile = await this.pricingAdmin.findProfileForCategoryIds(categoryIds);
      if (!profile) continue;
      const { retailRub } = calcMskAndRetailRub(this.prismaPricingProfileToCalc(profile), {
        costPriceCny: cny,
        grossWeightKg: wkg,
        volumeM3: vm3,
      });
      await this.prisma.productVariant.update({
        where: { id: v.id },
        data: { price: new Prisma.Decimal(retailRub) },
      });
      touchedProducts.add(v.productId);
    }
    for (const pid of touchedProducts) {
      void this.productSearchIndex.syncProduct(pid);
    }
  }

  /** Связать публичный URL фона с MediaObject (если объект в медиатеке). */
  private async resolveCategoryBackgroundMediaId(
    url: string,
    explicitMediaObjectId?: string | null,
  ): Promise<string | null> {
    const u = url.trim();
    if (!u) return null;
    if (explicitMediaObjectId) {
      const mo = await this.prisma.mediaObject.findUnique({ where: { id: explicitMediaObjectId } });
      if (!mo) throw new BadRequestException('Объект медиатеки не найден');
      const expected = this.objectStorage.getPublicUrlForKey(mo.storageKey);
      if (this.normUrl(expected) !== this.normUrl(u)) {
        throw new BadRequestException('URL обложки не совпадает с объектом медиатеки');
      }
      return mo.id;
    }
    const key = this.objectStorage.tryPublicUrlToKey(u);
    if (!key?.startsWith('objects/')) return null;
    const mo = await this.prisma.mediaObject.findUnique({ where: { storageKey: key } });
    return mo?.id ?? null;
  }

  private async ensureUniqueSlug(base: string): Promise<string> {
    let slug = base.slice(0, 80) || 'category';
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? slug : `${slug}-${n}`;
      const exists = await this.prisma.category.findUnique({ where: { slug: candidate } });
      if (!exists) return candidate;
      n += 1;
    }
  }

  private async ensureUniqueBrandSlug(base: string): Promise<string> {
    let slug = base.slice(0, 80) || 'brand';
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? slug : `${slug}-${n}`;
      const exists = await this.prisma.brand.findUnique({ where: { slug: candidate } });
      if (!exists) return candidate;
      n += 1;
    }
  }

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

  private galleryToPrisma(
    input: string[] | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    const urls = [...new Set((input ?? []).map((s) => s.trim()).filter(Boolean))].slice(0, 3);
    return urls.length ? urls : Prisma.JsonNull;
  }

  private normBrandShortDescription(raw: string | null | undefined): string | null {
    const t = raw?.trim().slice(0, 280) ?? '';
    return t || null;
  }

  private normProductShortDescription(raw: string | null | undefined): string | null {
    const t = raw?.trim() ?? '';
    return t || null;
  }

  /** URL галереи и цветов — только своё хранилище или whitelist; активный товар — минимум одна картинка в галерее. */
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

  /** nodeId лежит в поддереве ancestorId (ancestorId — предок nodeId) */
  private async isUnder(ancestorId: string, nodeId: string): Promise<boolean> {
    let currentId: string | null = nodeId;
    const visited = new Set<string>();
    while (currentId) {
      if (currentId === ancestorId) return true;
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const parentRow: { parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: currentId },
          select: { parentId: true },
        });
      currentId = parentRow?.parentId ?? null;
    }
    return false;
  }

  private async nextSortOrder(parentId: string | null): Promise<number> {
    const agg = await this.prisma.category.aggregate({
      where: parentId == null ? { parentId: null } : { parentId },
      _max: { sortOrder: true },
    });
    return (agg._max.sortOrder ?? -1) + 1;
  }

  /** Товары в категории + во всех потомках (по всему дереву). */
  private async subtreeProductCounts(): Promise<Map<string, number>> {
    const allCats = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const primaryGroups = await this.prisma.product.groupBy({
      by: ['categoryId'],
      _count: { _all: true },
    });
    const linkGroups = await this.prisma.productCategory.groupBy({
      by: ['categoryId'],
      _count: { _all: true },
    });
    const direct = new Map<string, number>();
    for (const g of primaryGroups) {
      direct.set(g.categoryId, (direct.get(g.categoryId) ?? 0) + g._count._all);
    }
    for (const g of linkGroups) {
      direct.set(g.categoryId, (direct.get(g.categoryId) ?? 0) + g._count._all);
    }
    const childrenByParent = new Map<string | null, string[]>();
    for (const c of allCats) {
      const p = c.parentId;
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p)!.push(c.id);
    }
    const memo = new Map<string, number>();
    const dfs = (id: string): number => {
      const hit = memo.get(id);
      if (hit !== undefined) return hit;
      let n = direct.get(id) ?? 0;
      for (const ch of childrenByParent.get(id) ?? []) {
        n += dfs(ch);
      }
      memo.set(id, n);
      return n;
    };
    for (const c of allCats) dfs(c.id);
    return memo;
  }

  async listCategories(q?: string) {
    const where =
      q && q.trim()
        ? { name: { contains: q.trim(), mode: 'insensitive' as const } }
        : {};
    const [rows, subtreeCounts] = await Promise.all([
      this.prisma.category.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          parent: { select: { id: true, name: true } },
          _count: { select: { primaryProducts: true, productCategories: true, children: true } },
        },
      }),
      this.subtreeProductCounts(),
    ]);
    return rows.map((row) => ({
      ...row,
      recursiveProductCount: subtreeCounts.get(row.id) ?? 0,
    }));
  }

  async getCategory(id: string) {
    const row = await this.prisma.category.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            _count: { select: { primaryProducts: true, productCategories: true, children: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Category not found');
    const depthFromRoot = await this.computeCategoryDepthFromRoot(id);
    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { categoryId: id },
          { productCategories: { some: { categoryId: id } } },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 200,
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        variants: {
          where: { isDefault: true },
          take: 1,
          select: { price: true, currency: true },
        },
      },
    });
    const productsMapped = products.map((p) => {
      const dv = p.variants[0];
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: dv?.price ?? null,
        currency: dv?.currency ?? 'RUB',
        isActive: p.isActive,
      };
    });
    return { ...row, products: productsMapped, depthFromRoot };
  }

  /** Индекс глубины от корня: 0 = корень, 1 = подкатегория, 2 = третий уровень. */
  private readonly maxCategoryDepthFromRoot = 2;

  /** Глубина категории от корня (0 для корневой). */
  private async computeCategoryDepthFromRoot(categoryId: string): Promise<number> {
    let depth = 0;
    let currentId: string | null = categoryId;
    const visited = new Set<string>();
    while (currentId) {
      if (visited.has(currentId)) {
        throw new BadRequestException('Обнаружена циклическая цепочка родителей категории');
      }
      visited.add(currentId);
      const cur: { parentId: string | null } | null = await this.prisma.category.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });
      if (!cur) throw new BadRequestException('Категория не найдена');
      if (cur.parentId == null) return depth;
      depth += 1;
      currentId = cur.parentId;
    }
    return depth;
  }

  /** Высота поддерева вниз от узла (число рёбер до самого глубокого потомка). */
  private async subtreeHeightBelow(categoryId: string): Promise<number> {
    const rows = await this.prisma.category.findMany({
      where: { parentId: categoryId },
      select: { id: true },
    });
    if (!rows.length) return 0;
    let max = 0;
    for (const r of rows) {
      max = Math.max(max, 1 + (await this.subtreeHeightBelow(r.id)));
    }
    return max;
  }

  /** Новая подкатегория: у родителя глубина не больше 1 (итого не более трёх уровней). */
  private async assertParentAllowsChildCategory(parentId: string): Promise<void> {
    const d = await this.computeCategoryDepthFromRoot(parentId);
    if (d > this.maxCategoryDepthFromRoot - 1) {
      throw new BadRequestException(
        'Максимум три уровня категорий: корень → подкатегория → под-подкатегория',
      );
    }
  }

  async createCategory(dto: CreateCategoryAdminDto) {
    const pid = dto.parentId?.trim() || null;
    if (pid) {
      await this.assertParentAllowsChildCategory(pid);
    }
    const base = dto.slug?.trim() ? dto.slug.trim() : slugifyBase(dto.name);
    const slug = await this.ensureUniqueSlug(base);
    const sortOrder = await this.nextSortOrder(pid);
    const bgRaw = (dto.backgroundImageUrl ?? '').trim();
    let bgUrl: string | null = null;
    let mediaId: string | null = null;
    if (bgRaw) {
      mediaId = await this.resolveCategoryBackgroundMediaId(
        bgRaw,
        dto.backgroundMediaObjectId ?? null,
      );
      bgUrl = bgRaw;
    }
    return this.prisma.category.create({
      data: {
        name: dto.name.trim(),
        slug,
        parentId: pid,
        sortOrder,
        isActive: dto.isActive ?? true,
        backgroundImageUrl: bgUrl,
        backgroundMediaObjectId: mediaId,
        seoTitle: dto.seoTitle?.trim() || null,
        seoDescription: dto.seoDescription?.trim() || null,
      },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { primaryProducts: true, productCategories: true, children: true } },
      },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryAdminDto) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');

    if (dto.parentId !== undefined) {
      if (dto.parentId === id) throw new BadRequestException('Category cannot be its own parent');
      const newPid = dto.parentId;
      if (newPid !== null) {
        await this.assertParentAllowsChildCategory(newPid);
        if (await this.isUnder(id, newPid)) {
          throw new BadRequestException('Cannot set parent to a descendant of this category');
        }
      }
      const newDepth = newPid === null ? 0 : (await this.computeCategoryDepthFromRoot(newPid)) + 1;
      const below = await this.subtreeHeightBelow(id);
      if (newDepth + below > this.maxCategoryDepthFromRoot) {
        throw new BadRequestException(
          'Такая перестановка нарушит лимит глубины (не более трёх уровней: корень → подкатегория → под-подкатегория)',
        );
      }
    }

    let slug = existing.slug;
    if (dto.slug !== undefined && dto.slug.trim() && dto.slug.trim() !== existing.slug) {
      const taken = await this.prisma.category.findUnique({ where: { slug: dto.slug.trim() } });
      if (taken && taken.id !== id) throw new ConflictException('Slug already in use');
      slug = dto.slug.trim();
    }

    let backgroundPatch:
      | { backgroundImageUrl: string | null; backgroundMediaObjectId: string | null }
      | undefined;
    if (dto.backgroundImageUrl !== undefined) {
      const raw = dto.backgroundImageUrl;
      if (raw === null || (typeof raw === 'string' && !raw.trim())) {
        backgroundPatch = { backgroundImageUrl: null, backgroundMediaObjectId: null };
      } else {
        const bg = String(raw).trim();
        const nextMid = await this.resolveCategoryBackgroundMediaId(
          bg,
          dto.backgroundMediaObjectId !== undefined ? dto.backgroundMediaObjectId : undefined,
        );
        backgroundPatch = { backgroundImageUrl: bg, backgroundMediaObjectId: nextMid };
      }
    }

    const prevBackgroundMediaId = existing.backgroundMediaObjectId;

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.slug !== undefined ? { slug } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...backgroundPatch,
        ...(dto.seoTitle !== undefined ? { seoTitle: dto.seoTitle?.trim() || null } : {}),
        ...(dto.seoDescription !== undefined
          ? { seoDescription: dto.seoDescription?.trim() || null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            _count: { select: { primaryProducts: true, productCategories: true, children: true } },
          },
        },
      },
    });

    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { categoryId: id },
          { productCategories: { some: { categoryId: id } } },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 200,
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        variants: {
          where: { isDefault: true },
          take: 1,
          select: { price: true, currency: true },
        },
      },
    });

    const productsMapped = products.map((p) => {
      const dv = p.variants[0];
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: dv?.price ?? null,
        currency: dv?.currency ?? 'RUB',
        isActive: p.isActive,
      };
    });

    if (
      backgroundPatch &&
      prevBackgroundMediaId &&
      prevBackgroundMediaId !== updated.backgroundMediaObjectId
    ) {
      await this.mediaLibrary.deleteMediaObjectIfUnreferenced(prevBackgroundMediaId);
    }

    return { ...updated, products: productsMapped };
  }

  async reorderCategories(parentId: string | null | undefined, orderedIds: string[]) {
    const pid = parentId === undefined ? null : parentId;
    const siblings = await this.prisma.category.findMany({
      where: pid == null ? { parentId: null } : { parentId: pid },
      select: { id: true },
    });
    const set = new Set(siblings.map((s) => s.id));
    if (orderedIds.length !== set.size || !orderedIds.every((id) => set.has(id))) {
      throw new BadRequestException(
        'orderedIds must list every direct child of this parent exactly once',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      for (let index = 0; index < orderedIds.length; index++) {
        await tx.category.update({
          where: { id: orderedIds[index] },
          data: { sortOrder: index },
        });
      }
    });
    return { ok: true as const };
  }

  /**
   * Массовое удаление: несколько проходов — сначала листья без товаров,
   * затем родители, ставшие пустыми (без товаров и без детей).
   */
  async deleteCategories(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return { deleted: [] as string[], skipped: [] as string[] };

    const deleted: string[] = [];
    const skippedSet = new Set<string>();
    let remaining = new Set(unique);
    const maxPasses = Math.max(unique.length, 1) + 8;

    for (let pass = 0; pass < maxPasses && remaining.size > 0; pass++) {
      let progress = false;
      const batch = [...remaining];
      for (const id of batch) {
        const row = await this.prisma.category.findUnique({
          where: { id },
          include: {
            _count: { select: { primaryProducts: true, productCategories: true, children: true } },
          },
        });
        if (!row) {
          remaining.delete(id);
          progress = true;
          continue;
        }
        const bindings =
          row._count.primaryProducts + row._count.productCategories + row._count.children;
        if (bindings > 0) {
          continue;
        }
        try {
          const bgMediaId = row.backgroundMediaObjectId;
          await this.prisma.category.delete({ where: { id } });
          if (bgMediaId) {
            await this.mediaLibrary.deleteMediaObjectIfUnreferenced(bgMediaId);
          }
          deleted.push(id);
          remaining.delete(id);
          progress = true;
        } catch {
          skippedSet.add(id);
          remaining.delete(id);
          progress = true;
        }
      }
      if (!progress) break;
    }

    for (const id of remaining) skippedSet.add(id);
    return { deleted, skipped: [...skippedSet] };
  }

  async uploadCategoryImage(
    file: Express.Multer.File,
  ): Promise<{ url: string; mediaObjectId: string }> {
    return this.mediaLibrary.ingestCategoryBackgroundImage(file);
  }

  async listBrandsForAdmin(q?: string) {
    const trim = q?.trim();
    return this.prisma.brand.findMany({
      where: trim ? { name: { contains: trim, mode: 'insensitive' } } : {},
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
  }

  /** Удаляет только бренды без привязанных товаров. */
  async deleteBrands(ids: string[]) {
    const unique = [...new Set(ids)];
    const deleted: string[] = [];
    const skipped: string[] = [];
    for (const id of unique) {
      const row = await this.prisma.brand.findUnique({
        where: { id },
        include: { _count: { select: { products: true } } },
      });
      if (!row) continue;
      if (row._count.products > 0) {
        skipped.push(id);
        continue;
      }
      try {
        await this.prisma.brand.delete({ where: { id } });
        deleted.push(id);
      } catch {
        skipped.push(id);
      }
    }
    return { deleted, skipped };
  }

  async getBrandForAdmin(id: string) {
    const row = await this.prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!row) throw new NotFoundException('Brand not found');
    return row;
  }

  async createBrand(dto: CreateBrandAdminDto) {
    const base = dto.slug?.trim() ? dto.slug.trim() : slugifyBase(dto.name);
    const slug = await this.ensureUniqueBrandSlug(base);
    const agg = await this.prisma.brand.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;
    const cover = dto.coverImageUrl == null ? null : dto.coverImageUrl.trim() || null;
    const logo =
      dto.logoUrl === undefined
        ? null
        : dto.logoUrl === null
          ? null
          : dto.logoUrl.trim() || null;
    const bg = dto.backgroundImageUrl?.trim() || null;
    return this.prisma.brand.create({
      data: {
        name: dto.name.trim(),
        slug,
        sortOrder,
        isActive: dto.isActive ?? true,
        coverImageUrl: cover,
        logoUrl: logo,
        backgroundImageUrl: bg,
        galleryImageUrls: this.galleryToPrisma(dto.galleryImageUrls),
        description: dto.description?.trim() || null,
        shortDescription: this.normBrandShortDescription(dto.shortDescription),
        seoTitle: dto.seoTitle?.trim() || null,
        seoDescription: dto.seoDescription?.trim() || null,
      },
      include: { _count: { select: { products: true } } },
    });
  }

  async updateBrand(id: string, dto: UpdateBrandAdminDto) {
    const existing = await this.prisma.brand.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Brand not found');

    let nextSlug = existing.slug;
    if (dto.slug !== undefined && dto.slug.trim() && dto.slug.trim() !== existing.slug) {
      const taken = await this.prisma.brand.findUnique({ where: { slug: dto.slug.trim() } });
      if (taken && taken.id !== id) throw new ConflictException('Slug already in use');
      nextSlug = dto.slug.trim();
    }

    const data: Prisma.BrandUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.slug !== undefined) data.slug = nextSlug;
    if (dto.coverImageUrl !== undefined) {
      const c = dto.coverImageUrl === null ? null : dto.coverImageUrl.trim() || null;
      data.coverImageUrl = c;
    }
    if (dto.logoUrl !== undefined) {
      data.logoUrl = dto.logoUrl === null ? null : dto.logoUrl.trim() || null;
    }
    if (dto.backgroundImageUrl !== undefined) {
      data.backgroundImageUrl = dto.backgroundImageUrl?.trim() || null;
    }
    if (dto.galleryImageUrls !== undefined) {
      data.galleryImageUrls = this.galleryToPrisma(dto.galleryImageUrls);
    }
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.shortDescription !== undefined) {
      data.shortDescription = this.normBrandShortDescription(dto.shortDescription);
    }
    if (dto.seoTitle !== undefined) data.seoTitle = dto.seoTitle?.trim() || null;
    if (dto.seoDescription !== undefined) {
      data.seoDescription = dto.seoDescription?.trim() || null;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.brand.update({
      where: { id },
      data,
      include: { _count: { select: { products: true } } },
    });
  }

  async uploadBrandImage(
    file: Express.Multer.File,
    kind: 'cover' | 'background' | 'gallery',
  ): Promise<{ url: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('Файл не передан');
    this.objectStorage.assertImage({ size: file.size, mimetype: file.mimetype });
    const { url } = await this.objectStorage.uploadBrandImage(file.buffer, file.mimetype, kind);
    return { url };
  }

  async uploadRichMedia(
    file: Express.Multer.File,
    type: 'image' | 'video',
  ): Promise<{ url: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('Файл не передан');
    const { url } = await this.objectStorage.uploadRichMedia(file.buffer, file.mimetype, type);
    return { url };
  }

  /** Цепочка имён от корня к категории товара: «Гостиная → Диваны». */
  private categoryPathLabel(
    categoryId: string,
    byId: Map<string, { name: string; parentId: string | null }>,
  ): string {
    const parts: string[] = [];
    let cur: string | null = categoryId;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const row = byId.get(cur);
      if (!row) break;
      parts.push(row.name);
      cur = row.parentId;
    }
    return parts.reverse().join(' → ');
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
        categoryPath: this.categoryPathLabel(r.category.id, byId),
        additionalCategoryCount: r.productCategories.length,
        thumbUrl,
      };
    });
  }

  /**
   * Удаляет товары без позиций в заказах (OrderItem). Остальные — в skipped.
   */
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
    const priceBlock = await this.resolveVariantPriceForWrite(
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

        const variantSlug = await this.ensureUniqueVariantSlug(product.id, 'v-0');

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
            volumeLiters: this.normalizeOptionalVolumeM3(dto.volumeLiters),
            weightKg:
              dto.weightKg != null && Number.isFinite(dto.weightKg)
                ? new Prisma.Decimal(dto.weightKg)
                : null,
            netLengthMm: dto.netLengthMm ?? null,
            netWidthMm: dto.netWidthMm ?? null,
            netHeightMm: dto.netHeightMm ?? null,
            netVolumeLiters: this.normalizeOptionalVolumeM3(dto.netVolumeLiters),
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
          displayName: full.name,
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

    const priceBlock = await this.resolveVariantPriceForWrite(mergedForPrice, additionalCatIds);

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
        const mat = await this.prisma.productMaterialOption.findFirst({
          where: { id: nextMatId, productId },
        });
        const col = await this.prisma.productColorOption.findFirst({
          where: { id: nextColId, materialOptionId: nextMatId },
        });
        if (!mat || !col) {
          throw new BadRequestException('Материал или цвет не относятся к этому товару');
        }
        variantUpdate.materialOption = { connect: { id: nextMatId } };
        variantUpdate.colorOption = { connect: { id: nextColId } };
        if (dto.optionAttributes === undefined) {
          variantUpdate.optionAttributes = { material: mat.name, color: col.name };
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
      variantUpdate.volumeLiters = this.normalizeOptionalVolumeM3(dto.volumeLiters);
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
      variantUpdate.netVolumeLiters = this.normalizeOptionalVolumeM3(dto.netVolumeLiters);
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
    const variantSlug = await this.ensureUniqueVariantSlug(productId, `v-${nextSort}`);
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

  private async syncProductGallery(tx: any, productId: string, gallery: ProductGalleryItemDto[]) {
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
    tx: any,
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

  private async syncVariantProductImages(
    tx: any,
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

  private async ensureUniqueVariantSlug(productId: string, base: string): Promise<string> {
    let s = slugifyProductBase(base).slice(0, 40) || 'v';
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? s : `${s}-${n}`;
      const taken = await this.prisma.productVariant.findFirst({
        where: { productId, variantSlug: candidate },
      });
      if (!taken) return candidate;
      n++;
    }
  }
}
