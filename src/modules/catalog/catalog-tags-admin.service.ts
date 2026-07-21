import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { adminListResult, parseAdminListQuery } from '../../common/admin-list-pagination';
import { ObjectStorageService } from '../storage/object-storage.service';
import { MediaLibraryService } from '../media-library/media-library.service';
import { slugifyProductBase } from './slug-transliteration';
import {
  CreateCatalogTagAdminDto,
  UpdateCatalogTagAdminDto,
} from './dto/catalog-tags-admin.dto';

@Injectable()
export class CatalogTagsAdminService {
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

  private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = base.slice(0, 80) || 'tag';
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? slug : `${slug}-${n}`;
      const exists = await this.prisma.catalogTag.findFirst({
        where: excludeId ? { slug: candidate, NOT: { id: excludeId } } : { slug: candidate },
      });
      if (!exists) return candidate;
      n += 1;
    }
  }

  private async assertProductsExist(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const n = await this.prisma.product.count({ where: { id: { in: ids } } });
    if (n !== ids.length) throw new BadRequestException('Один из товаров не найден');
  }

  private async syncTagProducts(tx: Prisma.TransactionClient, tagId: string, productIds: string[]) {
    await tx.productCatalogTag.deleteMany({ where: { tagId } });
    if (productIds.length) {
      await tx.productCatalogTag.createMany({
        data: productIds.map((productId) => ({ tagId, productId })),
      });
    }
  }

  /** Все теги для селектов в форме товара и фильтрах. */
  async listAllOptions() {
    return this.prisma.catalogTag.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, sortOrder: true },
    });
  }

  async listForAdmin(q?: string, pageRaw?: number, limitRaw?: number) {
    const trim = q?.trim();
    const where = trim
      ? {
          OR: [
            { name: { contains: trim, mode: 'insensitive' as const } },
            { slug: { contains: trim, mode: 'insensitive' as const } },
          ],
        }
      : {};

    if (!trim) {
      const rows = await this.prisma.catalogTag.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { products: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        sortOrder: r.sortOrder,
        productCount: r._count.products,
      }));
    }

    const { page, limit, skip } = parseAdminListQuery(pageRaw, limitRaw);
    const [rows, total] = await Promise.all([
      this.prisma.catalogTag.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { products: true } } },
      }),
      this.prisma.catalogTag.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      sortOrder: r.sortOrder,
      productCount: r._count.products,
    }));
    return adminListResult(items, total, page, limit);
  }

  async getForAdmin(id: string) {
    const row = await this.prisma.catalogTag.findUnique({
      where: { id },
      include: {
        products: {
          include: { product: { select: { id: true, name: true, slug: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException('Контекстный тег не найден');
    const productItems = row.products
      .map((it) => ({
        productId: it.productId,
        name: it.product.name,
        slug: it.product.slug,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      sortOrder: row.sortOrder,
      coverImageUrl: row.coverImageUrl,
      coverMediaObjectId: row.coverMediaObjectId,
      productItems,
    };
  }

  async create(dto: CreateCatalogTagAdminDto) {
    const baseSlug = dto.slug?.trim() ? dto.slug.trim() : slugifyProductBase(dto.name);
    const slug = await this.ensureUniqueSlug(baseSlug);
    const agg = await this.prisma.catalogTag.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;
    const productIds = this.dedupeIdsPreserveOrder(dto.productIds ?? []);
    await this.assertProductsExist(productIds);

    const bgRaw = (dto.coverImageUrl ?? '').trim();
    let coverUrl: string | null = null;
    let coverMediaId: string | null = null;
    if (bgRaw) {
      coverUrl = bgRaw;
      coverMediaId = await this.resolveCoverMediaId(bgRaw, dto.coverMediaObjectId ?? null);
    }

    try {
      const createdId = await this.prisma.$transaction(async (tx) => {
        const tag = await tx.catalogTag.create({
          data: {
            slug,
            name: dto.name.trim(),
            sortOrder,
            coverImageUrl: coverUrl,
            coverMediaObjectId: coverMediaId,
          },
        });
        await this.syncTagProducts(tx, tag.id, productIds);
        return tag.id;
      });
      return this.getForAdmin(createdId);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Такой slug уже занят');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateCatalogTagAdminDto) {
    const existing = await this.prisma.catalogTag.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Контекстный тег не найден');

    let nextSlug = existing.slug;
    if (dto.slug !== undefined && dto.slug.trim() && dto.slug.trim() !== existing.slug) {
      nextSlug = await this.ensureUniqueSlug(dto.slug.trim(), id);
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

    const productIds =
      dto.productIds !== undefined ? this.dedupeIdsPreserveOrder(dto.productIds) : undefined;
    if (productIds !== undefined) await this.assertProductsExist(productIds);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.catalogTag.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            slug: nextSlug,
            ...coverPatch,
          },
        });
        if (productIds !== undefined) {
          await this.syncTagProducts(tx, id, productIds);
        }
      });

      const updated = await this.prisma.catalogTag.findUnique({ where: { id } });
      if (
        coverPatch &&
        prevCoverMediaId &&
        prevCoverMediaId !== updated?.coverMediaObjectId
      ) {
        await this.mediaLibrary.deleteMediaObjectIfUnreferenced(prevCoverMediaId);
      }

      return this.getForAdmin(id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Такой slug уже занят');
      }
      throw e;
    }
  }

  async deleteMany(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return { deleted: [] as string[] };

    const rows = await this.prisma.catalogTag.findMany({
      where: { id: { in: unique } },
      select: { id: true, coverMediaObjectId: true },
    });
    const mediaIds = rows.map((r) => r.coverMediaObjectId).filter(Boolean) as string[];

    await this.prisma.catalogTag.deleteMany({ where: { id: { in: unique } } });

    for (const mid of mediaIds) {
      await this.mediaLibrary.deleteMediaObjectIfUnreferenced(mid);
    }

    return { deleted: unique };
  }

  async reorder(orderedIds: string[]) {
    const rows = await this.prisma.catalogTag.findMany({ select: { id: true } });
    const set = new Set(rows.map((r) => r.id));
    if (orderedIds.length !== set.size || !orderedIds.every((id) => set.has(id))) {
      throw new BadRequestException('orderedIds must list every tag exactly once');
    }
    await this.prisma.$transaction(async (tx) => {
      for (let index = 0; index < orderedIds.length; index++) {
        await tx.catalogTag.update({
          where: { id: orderedIds[index] },
          data: { sortOrder: index },
        });
      }
    });
    return { ok: true as const };
  }
}
