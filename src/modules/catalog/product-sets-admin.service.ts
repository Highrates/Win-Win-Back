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
import { CreateProductSetAdminDto, UpdateProductSetAdminDto } from './dto/product-sets-admin.dto';

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

function slugifySetName(name: string): string {
  const raw = transliterateRu(name)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return raw || 'nabor';
}

@Injectable()
export class ProductSetsAdminService {
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
    let slug = base.slice(0, 80) || 'nabor';
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? slug : `${slug}-${n}`;
      const exists = await this.prisma.curatedProductSet.findFirst({
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

  private async assertBrandIdOptional(brandId: string | null): Promise<void> {
    if (!brandId) return;
    const b = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!b) throw new BadRequestException('Бренд не найден');
  }

  async listForAdmin(q?: string) {
    const where =
      q && q.trim()
        ? { name: { contains: q.trim(), mode: 'insensitive' as const } }
        : {};
    const rows = await this.prisma.curatedProductSet.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { items: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      isActive: r.isActive,
      itemCount: r._count.items,
    }));
  }

  async getForAdmin(id: string) {
    const row = await this.prisma.curatedProductSet.findUnique({
      where: { id },
      include: {
        brand: { select: { id: true, name: true } },
        items: {
          orderBy: { sortOrder: 'asc' },
          include: { product: { select: { id: true, name: true, slug: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException('Набор не найден');
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      brandId: row.brandId,
      brand: row.brand,
      coverImageUrl: row.coverImageUrl,
      coverMediaObjectId: row.coverMediaObjectId,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      productItems: row.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        name: it.product.name,
        slug: it.product.slug,
        sortOrder: it.sortOrder,
      })),
    };
  }

  async create(dto: CreateProductSetAdminDto) {
    const baseSlug = dto.slug?.trim() ? dto.slug.trim() : slugifySetName(dto.name);
    const slug = await this.ensureUniqueSlug(baseSlug);
    const agg = await this.prisma.curatedProductSet.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (agg._max.sortOrder ?? -1) + 1;

    const bgRaw = (dto.coverImageUrl ?? '').trim();
    let coverUrl: string | null = null;
    let coverMediaId: string | null = null;
    if (bgRaw) {
      coverMediaId = await this.resolveCoverMediaId(bgRaw, dto.coverMediaObjectId ?? null);
      coverUrl = bgRaw;
    }

    const productIds = this.dedupeIdsPreserveOrder(dto.productIds ?? []);
    await this.assertProductsExist(productIds);

    const brandIdNorm =
      dto.brandId != null && String(dto.brandId).trim() !== ''
        ? String(dto.brandId).trim()
        : null;
    await this.assertBrandIdOptional(brandIdNorm);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const col = await tx.curatedProductSet.create({
          data: {
            slug,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            brandId: brandIdNorm,
            coverImageUrl: coverUrl,
            coverMediaObjectId: coverMediaId,
            seoTitle: dto.seoTitle?.trim() || null,
            seoDescription: dto.seoDescription?.trim() || null,
            isActive: dto.isActive ?? true,
            sortOrder,
          },
        });
        if (productIds.length) {
          await tx.curatedProductSetItem.createMany({
            data: productIds.map((productId, i) => ({
              setId: col.id,
              productId,
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

  async update(id: string, dto: UpdateProductSetAdminDto) {
    const existing = await this.prisma.curatedProductSet.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Набор не найден');

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

    const incomingProductIds =
      dto.productIds !== undefined ? this.dedupeIdsPreserveOrder(dto.productIds) : undefined;
    if (incomingProductIds !== undefined) await this.assertProductsExist(incomingProductIds);

    let brandIdPatch: { brandId: string | null } | undefined;
    if (dto.brandId !== undefined) {
      const norm = dto.brandId != null && String(dto.brandId).trim() !== '' ? String(dto.brandId).trim() : null;
      await this.assertBrandIdOptional(norm);
      brandIdPatch = { brandId: norm };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.curatedProductSet.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          slug: nextSlug,
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...brandIdPatch,
          ...coverPatch,
          ...(dto.seoTitle !== undefined ? { seoTitle: dto.seoTitle?.trim() || null } : {}),
          ...(dto.seoDescription !== undefined
            ? { seoDescription: dto.seoDescription?.trim() || null }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });

      if (incomingProductIds !== undefined) {
        await tx.curatedProductSetItem.deleteMany({ where: { setId: id } });
        if (incomingProductIds.length) {
          await tx.curatedProductSetItem.createMany({
            data: incomingProductIds.map((productId, i) => ({
              setId: id,
              productId,
              sortOrder: i,
            })),
          });
        }
      }
    });

    const updated = await this.prisma.curatedProductSet.findUnique({ where: { id } });
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
    const unique = Array.from(new Set(ids.map((x) => x.trim()).filter(Boolean)));
    if (!unique.length) return { deleted: [] as string[] };
    const rows = await this.prisma.curatedProductSet.findMany({
      where: { id: { in: unique } },
      select: { id: true, coverMediaObjectId: true },
    });
    const foundIds = rows.map((r) => r.id);
    const mediaIds = rows.map((r) => r.coverMediaObjectId).filter(Boolean) as string[];
    await this.prisma.curatedProductSet.deleteMany({ where: { id: { in: foundIds } } });
    for (const mid of mediaIds) {
      await this.mediaLibrary.deleteMediaObjectIfUnreferenced(mid);
    }
    return { deleted: foundIds };
  }
}
