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
import { MediaLibraryService } from '../media-library/media-library.service';
import {
  CreateBrandAdminDto,
  CreateCategoryAdminDto,
  CreateProductAdminDto,
  UpdateBrandAdminDto,
  UpdateCategoryAdminDto,
} from './dto/catalog-admin.dto';

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
  ) {}

  private normUrl(u: string): string {
    return u.trim().replace(/\/+$/, '');
  }

  /** Объём в м³ из коробки в мм: 10⁹ мм³ = 1 м³. */
  private volumeCubicMetersFromBoxMm(
    lengthMm: number | null,
    widthMm: number | null,
    heightMm: number | null,
  ): Prisma.Decimal | null {
    if (
      lengthMm == null ||
      widthMm == null ||
      heightMm == null ||
      !Number.isFinite(lengthMm) ||
      !Number.isFinite(widthMm) ||
      !Number.isFinite(heightMm) ||
      lengthMm <= 0 ||
      widthMm <= 0 ||
      heightMm <= 0
    ) {
      return null;
    }
    return new Prisma.Decimal((lengthMm * widthMm * heightMm) / 1_000_000_000);
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
        price: true,
        currency: true,
        isActive: true,
      },
    });
    return { ...row, products, depthFromRoot };
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
        price: true,
        currency: true,
        isActive: true,
      },
    });

    if (
      backgroundPatch &&
      prevBackgroundMediaId &&
      prevBackgroundMediaId !== updated.backgroundMediaObjectId
    ) {
      await this.mediaLibrary.deleteMediaObjectIfUnreferenced(prevBackgroundMediaId);
    }

    return { ...updated, products };
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
    const bg = dto.backgroundImageUrl?.trim() || null;
    return this.prisma.brand.create({
      data: {
        name: dto.name.trim(),
        slug,
        sortOrder,
        isActive: dto.isActive ?? true,
        coverImageUrl: cover,
        backgroundImageUrl: bg,
        galleryImageUrls: this.galleryToPrisma(dto.galleryImageUrls),
        description: dto.description?.trim() || null,
        shortDescription: this.normBrandShortDescription(dto.shortDescription),
        seoTitle: dto.seoTitle?.trim() || null,
        seoDescription: dto.seoDescription?.trim() || null,
        logoUrl: cover,
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
      data.logoUrl = c;
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
          price: true,
          currency: true,
          isActive: true,
          category: { select: { id: true, name: true } },
          productCategories: { select: { categoryId: true } },
          images: {
            take: 1,
            orderBy: { sortOrder: 'asc' },
            select: { url: true },
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
      }),
      this.prisma.category.findMany({
        select: { id: true, name: true, parentId: true },
      }),
    ]);
    const byId = new Map(cats.map((c) => [c.id, { name: c.name, parentId: c.parentId }]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      price: r.price.toString(),
      currency: r.currency,
      isActive: r.isActive,
      category: r.category,
      categoryPath: this.categoryPathLabel(r.category.id, byId),
      additionalCategoryCount: r.productCategories.length,
      thumbUrl: r.images[0]?.url ?? null,
    }));
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
        .deleteProductImageObjectsForRemovedUrls(imageUrlsToRemoveFromStorage)
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
      const taken = await this.prisma.product.findUnique({ where: { sku } });
      if (taken) throw new ConflictException('SKU уже занят');
    }

    this.validateProductMediaAndActiveRules(dto);

    const additionalCatIds = this.normalizeAdditionalCategoryIds(
      dto.categoryId,
      dto.additionalCategoryIds,
    );
    await this.assertAdditionalCategoriesExist(additionalCatIds);

    const gallery = dto.gallery ?? [];
    const colors = (dto.colors ?? []).filter((c) => c.name?.trim() && c.imageUrl?.trim());
    const materials = (dto.materials ?? []).filter((m) => m.name?.trim());
    const sizes = (dto.sizes ?? []).filter((s) => s.value?.trim());
    const labels = [...new Set((dto.labels ?? []).map((l) => l.trim()).filter(Boolean))].slice(0, 40);

    const specsJson: Prisma.InputJsonValue = {
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
            model3dUrl: dto.model3dUrl?.trim() || null,
            drawingUrl: dto.drawingUrl?.trim() || null,
            specsJson,
            sku,
            deliveryText: dto.deliveryText?.trim() || null,
            technicalSpecs: dto.technicalSpecs?.trim() || null,
            lengthMm: dto.lengthMm ?? null,
            widthMm: dto.widthMm ?? null,
            heightMm: dto.heightMm ?? null,
            volumeLiters: this.volumeCubicMetersFromBoxMm(
              dto.lengthMm ?? null,
              dto.widthMm ?? null,
              dto.heightMm ?? null,
            ),
            weightKg:
              dto.weightKg != null && Number.isFinite(dto.weightKg)
                ? new Prisma.Decimal(dto.weightKg)
                : null,
            netLengthMm: dto.netLengthMm ?? null,
            netWidthMm: dto.netWidthMm ?? null,
            netHeightMm: dto.netHeightMm ?? null,
            netVolumeLiters: this.volumeCubicMetersFromBoxMm(
              dto.netLengthMm ?? null,
              dto.netWidthMm ?? null,
              dto.netHeightMm ?? null,
            ),
            netWeightKg:
              dto.netWeightKg != null && Number.isFinite(dto.netWeightKg)
                ? new Prisma.Decimal(dto.netWeightKg)
                : null,
            seoTitle: dto.seoTitle?.trim() || null,
            seoDescription: dto.seoDescription?.trim() || null,
            price: new Prisma.Decimal(dto.price),
            currency,
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
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        productCategories: { select: { categoryId: true } },
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
      price: row.price.toString(),
      currency: row.currency,
      isActive: row.isActive,
      images: row.images.map((i) => ({
        url: i.url,
        alt: i.alt,
        sortOrder: i.sortOrder,
      })),
      specsJson: row.specsJson,
      additionalInfoHtml: row.additionalInfoHtml,
      model3dUrl: row.model3dUrl,
      drawingUrl: row.drawingUrl,
      deliveryText: row.deliveryText,
      technicalSpecs: row.technicalSpecs,
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
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      category: row.category,
      brand: row.brand,
    };
  }

  async updateProduct(id: string, dto: CreateProductAdminDto) {
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
    const removedGalleryUrls = prevGalleryUrls.filter((u) => !newGalleryUrlSet.has(u));

    const skuRaw = dto.sku?.trim();
    const sku = skuRaw || null;
    if (sku !== existing.sku) {
      if (sku) {
        const taken = await this.prisma.product.findFirst({
          where: { sku, NOT: { id } },
        });
        if (taken) throw new ConflictException('SKU уже занят');
      }
    }

    const gallery = dto.gallery ?? [];
    const colors = (dto.colors ?? []).filter((c) => c.name?.trim() && c.imageUrl?.trim());
    const materials = (dto.materials ?? []).filter((m) => m.name?.trim());
    const sizes = (dto.sizes ?? []).filter((s) => s.value?.trim());
    const labels = [...new Set((dto.labels ?? []).map((l) => l.trim()).filter(Boolean))].slice(0, 40);

    const specsJson: Prisma.InputJsonValue = {
      colors: colors.map((c) => ({ name: c.name.trim(), imageUrl: c.imageUrl.trim() })),
      materials: materials.map((m) => ({ name: m.name.trim() })),
      sizes: sizes.map((s) => ({ value: s.value.trim() })),
      labels,
    };

    const currency = (dto.currency?.trim().toUpperCase() || 'RUB').slice(0, 8);

    const data: Prisma.ProductUpdateInput = {
      slug: nextSlug,
      name: dto.name.trim(),
      category: { connect: { id: dto.categoryId } },
      brand: brandIdNorm ? { connect: { id: brandIdNorm } } : { disconnect: true },
      shortDescription: this.normProductShortDescription(dto.shortDescription),
      additionalInfoHtml: dto.additionalInfoHtml?.trim() || null,
      model3dUrl: dto.model3dUrl?.trim() || null,
      drawingUrl: dto.drawingUrl?.trim() || null,
      specsJson,
      sku,
      deliveryText: dto.deliveryText?.trim() || null,
      technicalSpecs: dto.technicalSpecs?.trim() || null,
      lengthMm: dto.lengthMm ?? null,
      widthMm: dto.widthMm ?? null,
      heightMm: dto.heightMm ?? null,
      volumeLiters: this.volumeCubicMetersFromBoxMm(
        dto.lengthMm ?? null,
        dto.widthMm ?? null,
        dto.heightMm ?? null,
      ),
      weightKg:
        dto.weightKg != null && Number.isFinite(dto.weightKg)
          ? new Prisma.Decimal(dto.weightKg)
          : null,
      netLengthMm: dto.netLengthMm ?? null,
      netWidthMm: dto.netWidthMm ?? null,
      netHeightMm: dto.netHeightMm ?? null,
      netVolumeLiters: this.volumeCubicMetersFromBoxMm(
        dto.netLengthMm ?? null,
        dto.netWidthMm ?? null,
        dto.netHeightMm ?? null,
      ),
      netWeightKg:
        dto.netWeightKg != null && Number.isFinite(dto.netWeightKg)
          ? new Prisma.Decimal(dto.netWeightKg)
          : null,
      seoTitle: dto.seoTitle?.trim() || null,
      seoDescription: dto.seoDescription?.trim() || null,
      price: new Prisma.Decimal(dto.price),
      currency,
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

        await tx.productImage.deleteMany({ where: { productId: id } });
        if (gallery.length > 0) {
          await tx.productImage.createMany({
            data: gallery.map((g, i) => ({
              productId: id,
              url: g.url.trim(),
              alt: g.alt?.trim() || null,
              sortOrder: i,
            })),
          });
        }

        const row = await tx.product.findUnique({
          where: { id },
          include: {
            images: { orderBy: { sortOrder: 'asc' } },
            category: true,
            brand: true,
            productCategories: { select: { categoryId: true } },
          },
        });
        if (!row) throw new BadRequestException('Не удалось прочитать товар после сохранения');
        return row;
      });
      void this.productSearchIndex.syncProduct(id);
      if (removedGalleryUrls.length) {
        void this.objectStorage
          .deleteProductImageObjectsForRemovedUrls(removedGalleryUrls)
          .catch((e) =>
            this.logger.warn(
              `Очистка S3 после смены галереи: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
      }
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
}
