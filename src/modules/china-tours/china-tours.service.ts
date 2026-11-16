import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChinaTourApplicationStatus,
  ChinaTourImageRole,
  ChinaTourReviewStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../auth/mail.service';
import { sanitizeTourScheduleHtml } from '../blog/blog-html.util';
import { OrderChatService } from '../order-chat/order-chat.service';
import {
  CreateChinaTourApplicationDto,
  CreateChinaTourReviewDto,
} from './dto/china-tours.dto';
import { ensureChinaToursLanding, parseFeaturedTourIds } from './china-tours-landing';
import { orderToursByFeaturedIds } from './china-tours-featured';

function stringArrayFromJson(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

const dayInclude = {
  items: { orderBy: { sortOrder: 'asc' as const } },
  images: { orderBy: { sortOrder: 'asc' as const } },
  brands: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      brand: {
        select: {
          id: true,
          name: true,
          slug: true,
          shortDescription: true,
          description: true,
          logoUrl: true,
          siteUrl: true,
          galleryImageUrls: true,
          catalogPdfUrl: true,
          isActive: true,
        },
      },
    },
  },
} satisfies Prisma.ChinaTourDayInclude;

@Injectable()
export class ChinaToursService {
  private readonly logger = new Logger(ChinaToursService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly orderChat: OrderChatService,
  ) {}

  async getLanding() {
    return ensureChinaToursLanding(this.prisma);
  }

