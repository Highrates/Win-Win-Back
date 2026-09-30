import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import {
  buildCasePublicDto,
  buildProductSummaryMapForCases,
  roomTypesLabelsFromJson,
} from '../designers/case-public-dto.builder';

export type ProjectsFeedSource = 'all' | 'designers' | 'brands';

export type ProjectsFeedQuery = {
  source?: ProjectsFeedSource;
  brandSlug?: string;
  /** Дизайнерские кейсы, в которых есть товары этого бренда (slug). */
  productBrandSlug?: string;
  productId?: string;
  room?: string;
  hasProducts?: boolean;
  page?: number;
  limit?: number;
};

const caseSelect = {
  id: true,
  title: true,
  shortDescription: true,
  descriptionHtml: true,
  coverLayout: true,
  coverImageUrls: true,
  roomTypes: true,
  productIds: true,
  likesUserCount: true,
  likesAdminBoost: true,
  createdAt: true,
  user: {
    select: {
      designer: {
        select: { slug: true, displayName: true, photoUrl: true },
      },
      profile: { select: { avatarUrl: true } },
    },
  },
  brand: {
    select: { slug: true, name: true, logoUrl: true },
  },
} as const;

@Injectable()
export class ProjectsFeedService {
  constructor(
    private prisma: PrismaService,
    private catalog: CatalogService,
  ) {}

  private designerCaseWhere(): Prisma.CaseWhereInput {
    return {
      userId: { not: null },
      isPublished: true,
      user: {
        designer: { is: { isPublic: true } },
        profile: { is: { winWinPartnerApproved: true } },
      },
    };
  }

  private brandCaseWhere(brandSlug?: string): Prisma.CaseWhereInput {
    if (brandSlug?.trim()) {
      return {
        brandId: { not: null },
        isPublished: true,
        brand: { is: { isActive: true, slug: brandSlug.trim() } },
      };
    }
    return {
      brandId: { not: null },
      isPublished: true,
      brand: { is: { isActive: true } },
    };
  }

  private buildWhere(q: ProjectsFeedQuery): Prisma.CaseWhereInput {
    const source: ProjectsFeedSource =
      q.source === 'designers' || q.source === 'brands' || q.source === 'all'
        ? q.source
        : 'all';
    const brandSlug = q.brandSlug?.trim() || '';
    const productBrandSlug = q.productBrandSlug?.trim() || '';
    const productId = q.productId?.trim() || '';
    const room = q.room?.trim() || '';

    const ownership: Prisma.CaseWhereInput[] = [];
    if (source === 'all' || source === 'designers') {
      /** При фильтре `brand=` (проекты бренда) дизайнеров не смешиваем. */
      if (!brandSlug) {
        const designerWhere: Prisma.CaseWhereInput = {
          ...this.designerCaseWhere(),
          ...(productBrandSlug
            ? {
                caseProducts: {
                  some: { product: { brand: { is: { slug: productBrandSlug, isActive: true } } } },
                },
              }
            : {}),
        };
        ownership.push(designerWhere);
      }
    }
    if (source === 'all' || source === 'brands') {
      ownership.push(this.brandCaseWhere(brandSlug || undefined));
    }

    const and: Prisma.CaseWhereInput[] = [];
    if (ownership.length === 1) {
      and.push(ownership[0]!);
    } else if (ownership.length > 1) {
      and.push({ OR: ownership });
    } else {
      and.push({ id: '__none__' });
    }

    if (productId) {
      and.push({ caseProducts: { some: { productId } } });
    }
    if (q.hasProducts) {
      and.push({ caseProducts: { some: {} } });
    }
    if (room) {
      and.push({ roomTypes: { array_contains: room } });
    }

    return { AND: and };
  }

  async listFeed(q: ProjectsFeedQuery = {}) {
    const page = Number.isFinite(q.page) && (q.page ?? 0) > 0 ? Math.floor(q.page!) : 1;
    const limit = Math.min(
      60,
      Math.max(1, Number.isFinite(q.limit) ? Math.floor(q.limit!) : 48),
    );
    const where = this.buildWhere(q);

    const facetWhere = this.buildWhere({
      ...q,
      room: undefined,
    });

    const [total, caseRows, facetRows] = await Promise.all([
      this.prisma.case.count({ where }),
      this.prisma.case.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: caseSelect,
      }),
      this.prisma.case.findMany({
        where: facetWhere,
        select: { roomTypes: true },
        take: 2000,
      }),
    ]);

    const roomsSet = new Set<string>();
    for (const row of facetRows) {
      for (const label of roomTypesLabelsFromJson(row.roomTypes)) {
        roomsSet.add(label);
      }
    }
    const rooms = Array.from(roomsSet).sort((a, b) => a.localeCompare(b, 'ru'));

    const productById = await buildProductSummaryMapForCases(this.catalog, caseRows);
    const items = caseRows.map((c) => {
      if (c.brand) {
        return buildCasePublicDto(c, productById, null, {
          slug: c.brand.slug,
          displayName: c.brand.name,
          logoUrl: c.brand.logoUrl,
        });
      }
      const des = c.user?.designer;
      const prof = c.user?.profile;
      const designerPhoto = des?.photoUrl?.trim() || prof?.avatarUrl?.trim() || null;
      return buildCasePublicDto(c, productById, {
        slug: des?.slug ?? '',
        displayName: des?.displayName ?? '',
        photoUrl: designerPhoto,
      });
    });

    return { items, total, page, limit, rooms };
  }
}
