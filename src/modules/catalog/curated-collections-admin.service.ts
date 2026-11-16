import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CuratedCollectionKind,
  CuratedHomeGridSize,
  CuratedHomeOrderMode,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { adminListResult, parseAdminListQuery } from '../../common/admin-list-pagination';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MediaLibraryService } from '../media-library/media-library.service';
import {
  CreateCuratedCollectionAdminDto,
  UpdateCuratedCollectionAdminDto,
} from './dto/curated-collections-admin.dto';
import { computeHomePreviewCount } from './home-rails.utils';

type HomeSettingsInput = {
  showOnHome?: boolean;
  homeOrder?: number | null;
  homeGridSize?: CuratedHomeGridSize;
  homeOrderMode?: CuratedHomeOrderMode;
  homePriceMin?: number | null;
  homePriceMax?: number | null;
};

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

function slugifyCuratedName(name: string): string {
  const raw = transliterateRu(name)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return raw || 'collection';
}

@Injectable()
export class CuratedCollectionsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
    private readonly mediaLibrary: MediaLibraryService,
  ) {}

  private normUrl(u: string): string {
    return u.trim().replace(/\/+$/, '');
  }

  private async resolveCoverMediaId(
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

  private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = base.slice(0, 80) || 'collection';
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? slug : `${slug}-${n}`;
      const exists = await this.prisma.curatedCollection.findFirst({
        where: excludeId ? { slug: candidate, NOT: { id: excludeId } } : { slug: candidate },
      });
      if (!exists) return candidate;
      n += 1;
    }
  }

  private dedupeIdsPreserveOrder(ids: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
      const t = typeof id === 'string' ? id.trim() : '';
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  private async assertProductsExist(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const n = await this.prisma.product.count({ where: { id: { in: ids } } });
    if (n !== ids.length) throw new BadRequestException('Один из товаров не найден');
  }

  private async assertBrandsExist(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const n = await this.prisma.brand.count({ where: { id: { in: ids } } });
    if (n !== ids.length) throw new BadRequestException('Один из брендов не найден');
  }

  private async resolveHomeSettings(
    kind: CuratedCollectionKind,
    input: HomeSettingsInput,
    opts?: {
      excludeId?: string;
      isActive?: boolean;
      existing?: {
        showOnHome: boolean;
        homeOrder: number | null;
        homeGridSize: CuratedHomeGridSize;
        homeOrderMode: CuratedHomeOrderMode;
        homePriceMin: number | null;
        homePriceMax: number | null;
      };
    },
  ): Promise<{
    showOnHome: boolean;
    homeOrder: number | null;
    homeGridSize: CuratedHomeGridSize;
    homeOrderMode: CuratedHomeOrderMode;
    homePriceMin: number | null;
    homePriceMax: number | null;
  }> {
    const existing = opts?.existing;
    const isActive = opts?.isActive ?? true;

    if (kind !== CuratedCollectionKind.PRODUCT) {
      return {
        showOnHome: false,
        homeOrder: null,
        homeGridSize: CuratedHomeGridSize.FOUR,
        homeOrderMode: CuratedHomeOrderMode.FIXED,
        homePriceMin: null,
        homePriceMax: null,
      };
    }

    // Скрытая коллекция не держит слот на главной.
    let showOnHome = input.showOnHome ?? existing?.showOnHome ?? false;
    if (!isActive) showOnHome = false;

    const homeOrder =
      input.homeOrder !== undefined ? input.homeOrder : (existing?.homeOrder ?? null);
    const homeGridSize =
      input.homeGridSize ?? existing?.homeGridSize ?? CuratedHomeGridSize.FOUR;
    const homeOrderMode =
      input.homeOrderMode ?? existing?.homeOrderMode ?? CuratedHomeOrderMode.FIXED;
    let homePriceMin =
      input.homePriceMin !== undefined ? input.homePriceMin : (existing?.homePriceMin ?? null);
    let homePriceMax =
      input.homePriceMax !== undefined ? input.homePriceMax : (existing?.homePriceMax ?? null);

    if (!showOnHome) {
      return {
        showOnHome: false,
        homeOrder: null,
        homeGridSize,
        homeOrderMode: CuratedHomeOrderMode.FIXED,
        homePriceMin: null,
        homePriceMax: null,
      };
    }

    if (homeOrder == null || !Number.isInteger(homeOrder) || homeOrder < 1) {
      throw new BadRequestException('Для вывода на главную укажите порядок (homeOrder ≥ 1)');
    }

    const clash = await this.prisma.curatedCollection.findFirst({
      where: {
        showOnHome: true,
        isActive: true,
        homeOrder,
        ...(opts?.excludeId ? { NOT: { id: opts.excludeId } } : {}),
      },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new ConflictException(
        `Порядок ${homeOrder} на главной уже занят коллекцией «${clash.name}»`,
      );
    }

    if (homeOrderMode !== CuratedHomeOrderMode.RANDOM) {
      homePriceMin = null;
      homePriceMax = null;
    } else if (
      homePriceMin != null &&
      homePriceMax != null &&
      homePriceMin > homePriceMax
    ) {
      throw new BadRequestException('Цена «от» не может быть больше «до»');
    }

    return {
      showOnHome: true,
      homeOrder,
      homeGridSize,
      homeOrderMode,
      homePriceMin,
      homePriceMax,
    };
  }

  async listForAdmin(q?: string, pageRaw?: number, limitRaw?: number) {
    const trim = q?.trim();
    const where =
      trim ? { name: { contains: trim, mode: 'insensitive' as const } } : {};

    if (!trim) {
      const rows = await this.prisma.curatedCollection.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { productItems: true, brandItems: true } },
        },
      });
      return rows.map((r) => this.mapListRow(r));
    }

    const { page, limit, skip } = parseAdminListQuery(pageRaw, limitRaw);
    const [rows, total] = await Promise.all([
      this.prisma.curatedCollection.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { productItems: true, brandItems: true } },
        },
      }),
      this.prisma.curatedCollection.count({ where }),
    ]);
    const items = rows.map((r) => this.mapListRow(r));
    return adminListResult(items, total, page, limit);
  }

  private mapListRow(r: {
    id: string;
    name: string;
    slug: string;
    kind: CuratedCollectionKind;
    isActive: boolean;
    sortOrder: number;
    showOnHome: boolean;
    homeOrder: number | null;
    _count: { productItems: number; brandItems: number };
  }) {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      kind: r.kind,
      isActive: r.isActive,
      sortOrder: r.sortOrder,
      showOnHome: r.showOnHome,
      homeOrder: r.homeOrder,
      itemCount: r.kind === CuratedCollectionKind.PRODUCT ? r._count.productItems : r._count.brandItems,
    };
  }

  async getForAdmin(id: string) {
    const row = await this.prisma.curatedCollection.findUnique({
      where: { id },
      include: {
        productItems: {
          orderBy: { sortOrder: 'asc' },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                isActive: true,
                variants: {
                  where: { isActive: true },
                  orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
                  take: 1,
                  select: { price: true },
                },
              },
            },
          },
        },
        brandItems: {
          orderBy: { sortOrder: 'asc' },
          include: { brand: { select: { id: true, name: true, slug: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException('Коллекция не найдена');

    const activeProductPrices = row.productItems
      .filter((it) => it.product.isActive)
      .map((it) => {
        const raw = it.product.variants[0]?.price;
        if (raw == null) return null;
        const n = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(n) ? n : null;
      });

    const homePreviewCount = computeHomePreviewCount({
      showOnHome: row.showOnHome,
      isActive: row.isActive,
      homeGridSize: row.homeGridSize,
      homeOrderMode: row.homeOrderMode,
      homePriceMin: row.homePriceMin,
      homePriceMax: row.homePriceMax,
      prices: activeProductPrices,
    });

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      coverImageUrl: row.coverImageUrl,
      coverMediaObjectId: row.coverMediaObjectId,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      kind: row.kind,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      showOnHome: row.showOnHome,
      homeOrder: row.homeOrder,
      homeGridSize: row.homeGridSize,
      homeOrderMode: row.homeOrderMode,
      homePriceMin: row.homePriceMin,
      homePriceMax: row.homePriceMax,
      /** Сколько карточек уйдёт на главную при текущих настройках (0 → warn в UI). */
      homePreviewCount,
      productItems: row.productItems.map((it) => {
        const raw = it.product.variants[0]?.price;
        let price: number | null = null;
        if (raw != null) {
          const n = typeof raw === 'number' ? raw : Number(raw);
          price = Number.isFinite(n) ? n : null;
        }
        return {
          id: it.id,
          productId: it.productId,
          name: it.product.name,
          slug: it.product.slug,
          sortOrder: it.sortOrder,
          isActive: it.product.isActive,
          /** Base variant price (без tier) — для live preview в админке. */
          price,
        };
      }),
      brandItems: row.brandItems.map((it) => ({
        id: it.id,
        brandId: it.brandId,
        name: it.brand.name,
        slug: it.brand.slug,
        sortOrder: it.sortOrder,
      })),
    };
  }

  async create(dto: CreateCuratedCollectionAdminDto) {
    const baseSlug = dto.slug?.trim() ? dto.slug.trim() : slugifyCuratedName(dto.name);
    const slug = await this.ensureUniqueSlug(baseSlug);
    const agg = await this.prisma.curatedCollection.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;

    const bgRaw = (dto.coverImageUrl ?? '').trim();
    let coverUrl: string | null = null;
    let coverMediaId: string | null = null;
    if (bgRaw) {
      coverMediaId = await this.resolveCoverMediaId(bgRaw, dto.coverMediaObjectId ?? null);
      coverUrl = bgRaw;
    }

    const productIds =
      dto.kind === CuratedCollectionKind.PRODUCT
        ? this.dedupeIdsPreserveOrder(dto.productIds ?? [])
        : [];
    const brandIds =
      dto.kind === CuratedCollectionKind.BRAND
        ? this.dedupeIdsPreserveOrder(dto.brandIds ?? [])
        : [];

    if (dto.kind === CuratedCollectionKind.PRODUCT) {
      await this.assertProductsExist(productIds);
    } else {
      await this.assertBrandsExist(brandIds);
    }

    const home = await this.resolveHomeSettings(dto.kind, dto, {
      isActive: dto.isActive ?? true,
    });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const col = await tx.curatedCollection.create({
          data: {
            slug,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            coverImageUrl: coverUrl,
            coverMediaObjectId: coverMediaId,
            seoTitle: dto.seoTitle?.trim() || null,
            seoDescription: dto.seoDescription?.trim() || null,
            kind: dto.kind,
            isActive: dto.isActive ?? true,
            sortOrder,
            ...home,
          },
        });
        if (productIds.length) {
          await tx.curatedCollectionProductItem.createMany({
            data: productIds.map((productId, i) => ({
              collectionId: col.id,
              productId,
              sortOrder: i,
            })),
          });
        }
        if (brandIds.length) {
          await tx.curatedCollectionBrandItem.createMany({
            data: brandIds.map((brandId, i) => ({
              collectionId: col.id,
              brandId,
              sortOrder: i,
            })),
          });
        }
        return col.id;
      });
      return this.getForAdmin(created);
    } catch (e) {
      throw this.mapUniqueConflict(e);
    }
  }

  private mapUniqueConflict(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = Array.isArray(e.meta?.target)
        ? (e.meta.target as string[]).join(',')
        : String(e.meta?.target ?? '');
      if (target.includes('homeOrder') || target.includes('active_home')) {
        throw new ConflictException('Этот порядок на главной уже занят');
      }
      throw new ConflictException('Такой slug уже занят');
    }
    throw e;
  }

  async update(id: string, dto: UpdateCuratedCollectionAdminDto) {
    const existing = await this.prisma.curatedCollection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Коллекция не найдена');

    let nextSlug = existing.slug;
    if (dto.slug !== undefined && dto.slug.trim() && dto.slug.trim() !== existing.slug) {
      nextSlug = await this.ensureUniqueSlug(dto.slug.trim(), id);
    }

    let nextKind = existing.kind;
    if (dto.kind !== undefined && dto.kind !== existing.kind) {
      nextKind = dto.kind;
    }

    let coverPatch:
      | { coverImageUrl: string | null; coverMediaObjectId: string | null }
      | undefined;
    if (dto.coverImageUrl !== undefined) {
      const raw = dto.coverImageUrl;
      if (raw === null || (typeof raw === 'string' && !raw.trim())) {
        coverPatch = { coverImageUrl: null, coverMediaObjectId: null };
      } else {
        const url = String(raw).trim();
        const mid = await this.resolveCoverMediaId(
          url,
          dto.coverMediaObjectId !== undefined ? dto.coverMediaObjectId : undefined,
        );
        coverPatch = { coverImageUrl: url, coverMediaObjectId: mid };
      }
    }

    const prevCoverMediaId = existing.coverMediaObjectId;

    const incomingProductIds =
      dto.productIds !== undefined ? this.dedupeIdsPreserveOrder(dto.productIds) : undefined;
    const incomingBrandIds =
      dto.brandIds !== undefined ? this.dedupeIdsPreserveOrder(dto.brandIds) : undefined;

    if (incomingProductIds !== undefined) await this.assertProductsExist(incomingProductIds);
    if (incomingBrandIds !== undefined) await this.assertBrandsExist(incomingBrandIds);

    const kindChanged = dto.kind !== undefined && dto.kind !== existing.kind;

    const nextIsActive = dto.isActive !== undefined ? dto.isActive : existing.isActive;
    const home = await this.resolveHomeSettings(nextKind, dto, {
      excludeId: id,
      isActive: nextIsActive,
      existing: {
        showOnHome: existing.showOnHome,
        homeOrder: existing.homeOrder,
        homeGridSize: existing.homeGridSize,
        homeOrderMode: existing.homeOrderMode,
        homePriceMin: existing.homePriceMin,
        homePriceMax: existing.homePriceMax,
      },
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        if (kindChanged) {
          await tx.curatedCollectionProductItem.deleteMany({ where: { collectionId: id } });
          await tx.curatedCollectionBrandItem.deleteMany({ where: { collectionId: id } });
        }

        await tx.curatedCollection.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            slug: nextSlug,
            ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
            ...coverPatch,
            ...(dto.seoTitle !== undefined ? { seoTitle: dto.seoTitle?.trim() || null } : {}),
            ...(dto.seoDescription !== undefined
              ? { seoDescription: dto.seoDescription?.trim() || null }
              : {}),
            ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...home,
          },
        });

        if (kindChanged) {
          if (nextKind === CuratedCollectionKind.PRODUCT) {
            const ids = incomingProductIds ?? [];
            if (ids.length) {
              await tx.curatedCollectionProductItem.createMany({
                data: ids.map((productId, i) => ({
                  collectionId: id,
                  productId,
                  sortOrder: i,
                })),
              });
            }
          } else {
            const ids = incomingBrandIds ?? [];
            if (ids.length) {
              await tx.curatedCollectionBrandItem.createMany({
                data: ids.map((brandId, i) => ({
                  collectionId: id,
                  brandId,
                  sortOrder: i,
                })),
              });
            }
          }
        } else {
          if (existing.kind === CuratedCollectionKind.PRODUCT && incomingProductIds !== undefined) {
            await tx.curatedCollectionProductItem.deleteMany({ where: { collectionId: id } });
            if (incomingProductIds.length) {
              await tx.curatedCollectionProductItem.createMany({
                data: incomingProductIds.map((productId, i) => ({
                  collectionId: id,
                  productId,
                  sortOrder: i,
                })),
              });
            }
          }
          if (existing.kind === CuratedCollectionKind.BRAND && incomingBrandIds !== undefined) {
            await tx.curatedCollectionBrandItem.deleteMany({ where: { collectionId: id } });
            if (incomingBrandIds.length) {
              await tx.curatedCollectionBrandItem.createMany({
                data: incomingBrandIds.map((brandId, i) => ({
                  collectionId: id,
                  brandId,
                  sortOrder: i,
                })),
              });
            }
          }
        }
      });
    } catch (e) {
      this.mapUniqueConflict(e);
    }

    const updated = await this.prisma.curatedCollection.findUnique({ where: { id } });
    if (
      coverPatch &&
      prevCoverMediaId &&
      prevCoverMediaId !== updated?.coverMediaObjectId
    ) {
      await this.mediaLibrary.deleteMediaObjectIfUnreferenced(prevCoverMediaId);
    }

    return this.getForAdmin(id);
  }

  async deleteMany(ids: string[]) {
    const unique = [...new Set(ids.map((x) => x.trim()).filter(Boolean))];
    if (!unique.length) return { deleted: [] as string[] };
    const rows = await this.prisma.curatedCollection.findMany({
      where: { id: { in: unique } },
      select: { id: true, coverMediaObjectId: true },
    });
    const foundIds = rows.map((r) => r.id);
    const mediaIds = rows.map((r) => r.coverMediaObjectId).filter(Boolean) as string[];
    await this.prisma.curatedCollection.deleteMany({ where: { id: { in: foundIds } } });
    for (const mid of mediaIds) {
      await this.mediaLibrary.deleteMediaObjectIfUnreferenced(mid);
    }
    return { deleted: foundIds };
  }

  async reorder(orderedIds: string[]) {
    const rows = await this.prisma.curatedCollection.findMany({ select: { id: true } });
    const set = new Set(rows.map((r) => r.id));
    if (orderedIds.length !== set.size || !orderedIds.every((id) => set.has(id))) {
      throw new BadRequestException('orderedIds must list every collection exactly once');
    }
    await this.prisma.$transaction(async (tx) => {
      for (let index = 0; index < orderedIds.length; index++) {
        await tx.curatedCollection.update({
          where: { id: orderedIds[index] },
          data: { sortOrder: index },
        });
      }
    });
    return { ok: true as const };
  }
}
