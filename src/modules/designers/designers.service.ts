import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { sanitizeProfileAboutHtml } from '../blog/blog-html.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';

const designerPartnerWhere = {
  isPublic: true,
  user: {
    profile: {
      is: { winWinPartnerApproved: true },
    },
  },
} satisfies Prisma.DesignerWhereInput;

const profilePublicSelect = {
  city: true,
  services: true,
  avatarUrl: true,
  firstName: true,
  lastName: true,
  coverImageUrls: true,
  coverLayout: true,
  aboutHtml: true,
} as const;

function parseCoverUrls(raw: Prisma.JsonValue): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function servicesLineFromJson(raw: Prisma.JsonValue): string | null {
  if (Array.isArray(raw)) {
    const parts = raw
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

function parseStringIds(raw: Prisma.JsonValue | null | undefined, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, max);
}

/** Порядок как в кейсе; без дублей по точному совпадению строки. */
function roomTypesLabelsFromJson(raw: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

type ProductSummary = {
  id: string;
  slug: string;
  name: string;
  price: number;
  imageUrl: string | null;
  casesLinkedCount: number;
};

type CaseRowForPublicMap = {
  id: string;
  title: string;
  shortDescription: string | null;
  descriptionHtml: string | null;
  coverLayout: string | null;
  coverImageUrls: Prisma.JsonValue | null;
  roomTypes: Prisma.JsonValue | null;
  productIds: Prisma.JsonValue | null;
};

@Injectable()
export class DesignersService {
  constructor(
    private prisma: PrismaService,
    private catalog: CatalogService,
  ) {}

  private collectProductIdsFromCaseRows(rows: Array<{ productIds: Prisma.JsonValue | null }>): string[] {
    const all = new Set<string>();
    for (const c of rows) {
      for (const id of parseStringIds(c.productIds, 80)) {
        all.add(id);
      }
    }
    return [...all];
  }

  private async buildProductByIdMap(
    rows: Array<{ productIds: Prisma.JsonValue | null }>,
  ): Promise<Map<string, ProductSummary>> {
    const ids = this.collectProductIdsFromCaseRows(rows);
    if (!ids.length) return new Map();
    const { items } = await this.catalog.resolveProductSummariesByIds(ids);
    return new Map(items.map((p) => [p.id, p]));
  }

  private mapCaseRowToPublicDto(c: CaseRowForPublicMap, productById: Map<string, ProductSummary>) {
    const pids = parseStringIds(c.productIds, 80);
    const coverUrls = parseCoverUrls(c.coverImageUrls ?? null);
    const layoutCase = c.coverLayout === '16:9' ? ('16:9' as const) : ('4:3' as const);
    const rawDesc = c.descriptionHtml?.trim() ? c.descriptionHtml.trim() : '';
    const descriptionHtml = rawDesc ? sanitizeProfileAboutHtml(rawDesc) : null;
    const products = pids.map((id) => {
      const p = productById.get(id);
      if (!p || !p.slug)
        return {
          id,
          slug: '',
          name: 'Товар',
          price: 0,
          imageUrl: null as string | null,
          casesLinkedCount: 0,
        };
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        price: p.price,
        imageUrl: p.imageUrl,
        casesLinkedCount: p.casesLinkedCount,
      };
    });
    return {
      id: c.id,
      title: c.title,
      shortDescription: c.shortDescription?.trim() || null,
      placesLine: servicesLineFromJson(c.roomTypes ?? null),
      roomTypes: roomTypesLabelsFromJson(c.roomTypes ?? null),
      descriptionHtml,
      coverLayout: layoutCase,
      coverImageUrls: coverUrls,
      products,
    };
  }

  async findAll(page = 1, limit = 20, qRaw?: string) {
    const q = qRaw?.trim();
    const where: Prisma.DesignerWhereInput = q?.length
      ? {
          AND: [
            designerPartnerWhere,
            {
              OR: [
                { displayName: { contains: q, mode: 'insensitive' } },
                { slug: { contains: q, mode: 'insensitive' } },
                {
                  user: {
                    profile: {
                      city: { contains: q, mode: 'insensitive' },
                    },
                  },
                },
              ],
            },
          ],
        }
      : designerPartnerWhere;
    const [rows, total] = await Promise.all([
      this.prisma.designer.findMany({
        where,
        orderBy: { sortOrder: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: {
              profile: { select: profilePublicSelect },
            },
          },
        },
      }),
      this.prisma.designer.count({ where }),
    ]);

    const items = rows.map((d) => {
      const prof = d.user.profile;
      const photo = d.photoUrl?.trim() || prof?.avatarUrl?.trim() || null;
      return {
        slug: d.slug,
        displayName: d.displayName,
        photoUrl: photo,
        city: prof?.city?.trim() || null,
        servicesLine: servicesLineFromJson(prof?.services ?? null),
      };
    });

    return { items, total, page, limit };
  }

  async findBySlug(slug: string) {
    const row = await this.prisma.designer.findFirst({
      where: { slug, ...designerPartnerWhere },
      include: {
        user: {
          select: {
            profile: { select: profilePublicSelect },
          },
        },
      },
    });
    if (!row) throw new NotFoundException();

    const prof = row.user.profile;
    const coverUrls = parseCoverUrls(prof?.coverImageUrls ?? null);
    const layout = prof?.coverLayout === '16:9' ? '16:9' : '4:3';
    const photo = row.photoUrl?.trim() || prof?.avatarUrl?.trim() || null;
    const rawAbout = prof?.aboutHtml?.trim() ? prof.aboutHtml.trim() : '';
    const aboutHtml = rawAbout ? sanitizeProfileAboutHtml(rawAbout) : null;

    const caseRows = await this.prisma.case.findMany({
      where: { userId: row.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        shortDescription: true,
        descriptionHtml: true,
        coverLayout: true,
        coverImageUrls: true,
        roomTypes: true,
        productIds: true,
      },
    });

    const productById = await this.buildProductByIdMap(caseRows);
    const cases = caseRows.map((c) => this.mapCaseRowToPublicDto(c, productById));

    return {
      slug: row.slug,
      displayName: row.displayName,
      photoUrl: photo,
      city: prof?.city?.trim() || null,
      servicesLine: servicesLineFromJson(prof?.services ?? null),
      coverLayout: layout,
      coverImageUrls: coverUrls,
      aboutHtml,
      cases,
    };
  }

  /** Кейсы всех публичных партнёров-дизайнеров (новые сверху) для страницы «Проекты». */
  async listAllPublicCases(productIdRaw?: string) {
    const productId = productIdRaw?.trim();
    const caseRows = await this.prisma.case.findMany({
      where: {
        ...(productId
          ? { caseProducts: { some: { productId } } }
          : {}),
        user: {
          designer: { is: { isPublic: true } },
          profile: { is: { winWinPartnerApproved: true } },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        shortDescription: true,
        descriptionHtml: true,
        coverLayout: true,
        coverImageUrls: true,
        roomTypes: true,
        productIds: true,
        user: {
          select: {
            designer: {
              select: { slug: true, displayName: true, photoUrl: true },
            },
            profile: { select: { avatarUrl: true } },
          },
        },
      },
    });

    const productById = await this.buildProductByIdMap(caseRows);

    const items = caseRows
      .filter((c) => c.user.designer != null)
      .map((c) => {
        const des = c.user.designer!;
        const prof = c.user.profile;
        const designerPhoto = des.photoUrl?.trim() || prof?.avatarUrl?.trim() || null;
        const base = this.mapCaseRowToPublicDto(c, productById);
        return {
          designerSlug: des.slug,
          designerDisplayName: des.displayName,
          designerPhotoUrl: designerPhoto,
          ...base,
        };
      });

    return { items };
  }
}
