import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { sanitizeProfileAboutHtml } from '../blog/blog-html.util';
import { PrismaService } from '../../prisma/prisma.service';

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

@Injectable()
export class DesignersService {
  constructor(private prisma: PrismaService) {}

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

    return {
      slug: row.slug,
      displayName: row.displayName,
      photoUrl: photo,
      city: prof?.city?.trim() || null,
      servicesLine: servicesLineFromJson(prof?.services ?? null),
      coverLayout: layout,
      coverImageUrls: coverUrls,
      aboutHtml,
    };
  }
}
