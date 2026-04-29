import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaLibraryService } from '../media-library/media-library.service';
import { sanitizeProfileAboutHtml } from '../blog/blog-html.util';

function parseStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, max);
}

/** URL в img / video / source внутри descriptionHtml (S3, не data:). */
function extractMediaSrcUrlsFromHtml(html: string | null | undefined): string[] {
  if (!html?.trim()) return [];
  const out = new Set<string>();
  for (const re of [
    /<img\b[^>]*?\bsrc=["']([^"']+)["']/gi,
    /<video\b[^>]*?\bsrc=["']([^"']+)["']/gi,
    /<source\b[^>]*?\bsrc=["']([^"']+)["']/gi,
  ]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const u = m[1]?.trim();
      if (u && (u.startsWith('http://') || u.startsWith('https://')) && !u.startsWith('data:')) {
        out.add(u);
      }
    }
  }
  return [...out];
}

function coverUrlsFromDb(raw: unknown): string[] {
  return parseStringArray(raw, 2);
}

function referencedUrlsFromCase(row: {
  coverImageUrls: Prisma.JsonValue;
  descriptionHtml: string | null;
}): string[] {
  return [...coverUrlsFromDb(row.coverImageUrls), ...extractMediaSrcUrlsFromHtml(row.descriptionHtml)];
}

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaLibraryService,
  ) {}

  private async assertPartnerDesigner(userId: string): Promise<void> {
    const p = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { winWinPartnerApproved: true },
    });
    if (!p?.winWinPartnerApproved) {
      throw new ForbiddenException('Доступно только партнёрам Win-Win');
    }
  }

  async listMyCases(userId: string) {
    await this.assertPartnerDesigner(userId);
    return this.prisma.case.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyCase(userId: string, id: string) {
    await this.assertPartnerDesigner(userId);
    const row = await this.prisma.case.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Кейс не найден');
    return row;
  }

  async createMyCase(
    userId: string,
    dto: {
      title: string;
      shortDescription?: string | null;
      location?: string | null;
      year?: number | null;
      budget?: string | null;
      descriptionHtml?: string | null;
      coverLayout?: '4:3' | '16:9' | null;
      coverImageUrls?: string[] | null;
      roomTypes?: string[] | null;
      productIds?: string[] | null;
    },
  ) {
    await this.assertPartnerDesigner(userId);

    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Введите название кейса');

    const descriptionHtml =
      dto.descriptionHtml == null || String(dto.descriptionHtml).trim() === ''
        ? null
        : sanitizeProfileAboutHtml(dto.descriptionHtml);

    const coverLayout = dto.coverLayout ?? null;
    const coverImageUrls = dto.coverImageUrls ? dto.coverImageUrls.map((x) => x.trim()).filter(Boolean) : null;
    const roomTypes = dto.roomTypes ? dto.roomTypes.map((x) => x.trim()).filter(Boolean) : null;
    const productIds = dto.productIds ? parseStringArray(dto.productIds, 80) : null;

    return this.prisma.case.create({
      data: {
        userId,
        title,
        shortDescription: dto.shortDescription?.trim() || null,
        location: dto.location?.trim() || null,
        year: dto.year ?? null,
        budget: dto.budget?.trim() || null,
        descriptionHtml,
        coverLayout,
        coverImageUrls: coverImageUrls == null ? Prisma.JsonNull : coverImageUrls,
        roomTypes: roomTypes == null ? Prisma.JsonNull : roomTypes,
        productIds: productIds == null ? Prisma.JsonNull : productIds,
      },
    });
  }

  async updateMyCase(
    userId: string,
    id: string,
    dto: {
      title?: string;
      shortDescription?: string | null;
      location?: string | null;
      year?: number | null;
      budget?: string | null;
      descriptionHtml?: string | null;
      coverLayout?: '4:3' | '16:9' | null;
      coverImageUrls?: string[] | null;
      roomTypes?: string[] | null;
      productIds?: string[] | null;
    },
  ) {
    await this.assertPartnerDesigner(userId);

    const before = await this.prisma.case.findFirst({
      where: { id, userId },
      select: { id: true, coverImageUrls: true, descriptionHtml: true },
    });
    if (!before) throw new NotFoundException('Кейс не найден');
    const beforeUrls = referencedUrlsFromCase(before);

    const patch: Prisma.CaseUpdateInput = {};
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) throw new BadRequestException('Введите название кейса');
      patch.title = t;
    }
    if (dto.shortDescription !== undefined) patch.shortDescription = dto.shortDescription?.trim() || null;
    if (dto.location !== undefined) patch.location = dto.location?.trim() || null;
    if (dto.year !== undefined) patch.year = dto.year ?? null;
    if (dto.budget !== undefined) patch.budget = dto.budget?.trim() || null;
    if (dto.coverLayout !== undefined) patch.coverLayout = dto.coverLayout ?? null;
    if (dto.coverImageUrls !== undefined) {
      const list = dto.coverImageUrls ? dto.coverImageUrls.map((x) => x.trim()).filter(Boolean) : null;
      patch.coverImageUrls = list == null ? Prisma.JsonNull : list;
    }
    if (dto.roomTypes !== undefined) {
      const list = dto.roomTypes ? dto.roomTypes.map((x) => x.trim()).filter(Boolean) : null;
      patch.roomTypes = list == null ? Prisma.JsonNull : list;
    }
    if (dto.productIds !== undefined) {
      const list = dto.productIds ? parseStringArray(dto.productIds, 80) : null;
      patch.productIds = list == null ? Prisma.JsonNull : list;
    }
    if (dto.descriptionHtml !== undefined) {
      patch.descriptionHtml =
        dto.descriptionHtml == null || String(dto.descriptionHtml).trim() === ''
          ? null
          : sanitizeProfileAboutHtml(dto.descriptionHtml);
    }

    const updated = await this.prisma.case.update({ where: { id }, data: patch });
    const afterUrls = referencedUrlsFromCase(updated);

    // best-effort: почистить медиа, которые больше не используются ни в кейсе, ни где-либо ещё.
    const afterSet = new Set(afterUrls);
    for (const u of beforeUrls) {
      if (!afterSet.has(u)) {
        this.media.tryDeleteObjectByPublicUrlIfUnreferenced(u).catch(() => undefined);
      }
    }

    return updated;
  }

  async deleteMyCase(userId: string, id: string) {
    await this.assertPartnerDesigner(userId);
    const row = await this.prisma.case.findFirst({
      where: { id, userId },
      select: { id: true, coverImageUrls: true, descriptionHtml: true },
    });
    if (!row) throw new NotFoundException('Кейс не найден');
    const urls = referencedUrlsFromCase(row);
    await this.prisma.case.delete({ where: { id } });
    for (const u of urls) {
      this.media.tryDeleteObjectByPublicUrlIfUnreferenced(u).catch(() => undefined);
    }
    return { ok: true as const };
  }

  private async uploadToUserFolder(userId: string, file: Express.Multer.File) {
    const prof = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { firstName: true, lastName: true },
    });
    const folderId = await this.media.ensureUserProfileFolderId(userId, {
      firstName: prof?.firstName,
      lastName: prof?.lastName,
    });
    const row = await this.media.uploadObject(file, folderId);
    return { publicUrl: row.publicUrl, mediaObjectId: row.id };
  }

  async uploadMyCaseMedia(userId: string, file: Express.Multer.File) {
    await this.assertPartnerDesigner(userId);
    this.media.assertLkProfileRichFile(file);
    return this.uploadToUserFolder(userId, file);
  }

  async getCaseForAdmin(adminUserId: string, role: UserRole, id: string) {
    void adminUserId;
    if (role !== UserRole.ADMIN && role !== UserRole.MODERATOR) {
      throw new ForbiddenException('Forbidden');
    }
    const row = await this.prisma.case.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Кейс не найден');
    return row;
  }

  async listCasesByUserForAdmin(adminUserId: string, targetUserId: string) {
    // adminUserId сейчас не используется, но оставляем параметром для будущего аудита/политик.
    void adminUserId;
    return this.prisma.case.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteCaseForAdmin(adminUserId: string, role: UserRole, id: string) {
    void adminUserId;
    if (role !== UserRole.ADMIN && role !== UserRole.MODERATOR) {
      throw new ForbiddenException('Forbidden');
    }
    const row = await this.prisma.case.findUnique({
      where: { id },
      select: { id: true, coverImageUrls: true, descriptionHtml: true },
    });
    if (!row) throw new NotFoundException('Кейс не найден');
    const urls = referencedUrlsFromCase(row);
    await this.prisma.case.delete({ where: { id } });
    for (const u of urls) {
      this.media.tryDeleteObjectByPublicUrlIfUnreferenced(u).catch(() => undefined);
    }
    return { ok: true as const };
  }
}

