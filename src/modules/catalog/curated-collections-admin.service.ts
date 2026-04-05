import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CuratedCollectionKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MediaLibraryService } from '../media-library/media-library.service';
import {
  CreateCuratedCollectionAdminDto,
  UpdateCuratedCollectionAdminDto,
} from './dto/curated-collections-admin.dto';

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

  async listForAdmin(q?: string) {
    const where =
      q && q.trim()
        ? { name: { contains: q.trim(), mode: 'insensitive' as const } }
        : {};
    const rows = await this.prisma.curatedCollection.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { productItems: true, brandItems: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      kind: r.kind,
      isActive: r.isActive,
      itemCount: r.kind === CuratedCollectionKind.PRODUCT ? r._count.productItems : r._count.brandItems,
    }));
  }

  async getForAdmin(id: string) {
    const row = await this.prisma.curatedCollection.findUnique({
      where: { id },
      include: {
        productItems: {
          orderBy: { sortOrder: 'asc' },
          include: { product: { select: { id: true, name: true, slug: true } } },
        },
        brandItems: {
          orderBy: { sortOrder: 'asc' },
          include: { brand: { select: { id: true, name: true, slug: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException('Коллекция не найдена');
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
      productItems: row.productItems.map((it) => ({
        id: it.id,
        productId: it.productId,
        name: it.product.name,
        slug: it.product.slug,
        sortOrder: it.sortOrder,
      })),
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
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Такой slug уже занят');
      }
      throw e;
    }
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
}
