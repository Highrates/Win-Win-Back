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
        likesUserCount: true,
        likesAdminBoost: true,
      },
    });

    const productById = await buildProductSummaryMapForCases(this.catalog, caseRows);
    const cases = caseRows.map((c) => buildCasePublicCore(c, productById));

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
        ...(productId ? { caseProducts: { some: { productId } } } : {}),
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
      .filter((c) => c.user.designer != null)
      .map((c) => {
        const des = c.user.designer!;
        const prof = c.user.profile;
        const designerPhoto = des.photoUrl?.trim() || prof?.avatarUrl?.trim() || null;
        return buildCasePublicDto(c, productById, {
          slug: des.slug,
          displayName: des.displayName,
          photoUrl: designerPhoto,
        });
      });

    return { items };
  }
}
