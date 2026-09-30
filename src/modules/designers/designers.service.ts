import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { sanitizeProfileAboutHtml } from '../blog/blog-html.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import {
  buildCasePublicCore,
  buildCasePublicDto,
  buildProductSummaryMapForCases,
  parseCoverUrls,
  servicesLineFromJson,
} from './case-public-dto.builder';

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

@Injectable()
export class DesignersService {
  constructor(
    private prisma: PrismaService,
    private catalog: CatalogService,
  ) {}

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
        select: {
          id: true,
          userId: true,
          slug: true,
          displayName: true,
          photoUrl: true,
          likesUserCount: true,
          user: {
            select: {
              profile: { select: profilePublicSelect },
            },
          },
        },
      }),
      this.prisma.designer.count({ where }),
    ]);

    const caseCountsByUserId = new Map<string, number>();
    const userIds = rows.map((r) => r.userId).filter(Boolean);
    if (userIds.length) {
      const grouped = await this.prisma.case.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _count: { _all: true },
      });
      for (const g of grouped) {
        if (g.userId) caseCountsByUserId.set(g.userId, g._count._all);
      }
    }

    const items = rows.map((d) => {
      const prof = d.user.profile;
      const photo = d.photoUrl?.trim() || prof?.avatarUrl?.trim() || null;
      return {
        id: d.id,
        slug: d.slug,
        displayName: d.displayName,
        photoUrl: photo,
        city: prof?.city?.trim() || null,
        servicesLine: servicesLineFromJson(prof?.services ?? null),
        likesDisplayCount: Math.max(0, d.likesUserCount ?? 0),
        casesCount: Math.max(0, caseCountsByUserId.get(d.userId) ?? 0),
      };
    });

    return { items, total, page, limit };
  }

  async findBySlug(slug: string, casesPage = 1, casesLimit = 36, hasProducts = false) {
    const page = Number.isFinite(casesPage) && casesPage > 0 ? Math.floor(casesPage) : 1;
    const limit = Math.min(60, Math.max(1, Number.isFinite(casesLimit) ? Math.floor(casesLimit) : 36));

    const row = await this.prisma.designer.findFirst({
      where: { slug, ...designerPartnerWhere },
      select: {
        id: true,
        userId: true,
        slug: true,
        displayName: true,
        photoUrl: true,
        likesUserCount: true,
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

    const casesCount = await this.prisma.case.count({
      where: { userId: row.userId, isPublished: true },
    });
    const casesWhere: Prisma.CaseWhereInput = {
      userId: row.userId,
      isPublished: true,
      ...(hasProducts ? { caseProducts: { some: {} } } : {}),
    };
    const casesTotal = await this.prisma.case.count({ where: casesWhere });
    const caseRows = await this.prisma.case.findMany({
      where: casesWhere,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
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
      },
    });

    const productById = await buildProductSummaryMapForCases(this.catalog, caseRows);
    const cases = caseRows.map((c) => buildCasePublicCore(c, productById));

    return {
      id: row.id,
      slug: row.slug,
      displayName: row.displayName,
      photoUrl: photo,
      city: prof?.city?.trim() || null,
      servicesLine: servicesLineFromJson(prof?.services ?? null),
      likesDisplayCount: Math.max(0, row.likesUserCount ?? 0),
      casesCount,
      casesPage: page,
      casesLimit: limit,
      casesTotal,
      hasProducts: hasProducts || undefined,
      coverLayout: layout,
      coverImageUrls: coverUrls,
      aboutHtml,
      cases,
    };
  }

  /** Кейсы всех публичных партнёров-дизайнеров (новые сверху) для страницы «Проекты». */
  async listAllPublicCases(productIdRaw?: string, pageRaw = 1, limitRaw = 48) {
    const productId = productIdRaw?.trim();
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const limit = Math.min(60, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 48));

    const where: Prisma.CaseWhereInput = {
      isPublished: true,
      ...(productId ? { caseProducts: { some: { productId } } } : {}),
      user: {
        designer: { is: { isPublic: true } },
        profile: { is: { winWinPartnerApproved: true } },
      },
    };

    const total = await this.prisma.case.count({ where });
    const caseRows = await this.prisma.case.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
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

    const productById = await buildProductSummaryMapForCases(this.catalog, caseRows);

    const items = caseRows
      .filter((c) => c.user?.designer != null)
      .map((c) => {
        const des = c.user!.designer!;
        const prof = c.user!.profile;
        const designerPhoto = des.photoUrl?.trim() || prof?.avatarUrl?.trim() || null;
        return buildCasePublicDto(c, productById, {
          slug: des.slug,
          displayName: des.displayName,
          photoUrl: designerPhoto,
        });
      });

    return { items, total, page, limit };
  }
}
