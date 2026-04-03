import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MediaLibraryService } from '../media-library/media-library.service';
import {
  CreateBrandAdminDto,
  CreateCategoryAdminDto,
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

@Injectable()
export class CatalogAdminService {
  constructor(
    private prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly mediaLibrary: MediaLibraryService,
  ) {}

  private normUrl(u: string): string {
    return u.trim().replace(/\/+$/, '');
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
    const groups = await this.prisma.product.groupBy({
      by: ['categoryId'],
      _count: { _all: true },
    });
    const direct = new Map<string, number>();
    for (const g of groups) {
      direct.set(g.categoryId, g._count._all);
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
          _count: { select: { products: true, children: true } },
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
          include: { _count: { select: { products: true, children: true } } },
        },
        products: {
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
        },
      },
    });
    if (!row) throw new NotFoundException('Category not found');
    return row;
  }

  /** Витрина: не более двух уровней — родитель новой подкатегории только корень. */
  private async assertParentIsRootCategory(parentId: string): Promise<void> {
    const parent = await this.prisma.category.findUnique({
      where: { id: parentId },
      select: { id: true, parentId: true },
    });
    if (!parent) throw new BadRequestException('Parent category not found');
    if (parent.parentId !== null) {
      throw new BadRequestException(
        'Подкатегорию можно создать только у корневой категории (максимум два уровня: корень → подкатегория)',
      );
    }
  }

  async createCategory(dto: CreateCategoryAdminDto) {
    const pid = dto.parentId?.trim() || null;
    if (pid) {
      await this.assertParentIsRootCategory(pid);
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
        _count: { select: { products: true, children: true } },
      },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryAdminDto) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Category not found');

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) throw new BadRequestException('Category cannot be its own parent');
      await this.assertParentIsRootCategory(dto.parentId);
      if (await this.isUnder(id, dto.parentId)) {
        throw new BadRequestException('Cannot set parent to a descendant of this category');
      }
      const descendants = await this.prisma.category.count({ where: { parentId: id } });
      if (existing.parentId === null && descendants > 0) {
        throw new BadRequestException(
          'Нельзя сделать подкатегорией корневую категорию, у которой уже есть подкатегории (максимум два уровня)',
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
          include: { _count: { select: { products: true, children: true } } },
        },
        products: {
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
        },
      },
    });

    if (
      backgroundPatch &&
      prevBackgroundMediaId &&
      prevBackgroundMediaId !== updated.backgroundMediaObjectId
    ) {
      await this.mediaLibrary.deleteMediaObjectIfUnreferenced(prevBackgroundMediaId);
    }

    return updated;
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
          include: { _count: { select: { products: true, children: true } } },
        });
        if (!row) {
          remaining.delete(id);
          progress = true;
          continue;
        }
        if (row._count.products > 0 || row._count.children > 0) {
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
}