  async listPublished() {
    const landing = await this.getLanding();
    const featuredIds = parseFeaturedTourIds(landing.featuredTourIds);
    const rows = await this.prisma.chinaTour.findMany({
      where: {
        isPublished: true,
        ...(featuredIds.length ? { id: { in: featuredIds } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { startsAt: 'asc' }],
      include: {
        images: {
          where: {
            role: { in: [ChinaTourImageRole.CARD_PRIMARY, ChinaTourImageRole.CARD_SECONDARY] },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    return orderToursByFeaturedIds(rows, featuredIds).map((t) => this.mapListItem(t));
  }

  async getBySlug(slug: string) {
    const tour = await this.prisma.chinaTour.findFirst({
      where: { slug, isPublished: true },
      include: {
        days: {
          orderBy: [{ sortOrder: 'asc' }, { dayNumber: 'asc' }],
          include: dayInclude,
        },
        images: {
          where: { dayId: null },
          orderBy: { sortOrder: 'asc' },
        },
        reviews: {
          where: { status: ChinaTourReviewStatus.APPROVED },
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                profile: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });
    if (!tour) return null;
    return this.mapDetail(tour);
  }

  async apply(slug: string, userId: string, dto: CreateChinaTourApplicationDto) {
    const tour = await this.prisma.chinaTour.findFirst({
      where: { slug, isPublished: true },
      select: { id: true, title: true, endsAt: true },
    });
    if (!tour) throw new NotFoundException('Тур не найден');
    if (tour.endsAt.getTime() < Date.now()) {
      throw new BadRequestException('Заявки на завершённый тур не принимаются');
    }

    const appSelect = {
      id: true,
      status: true,
      comment: true,
      createdAt: true,
    } as const;

    const existing = await this.prisma.chinaTourApplication.findUnique({
      where: { tourId_userId: { tourId: tour.id, userId } },
      select: { id: true, status: true },
    });

    let row: {
      id: string;
      status: ChinaTourApplicationStatus;
      comment: string | null;
      createdAt: Date;
    };

    if (existing) {
      if (existing.status === ChinaTourApplicationStatus.REJECTED) {
        row = await this.prisma.chinaTourApplication.update({
          where: { id: existing.id },
          data: {
            status: ChinaTourApplicationStatus.PENDING,
            comment: dto.comment?.trim() || null,
          },
          select: appSelect,
        });
      } else {
        throw new ConflictException('Вы уже подали заявку на этот тур');
      }
    } else {
      try {
        row = await this.prisma.chinaTourApplication.create({
          data: {
            tourId: tour.id,
            userId,
            comment: dto.comment?.trim() || null,
            status: ChinaTourApplicationStatus.PENDING,
          },
          select: appSelect,
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Вы уже подали заявку на этот тур');
        }
        throw e;
      }
    }

    void this.notifyStaffTourApplication(tour.title, userId).catch((err) => {
      this.logger.warn(
        `China tour application email failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return row;
  }

  private async notifyStaffTourApplication(tourTitle: string, userId: string): Promise<void> {
    const recipients = await this.orderChat.getStaffNotifyEmailRecipients();
    if (!recipients.length) {
      this.logger.log(
        'China tour apply: no staff email recipients (set ORDER_CHAT_STAFF_EMAIL or add admin/moderator emails)',
      );
      return;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phone: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    });
    const frontBase =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';
    const applicantName =
      [user?.profile?.firstName, user?.profile?.lastName].filter(Boolean).join(' ').trim() || null;
    await this.mail.sendChinaTourApplicationStaff({
      recipients,
      tourTitle,
      applicantName,
      applicantContact: user?.email || user?.phone || null,
      adminApplicationsUrl: `${frontBase}/admin/tours/applications`,
    });
  }

  async myApplication(slug: string, userId: string) {
    const tour = await this.prisma.chinaTour.findFirst({
      where: { slug, isPublished: true },
      select: { id: true },
    });
    if (!tour) throw new NotFoundException('Тур не найден');
    return this.prisma.chinaTourApplication.findUnique({
      where: { tourId_userId: { tourId: tour.id, userId } },
      select: { id: true, status: true, comment: true, createdAt: true },
    });
  }

  /** Заявки текущего пользователя (для ЛК). */
  async listMyApplications(userId: string) {
    const now = Date.now();
    const rows = await this.prisma.chinaTourApplication.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        comment: true,
        createdAt: true,
        tour: {
          select: {
            id: true,
            slug: true,
            title: true,
            startsAt: true,
            endsAt: true,
            isPublished: true,
            seatsTotal: true,
            seatsTaken: true,
            images: {
              where: { role: ChinaTourImageRole.CARD_PRIMARY },
              take: 1,
              select: { url: true },
            },
          },
        },
      },
    });
    const tourIds = rows.map((a) => a.tour.id);
    const reviews =
      tourIds.length === 0
        ? []
        : await this.prisma.chinaTourReview.findMany({
            where: { userId, tourId: { in: tourIds } },
            select: { tourId: true, status: true },
          });
    const reviewByTour = new Map(reviews.map((r) => [r.tourId, r.status]));

    return rows.map((a) => {
      const endsAtMs = a.tour.endsAt.getTime();
      const reviewStatus = reviewByTour.get(a.tour.id) ?? null;
      const eligible =
        a.status === ChinaTourApplicationStatus.ACCEPTED &&
        a.tour.isPublished &&
        endsAtMs <= now;
      // Можно оставить/переписать только если отзыва нет или он REJECTED
      const canReview =
        eligible &&
        (reviewStatus == null || reviewStatus === ChinaTourReviewStatus.REJECTED);
      return {
        id: a.id,
        status: a.status,
        comment: a.comment,
        createdAt: a.createdAt.toISOString(),
        canReview,
        hasReview: reviewStatus != null,
        reviewStatus,
        tour: {
          id: a.tour.id,
          slug: a.tour.slug,
          title: a.tour.title,
          startsAt: a.tour.startsAt.toISOString(),
          endsAt: a.tour.endsAt.toISOString(),
          isPublished: a.tour.isPublished,
          seatsTotal: a.tour.seatsTotal,
          seatsTaken: a.tour.seatsTaken,
          cardPrimaryUrl: a.tour.images[0]?.url ?? null,
        },
      };
    });
  }

  async createReview(slug: string, userId: string, dto: CreateChinaTourReviewDto) {
    const tour = await this.prisma.chinaTour.findFirst({
      where: { slug, isPublished: true },
      select: { id: true, title: true, endsAt: true },
    });
    if (!tour) throw new NotFoundException('Тур не найден');
    if (tour.endsAt.getTime() > Date.now()) {
      throw new BadRequestException('Отзыв можно оставить после окончания тура');
    }

    const application = await this.prisma.chinaTourApplication.findUnique({
      where: { tourId_userId: { tourId: tour.id, userId } },
      select: { status: true },
    });
    if (application?.status !== ChinaTourApplicationStatus.ACCEPTED) {
      throw new ForbiddenException('Отзыв могут оставить только участники тура');
    }

    const body = dto.body.trim();
    if (body.length < 2) throw new BadRequestException('Слишком короткий отзыв');

    const reviewSelect = {
      id: true,
      status: true,
      body: true,
      rating: true,
      createdAt: true,
    } as const;

    const existing = await this.prisma.chinaTourReview.findUnique({
      where: { tourId_userId: { tourId: tour.id, userId } },
      select: { id: true, status: true },
    });

    let row: {
      id: string;
      status: ChinaTourReviewStatus;
      body: string;
      rating: number | null;
      createdAt: Date;
    };

    if (existing) {
      if (existing.status === ChinaTourReviewStatus.REJECTED) {
        row = await this.prisma.chinaTourReview.update({
          where: { id: existing.id },
          data: {
            body,
            rating: dto.rating ?? null,
            status: ChinaTourReviewStatus.PENDING,
          },
          select: reviewSelect,
        });
      } else {
        throw new ConflictException('Вы уже оставили отзыв об этом туре');
      }
    } else {
      try {
        row = await this.prisma.chinaTourReview.create({
          data: {
            tourId: tour.id,
            userId,
            body,
            rating: dto.rating ?? null,
            status: ChinaTourReviewStatus.PENDING,
          },
          select: reviewSelect,
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException('Вы уже оставили отзыв об этом туре');
        }
        throw e;
      }
    }

    void this.notifyStaffTourReview(tour.title, userId, {
      body: row.body,
      rating: row.rating,
    }).catch((err) => {
      this.logger.warn(
        `China tour review email failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return row;
  }

  private async notifyStaffTourReview(
    tourTitle: string,
    userId: string,
    review: { body: string; rating: number | null },
  ): Promise<void> {
    const recipients = await this.orderChat.getStaffNotifyEmailRecipients();
    if (!recipients.length) {
      this.logger.log(
        'China tour review: no staff email recipients (set ORDER_CHAT_STAFF_EMAIL or add admin/moderator emails)',
      );
      return;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        phone: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    });
    const frontBase =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';
    const authorName =
      [user?.profile?.firstName, user?.profile?.lastName].filter(Boolean).join(' ').trim() || null;
    await this.mail.sendChinaTourReviewStaff({
      recipients,
      tourTitle,
      authorName,
      authorContact: user?.email || user?.phone || null,
      rating: review.rating,
      body: review.body,
      adminReviewsUrl: `${frontBase}/admin/tours/reviews?status=PENDING`,
    });
  }

  async myReview(slug: string, userId: string) {
    const tour = await this.prisma.chinaTour.findFirst({
      where: { slug, isPublished: true },
      select: { id: true },
    });
    if (!tour) throw new NotFoundException('Тур не найден');
    return this.prisma.chinaTourReview.findUnique({
      where: { tourId_userId: { tourId: tour.id, userId } },
      select: { id: true, status: true, body: true, rating: true, createdAt: true },
    });
  }

  private mapListItem(
    t: Prisma.ChinaTourGetPayload<{
      include: { images: true };
    }>,
  ) {
    const primary = t.images.find((i) => i.role === ChinaTourImageRole.CARD_PRIMARY);
    const secondary = t.images.find((i) => i.role === ChinaTourImageRole.CARD_SECONDARY);
    return {
      id: t.id,
      slug: t.slug,
      title: t.title,
      cardText: t.cardText,
      startsAt: t.startsAt.toISOString(),
      endsAt: t.endsAt.toISOString(),
      seatsTotal: t.seatsTotal,
      seatsTaken: t.seatsTaken,
      cardPrimaryUrl: primary?.url ?? null,
      cardSecondaryUrl: secondary?.url ?? null,
    };
  }

  private mapDetail(
    t: {
      id: string;
      slug: string;
      title: string;
      cardText: string | null;
      startsAt: Date;
      endsAt: Date;
      seatsTotal: number;
      seatsTaken: number;
      days: Array<{
        id: string;
        dayNumber: number;
        title: string;
        subtitle: string;
        items: Array<{ id: string; timeLabel: string; title: string; body: string }>;
        images: Array<{ url: string; role: ChinaTourImageRole }>;
        brands: Array<{
          id: string;
          customName: string | null;
          brand: {
            id: string;
            name: string;
            slug: string;
            shortDescription: string | null;
            description: string | null;
            logoUrl: string | null;
            siteUrl: string | null;
            galleryImageUrls: unknown;
            catalogPdfUrl: string | null;
            isActive: boolean;
          } | null;
        }>;
      }>;
      images: Array<{ url: string; role: ChinaTourImageRole }>;
      reviews: Array<{
        id: string;
        body: string;
        rating: number | null;
        authorName: string | null;
        photoUrls: unknown;
        videoUrl: string | null;
        createdAt: Date;
        user: {
          id: string;
          profile: { firstName: string | null; lastName: string | null } | null;
        } | null;
      }>;
    },
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
      canReview: t.endsAt.getTime() <= Date.now(),
      days: t.days.map((d) => ({
        id: d.id,
        dayNumber: d.dayNumber,
        title: d.title,
        subtitle: d.subtitle,
        items: d.items.map((it) => ({
          id: it.id,
          timeLabel: it.timeLabel,
          title: it.title,
          body: sanitizeTourScheduleHtml(it.body),
        })),
        heroUrl:
          d.images.find((i) => i.role === ChinaTourImageRole.DAY_HERO)?.url ??
          d.images[0]?.url ??
          null,
        galleryUrls: d.images
          .filter((i) => i.role === ChinaTourImageRole.DAY_GALLERY || i.role === ChinaTourImageRole.DAY_HERO)
          .map((i) => i.url),
        brands: d.brands
          .map((b) => {
            const catalog = b.brand;
            const name = catalog?.name?.trim() || b.customName?.trim() || '';
            if (!name) return null;
            return {
              id: b.id,
              name,
              slug: catalog?.slug ?? null,
              logoUrl: catalog?.logoUrl ?? null,
              shortDescription: catalog?.shortDescription ?? null,
              descriptionHtml: catalog?.description ?? null,
              siteUrl: catalog?.siteUrl ?? null,
              galleryUrls: stringArrayFromJson(catalog?.galleryImageUrls, 3),
              catalogPdfUrl: catalog?.catalogPdfUrl ?? null,
              hasAbout: Boolean(catalog?.description?.trim()),
            };
          })
          .filter((b): b is NonNullable<typeof b> => Boolean(b)),
      })),
      cardPrimaryUrl:
        t.images.find((i) => i.role === ChinaTourImageRole.CARD_PRIMARY)?.url ?? null,
      cardSecondaryUrl:
        t.images.find((i) => i.role === ChinaTourImageRole.CARD_SECONDARY)?.url ?? null,
      reviews: t.reviews.map((r) => {
        const fromUser = r.user
          ? [r.user.profile?.firstName, r.user.profile?.lastName]
              .filter(Boolean)
              .join(' ')
              .trim()
          : '';
        return {
          id: r.id,
          body: r.body,
          rating: r.rating,
          createdAt: r.createdAt.toISOString(),
          authorName: r.authorName?.trim() || fromUser || 'Участник',
          photoUrls: stringArrayFromJson(r.photoUrls, 12),
          videoUrl: r.videoUrl?.trim() || null,
        };
      }),
    };
  }
}
