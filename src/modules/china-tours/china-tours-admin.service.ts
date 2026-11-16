import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ChinaTourApplicationStatus,
  ChinaTourImageRole,
  ChinaTourReviewStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeTourScheduleHtml } from '../blog/blog-html.util';
import { transliterateRu } from '../catalog/slug-transliteration';
import {
  CreateChinaTourDto,
  UpdateChinaTourDto,
  UpdateChinaToursLandingDto,
  ChinaTourDayBrandDto,
  ChinaTourDayDto,
  ChinaTourImageDto,
  ChinaTourScheduleItemDto,
} from './dto/china-tours.dto';
import { ensureChinaToursLanding, pruneTourIdFromFeatured } from './china-tours-landing';

function slugifyFromTitle(title: string, fallback: string): string {
  const raw = transliterateRu(title.trim())
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return raw || fallback;
}

const dayBrandSelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
} as const;

const adminDetailInclude = {
  days: {
    orderBy: [{ sortOrder: 'asc' as const }, { dayNumber: 'asc' as const }],
    include: {
      items: { orderBy: { sortOrder: 'asc' as const } },
      images: { orderBy: { sortOrder: 'asc' as const } },
      brands: {
        orderBy: { sortOrder: 'asc' as const },
        include: { brand: { select: dayBrandSelect } },
      },
    },
  },
  images: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ChinaTourInclude;

@Injectable()
export class ChinaToursAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getLanding() {
    return ensureChinaToursLanding(this.prisma);
  }

  async updateLanding(dto: UpdateChinaToursLandingDto) {
    await this.getLanding();
    const featuredTourIds =
      dto.featuredTourIds !== undefined
        ? [...new Set(dto.featuredTourIds.map((id) => id.trim()).filter(Boolean))]
        : undefined;
    if (featuredTourIds?.length) {
      const found = await this.prisma.chinaTour.findMany({
        where: { id: { in: featuredTourIds }, isPublished: true },
        select: { id: true },
      });
      if (found.length !== featuredTourIds.length) {
        throw new BadRequestException('Выбирайте только опубликованные туры');
      }
    }
    return this.prisma.chinaToursLanding.update({
      where: { id: 'landing' },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl?.trim() || null } : {}),
        ...(featuredTourIds !== undefined ? { featuredTourIds } : {}),
      },
    });
  }

  async listTours(params: { q?: string; page?: number; limit?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const where: Prisma.ChinaTourWhereInput = {};
    const q = params.q?.trim();
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.chinaTour.count({ where }),
      this.prisma.chinaTour.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { startsAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { applications: true, reviews: true, days: true } },
        },
      }),
    ]);
    return {
      items: rows.map((t) => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
        startsAt: t.startsAt.toISOString(),
        endsAt: t.endsAt.toISOString(),
        seatsTotal: t.seatsTotal,
        seatsTaken: t.seatsTaken,
        isPublished: t.isPublished,
        publishedAt: t.publishedAt?.toISOString() ?? null,
        sortOrder: t.sortOrder,
        daysCount: t._count.days,
        applicationsCount: t._count.applications,
        reviewsCount: t._count.reviews,
        updatedAt: t.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }

  async getTour(id: string) {
    const t = await this.prisma.chinaTour.findUnique({
      where: { id },
      include: adminDetailInclude,
    });
    if (!t) throw new NotFoundException('Тур не найден');
    return this.mapAdminDetail(t);
  }

  async createTour(dto: CreateChinaTourDto) {
    this.assertDates(dto.startsAt, dto.endsAt);
    const seatsTotal = dto.seatsTotal ?? 10;
    const seatsTaken = dto.seatsTaken ?? 0;
    if (seatsTaken > seatsTotal) {
      throw new BadRequestException('Занятых мест не может быть больше вместимости');
    }
    const base = dto.slug?.trim() || slugifyFromTitle(dto.title, 'tour');
    const slug = await this.ensureUniqueSlug(base);
    const maxSort = await this.prisma.chinaTour.aggregate({ _max: { sortOrder: true } });
    const sortOrder = dto.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1;
    const isPublished = Boolean(dto.isPublished);

    const created = await this.prisma.$transaction(async (tx) => {
      const tour = await tx.chinaTour.create({
        data: {
          slug,
          title: dto.title.trim(),
          cardText: dto.cardText?.trim() || null,
          startsAt: new Date(dto.startsAt),
          endsAt: new Date(dto.endsAt),
          seatsTotal,
          seatsTaken,
          isPublished,
          publishedAt: isPublished ? new Date() : null,
          sortOrder,
        },
      });
      await this.replaceNested(tx, tour.id, dto.days ?? [], dto.images ?? []);
      return tour.id;
    });
    return this.getTour(created);
  }

  async updateTour(id: string, dto: UpdateChinaTourDto) {
    const existing = await this.prisma.chinaTour.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Тур не найден');

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;
    this.assertDates(startsAt.toISOString(), endsAt.toISOString());

    const seatsTotal = dto.seatsTotal ?? existing.seatsTotal;
    const seatsTaken = dto.seatsTaken ?? existing.seatsTaken;
    if (seatsTaken > seatsTotal) {
      throw new BadRequestException('Занятых мест не может быть больше вместимости');
    }

    let slug = existing.slug;
    if (dto.slug?.trim()) slug = await this.ensureUniqueSlug(dto.slug.trim(), id);

    let publishedAt = existing.publishedAt;
    let isPublished = existing.isPublished;
    if (dto.isPublished !== undefined) {
      isPublished = dto.isPublished;
      if (isPublished && !existing.isPublished) publishedAt = new Date();
      if (!isPublished) publishedAt = null;
    }

    const unpublished = existing.isPublished && !isPublished;

    await this.prisma.$transaction(async (tx) => {
      await tx.chinaTour.update({
        where: { id },
        data: {
          slug,
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.cardText !== undefined ? { cardText: dto.cardText?.trim() || null } : {}),
          startsAt,
          endsAt,
          seatsTotal,
          seatsTaken,
          isPublished,
          publishedAt,
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
      if (unpublished) {
        await pruneTourIdFromFeatured(tx, id);
      }
      if (dto.days !== undefined || dto.images !== undefined) {
        await this.replaceNested(tx, id, dto.days ?? undefined, dto.images ?? undefined);
      }
    });
    return this.getTour(id);
  }

  async deleteTour(id: string) {
    const existing = await this.prisma.chinaTour.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Тур не найден');
    await this.prisma.$transaction(async (tx) => {
      await pruneTourIdFromFeatured(tx, id);
      await tx.chinaTour.delete({ where: { id } });
    });
    return { ok: true };
  }

  async reorderTours(orderedIds: string[]) {
    const unique = [...new Set(orderedIds.map((id) => id.trim()).filter(Boolean))];
    if (!unique.length) throw new BadRequestException('Пустой список порядка');
    const total = await this.prisma.chinaTour.count();
    if (unique.length !== total) {
      throw new BadRequestException('orderedIds должен содержать все туры ровно один раз');
    }
    const found = await this.prisma.chinaTour.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException('В списке есть неизвестные туры');
    }
    await this.prisma.$transaction(
      unique.map((id, index) =>
        this.prisma.chinaTour.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return { ok: true };
  }

  async countPendingApplications(): Promise<{ total: number }> {
    const total = await this.prisma.chinaTourApplication.count({
      where: { status: ChinaTourApplicationStatus.PENDING },
    });
    return { total };
  }

  async countPendingReviews(): Promise<{ total: number }> {
    const total = await this.prisma.chinaTourReview.count({
      where: { status: ChinaTourReviewStatus.PENDING },
    });
    return { total };
  }

  async listApplications(params: {
    tourId?: string;
    status?: ChinaTourApplicationStatus;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const where: Prisma.ChinaTourApplicationWhereInput = {};
    if (params.tourId) where.tourId = params.tourId;
    if (params.status) where.status = params.status;
    const [total, rows] = await Promise.all([
      this.prisma.chinaTourApplication.count({ where }),
      this.prisma.chinaTourApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          tour: { select: { id: true, title: true, slug: true } },
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              profile: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map((a) => ({
        id: a.id,
        status: a.status,
        comment: a.comment,
        createdAt: a.createdAt.toISOString(),
        tour: a.tour,
        user: {
          id: a.user.id,
          email: a.user.email,
          phone: a.user.phone,
          name: [a.user.profile?.firstName, a.user.profile?.lastName].filter(Boolean).join(' ').trim() || null,
        },
      })),
      total,
      page,
      limit,
    };
  }

  async patchApplicationStatus(id: string, status: ChinaTourApplicationStatus) {
    const row = await this.prisma.chinaTourApplication.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Заявка не найдена');
    return this.prisma.chinaTourApplication.update({
      where: { id },
      data: { status },
      select: { id: true, status: true, updatedAt: true },
    });
  }

  async listReviews(params: {
    tourId?: string;
    status?: ChinaTourReviewStatus;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 50));
    const where: Prisma.ChinaTourReviewWhereInput = {};
    if (params.tourId) where.tourId = params.tourId;
    if (params.status) where.status = params.status;
    const [total, rows] = await Promise.all([
      this.prisma.chinaTourReview.count({ where }),
      this.prisma.chinaTourReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          tour: { select: { id: true, title: true, slug: true } },
          user: {
            select: {
              id: true,
              email: true,
              profile: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        body: r.body,
        rating: r.rating,
        createdAt: r.createdAt.toISOString(),
        tour: r.tour,
        user: {
          id: r.user.id,
          email: r.user.email,
          name: [r.user.profile?.firstName, r.user.profile?.lastName].filter(Boolean).join(' ').trim() || null,
        },
      })),
      total,
      page,
      limit,
    };
  }

  async patchReviewStatus(id: string, status: ChinaTourReviewStatus) {
    const row = await this.prisma.chinaTourReview.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Отзыв не найден');
    return this.prisma.chinaTourReview.update({
      where: { id },
      data: { status },
      select: { id: true, status: true, updatedAt: true },
    });
  }

  private assertDates(startsAt: string, endsAt: string) {
    const s = new Date(startsAt).getTime();
    const e = new Date(endsAt).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e)) {
      throw new BadRequestException('Некорректные даты');
    }
    if (e < s) throw new BadRequestException('Дата окончания раньше начала');
  }

  private async ensureUniqueSlug(base: string, excludeId?: string): Promise<string> {
    let slug = base.slice(0, 120) || 'tour';
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? slug : `${slug.slice(0, 110)}-${i + 1}`;
      const found = await this.prisma.chinaTour.findUnique({ where: { slug: candidate } });
      if (!found || found.id === excludeId) return candidate;
    }
    return `${slug.slice(0, 100)}-${Date.now()}`;
  }

  /**
   * Синхронизация nested days/items/images с сохранением id из DTO
   * (без delete-all + recreate → нет churn ключей и гонок в редакторе).
   */
  private async replaceNested(
    tx: Prisma.TransactionClient,
    tourId: string,
    days: ChinaTourDayDto[] | undefined,
    tourImages: ChinaTourImageDto[] | undefined,
  ) {
    if (days !== undefined) {
      const existingDays = await tx.chinaTourDay.findMany({
        where: { tourId },
        select: { id: true },
      });
      const existingDayIds = new Set(existingDays.map((d) => d.id));
      const keepDayIds: string[] = [];

      for (let di = 0; di < days.length; di++) {
        const d = days[di]!;
        const dayId = await this.upsertDay(tx, tourId, d, di, existingDayIds);
        keepDayIds.push(dayId);
        await this.syncDayItems(tx, dayId, d.items ?? []);
        await this.syncDayImages(tx, tourId, dayId, d.images ?? []);
        await this.syncDayBrands(tx, dayId, d.brands ?? []);
      }

      await tx.chinaTourDay.deleteMany({
        where: { tourId, id: { notIn: keepDayIds } },
      });

      // Финальные dayNumber после удаления лишних (unique tourId+dayNumber)
      for (let di = 0; di < days.length; di++) {
        await tx.chinaTourDay.update({
          where: { id: keepDayIds[di]! },
          data: {
            dayNumber: days[di]!.dayNumber,
            sortOrder: days[di]!.sortOrder ?? di,
          },
        });
      }
    }

    if (tourImages !== undefined) {
      const cardImgs = tourImages.filter(
        (img) =>
          img.role === ChinaTourImageRole.CARD_PRIMARY ||
          img.role === ChinaTourImageRole.CARD_SECONDARY,
      );
      const existing = await tx.chinaTourImage.findMany({
        where: {
          tourId,
          dayId: null,
          role: { in: [ChinaTourImageRole.CARD_PRIMARY, ChinaTourImageRole.CARD_SECONDARY] },
        },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((i) => i.id));
      const keepIds: string[] = [];
      for (let ii = 0; ii < cardImgs.length; ii++) {
        const img = cardImgs[ii]!;
        const id = await this.upsertTourImage(tx, tourId, null, img, ii, existingIds);
        keepIds.push(id);
      }
      await tx.chinaTourImage.deleteMany({
        where: {
          tourId,
          dayId: null,
          role: { in: [ChinaTourImageRole.CARD_PRIMARY, ChinaTourImageRole.CARD_SECONDARY] },
          id: { notIn: keepIds },
        },
      });
    }
  }

  private async upsertDay(
    tx: Prisma.TransactionClient,
    tourId: string,
    d: ChinaTourDayDto,
    index: number,
    existingDayIds: Set<string>,
  ): Promise<string> {
    const data = {
      title: d.title.trim(),
      subtitle: (d.subtitle ?? '').trim(),
      // временный dayNumber — финальный выставится после цикла
      dayNumber: 100_000 + index,
      sortOrder: d.sortOrder ?? index,
    };
    if (d.id && existingDayIds.has(d.id)) {
      await tx.chinaTourDay.update({ where: { id: d.id }, data });
      return d.id;
    }
    const created = await tx.chinaTourDay.create({
      data: { tourId, ...data },
    });
    return created.id;
  }

  private async syncDayItems(
    tx: Prisma.TransactionClient,
    dayId: string,
    items: ChinaTourScheduleItemDto[],
  ) {
    const existing = await tx.chinaTourScheduleItem.findMany({
      where: { dayId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((i) => i.id));
    const keepIds: string[] = [];
    for (let ii = 0; ii < items.length; ii++) {
      const it = items[ii]!;
      const payload = {
        timeLabel: it.timeLabel.trim(),
        title: it.title.trim(),
        body: sanitizeTourScheduleHtml(it.body ?? ''),
        sortOrder: it.sortOrder ?? ii,
      };
      if (it.id && existingIds.has(it.id)) {
        await tx.chinaTourScheduleItem.update({ where: { id: it.id }, data: payload });
        keepIds.push(it.id);
      } else {
        const created = await tx.chinaTourScheduleItem.create({
          data: { dayId, ...payload },
        });
        keepIds.push(created.id);
      }
    }
    await tx.chinaTourScheduleItem.deleteMany({
      where: { dayId, id: { notIn: keepIds } },
    });
  }

  private async syncDayBrands(
    tx: Prisma.TransactionClient,
    dayId: string,
    brands: ChinaTourDayBrandDto[],
  ) {
    const existing = await tx.chinaTourDayBrand.findMany({
      where: { dayId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((b) => b.id));
    const keepIds: string[] = [];

    for (let bi = 0; bi < brands.length; bi++) {
      const row = brands[bi]!;
      const brandId = row.brandId?.trim() || null;
      const customName = row.customName?.trim() || null;
      if (!brandId && !customName) {
        throw new BadRequestException('Укажите бренд из каталога или произвольное название');
      }
      if (brandId) {
        const found = await tx.brand.findUnique({ where: { id: brandId }, select: { id: true } });
        if (!found) throw new BadRequestException(`Бренд не найден: ${brandId}`);
      }
      const payload = {
        brandId,
        customName: brandId ? null : customName,
        sortOrder: row.sortOrder ?? bi,
      };
      if (row.id && existingIds.has(row.id)) {
        await tx.chinaTourDayBrand.update({ where: { id: row.id }, data: payload });
        keepIds.push(row.id);
      } else {
        const created = await tx.chinaTourDayBrand.create({
          data: { dayId, ...payload },
        });
        keepIds.push(created.id);
      }
    }

    await tx.chinaTourDayBrand.deleteMany({
      where: { dayId, id: { notIn: keepIds } },
    });
  }

  private async syncDayImages(
    tx: Prisma.TransactionClient,
    tourId: string,
    dayId: string,
    images: ChinaTourImageDto[],
  ) {
    const dayImgs = images.filter(
      (img) =>
        img.role === ChinaTourImageRole.DAY_HERO ||
        img.role === ChinaTourImageRole.DAY_GALLERY,
    );
    const existing = await tx.chinaTourImage.findMany({
      where: { dayId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((i) => i.id));
    const keepIds: string[] = [];
    for (let ii = 0; ii < dayImgs.length; ii++) {
      const img = dayImgs[ii]!;
      const id = await this.upsertTourImage(tx, tourId, dayId, img, ii, existingIds);
      keepIds.push(id);
    }
    await tx.chinaTourImage.deleteMany({
      where: { dayId, id: { notIn: keepIds } },
    });
  }

  private async upsertTourImage(
    tx: Prisma.TransactionClient,
    tourId: string,
    dayId: string | null,
    img: ChinaTourImageDto,
    index: number,
    existingIds: Set<string>,
  ): Promise<string> {
    const data = {
      url: img.url.trim(),
      role: img.role,
      sortOrder: img.sortOrder ?? index,
      dayId,
    };
    if (img.id && existingIds.has(img.id)) {
      await tx.chinaTourImage.update({ where: { id: img.id }, data });
      return img.id;
    }
    const created = await tx.chinaTourImage.create({
      data: { tourId, ...data },
    });
    return created.id;
  }

  private mapAdminDetail(
    t: Prisma.ChinaTourGetPayload<{ include: typeof adminDetailInclude }>,
  ) {
    return {
      id: t.id,
      slug: t.slug,
      title: t.title,
      cardText: t.cardText,
      startsAt: t.startsAt.toISOString(),
      endsAt: t.endsAt.toISOString(),
      seatsTotal: t.seatsTotal,
      seatsTaken: t.seatsTaken,
      isPublished: t.isPublished,
      publishedAt: t.publishedAt?.toISOString() ?? null,
      sortOrder: t.sortOrder,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      images: t.images
        .filter((i) => !i.dayId)
        .map((i) => ({
          id: i.id,
          url: i.url,
          role: i.role,
          sortOrder: i.sortOrder,
        })),
      days: t.days.map((d) => ({
        id: d.id,
        dayNumber: d.dayNumber,
        title: d.title,
        subtitle: d.subtitle,
        sortOrder: d.sortOrder,
        items: d.items.map((it) => ({
          id: it.id,
          timeLabel: it.timeLabel,
          title: it.title,
          body: it.body,
          sortOrder: it.sortOrder,
        })),
        images: d.images.map((i) => ({
          id: i.id,
          url: i.url,
          role: i.role,
          sortOrder: i.sortOrder,
        })),
        brands: d.brands.map((b) => ({
          id: b.id,
          brandId: b.brandId,
          customName: b.customName,
          sortOrder: b.sortOrder,
          name: b.brand?.name ?? b.customName ?? '',
          slug: b.brand?.slug ?? null,
          logoUrl: b.brand?.logoUrl ?? null,
        })),
      })),
    };
  }
}
