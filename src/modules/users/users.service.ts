import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { MediaLibraryService } from '../media-library/media-library.service';

/** URL в img / video / source внутри aboutHtml (S3, не data:). */
function extractMediaSrcUrlsFromAboutHtml(html: string | null | undefined): string[] {
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

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private media: MediaLibraryService,
  ) {}

  async existsByPhoneOrEmail(phoneDigits: string | null, emailLower: string | null): Promise<boolean> {
    const or: Prisma.UserWhereInput[] = [];
    if (phoneDigits) or.push({ phone: phoneDigits });
    if (emailLower) {
      const e = emailLower.trim().toLowerCase();
      if (e) or.push({ email: e });
    }
    if (!or.length) return false;
    const u = await this.prisma.user.findFirst({
      where: { OR: or, isActive: true },
      select: { id: true },
    });
    return !!u;
  }

  /** Другой активный пользователь (не `excludeUserId`) уже владеет этим телефоном или email. */
  async isPhoneOrEmailTakenByOther(
    phoneDigits: string | null,
    emailLower: string | null,
    excludeUserId: string,
  ): Promise<boolean> {
    const or: Prisma.UserWhereInput[] = [];
    if (phoneDigits) or.push({ phone: phoneDigits });
    if (emailLower) {
      const e = emailLower.trim().toLowerCase();
      if (e) or.push({ email: e });
    }
    if (!or.length) return false;
    const u = await this.prisma.user.findFirst({
      where: { id: { not: excludeUserId }, isActive: true, OR: or },
      select: { id: true },
    });
    return !!u;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (newPassword.length < 8) {
      throw new BadRequestException('Пароль — не менее 8 символов');
    }
    const ok = await this.checkPassword(userId, currentPassword);
    if (!ok) {
      throw new UnauthorizedException('Неверный текущий пароль');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    return { ok: true as const };
  }

  async updateAccountConsents(
    userId: string,
    body: { consentPersonalData: boolean; consentSmsMarketing: boolean },
  ) {
    const now = new Date();
    const row = await this.prisma.user.update({
      where: { id: userId },
      data: {
        consentPersonalDataAcceptedAt: body.consentPersonalData ? now : null,
        consentSmsMarketingAcceptedAt: body.consentSmsMarketing ? now : null,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        consentPersonalDataAcceptedAt: true,
        consentSmsMarketingAcceptedAt: true,
      },
    });
    return row;
  }

  async createRetailUser(dto: {
    phone: string | null;
    email: string | null;
    password: string;
    consentPersonalData: boolean;
    consentSms: boolean;
  }) {
    if (!dto.phone && !dto.email) {
      throw new BadRequestException('Нужен телефон или email');
    }
    const email = dto.email ? dto.email.trim().toLowerCase() : null;
    const phone = dto.phone;
    const or: Prisma.UserWhereInput[] = [];
    if (phone) or.push({ phone });
    if (email) or.push({ email });
    const existing = await this.prisma.user.findFirst({
      where: { OR: or },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Пользователь с таким телефоном или email уже зарегистрирован');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const now = new Date();
    const user = await this.prisma.user.create({
      data: {
        email,
        phone,
        passwordHash,
        role: UserRole.USER,
        consentPersonalDataAcceptedAt: dto.consentPersonalData ? now : null,
        consentSmsMarketingAcceptedAt: dto.consentSms ? now : null,
        profile: { create: {} },
      },
    });
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  async listRetailUsers(params: { skip: number; take: number; q?: string }) {
    const q = params.q?.trim();
    const digits = q?.replace(/\D/g, '') ?? '';
    const where: Prisma.UserWhereInput = {
      role: UserRole.USER,
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
        select: {
          id: true,
          email: true,
          phone: true,
          isActive: true,
          createdAt: true,
          consentPersonalDataAcceptedAt: true,
          consentSmsMarketingAcceptedAt: true,
          profile: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, total };
  }

  async findByEmailOrPhone(emailOrPhone: string) {
    const raw = emailOrPhone.trim();
    if (!raw) return null;
    const emailLookup = raw.includes('@') ? raw.toLowerCase() : raw;
    return this.prisma.user.findFirst({
      where: {
        OR: [{ email: emailLookup }, { phone: raw }],
        isActive: true,
      },
      include: { profile: true },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id, isActive: true },
      include: { profile: true },
    });
  }

  /** Без passwordHash — для API /users/me, /auth/me */
  async findByIdPublic(id: string) {
    const user = await this.findById(id);
    if (!user) return null;
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  async checkPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  async create(dto: { email?: string; phone?: string; password: string }) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: UserRole.USER,
        profile: { create: {} },
      },
    });
  }

  async getUserProfileVitrine(userId: string) {
    const p = await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return p;
  }

  private vitrineImageUrls(p: { avatarUrl: string | null; coverImageUrls: Prisma.JsonValue } | null): string[] {
    const out: string[] = [];
    const a = p?.avatarUrl?.trim();
    if (a) out.push(a);
    const raw = p?.coverImageUrls;
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (typeof x === 'string' && x.trim()) out.push(x.trim());
      }
    }
    return out;
  }

  private async deleteReplacedVitrineImageUrls(
    beforeUrls: string[],
    afterUrls: string[],
  ): Promise<void> {
    const afterSet = new Set(afterUrls);
    for (const u of beforeUrls) {
      if (!afterSet.has(u)) {
        try {
          await this.media.tryDeleteObjectByPublicUrlIfUnreferenced(u);
        } catch {
          /* best-effort */
        }
      }
    }
  }

  private vitrineAllReferencedImageUrls(
    p: { avatarUrl: string | null; coverImageUrls: Prisma.JsonValue; aboutHtml: string | null } | null,
  ): string[] {
    if (!p) return [];
    return [
      ...this.vitrineImageUrls(p),
      ...extractMediaSrcUrlsFromAboutHtml(p.aboutHtml),
    ];
  }

  async updateUserProfileVitrine(
    userId: string,
    patch: {
      firstName?: string;
      lastName?: string;
      city?: string;
      services?: string[] | null;
      aboutHtml?: string | null;
      coverLayout?: '4:3' | '16:9' | null;
      coverImageUrls?: string[] | null;
      avatarUrl?: string | null;
    },
  ) {
    const beforeRow = await this.prisma.userProfile.findUnique({ where: { userId } });
    const beforeUrls = this.vitrineAllReferencedImageUrls(beforeRow);
    const result = await this.prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        firstName: patch.firstName,
        lastName: patch.lastName,
        city: patch.city,
        services: patch.services == null ? undefined : patch.services,
        aboutHtml: patch.aboutHtml,
        coverLayout: patch.coverLayout,
        coverImageUrls: patch.coverImageUrls == null ? undefined : patch.coverImageUrls,
        avatarUrl: patch.avatarUrl,
      },
      update: {
        ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
        ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
        ...(patch.city !== undefined ? { city: patch.city } : {}),
        ...(patch.services !== undefined
          ? { services: patch.services == null ? Prisma.JsonNull : patch.services }
          : {}),
        ...(patch.aboutHtml !== undefined ? { aboutHtml: patch.aboutHtml } : {}),
        ...(patch.coverLayout !== undefined ? { coverLayout: patch.coverLayout } : {}),
        ...(patch.coverImageUrls !== undefined
          ? { coverImageUrls: patch.coverImageUrls == null ? Prisma.JsonNull : patch.coverImageUrls }
          : {}),
        ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
      },
    });
    const afterUrls = this.vitrineAllReferencedImageUrls(result);
    void this.deleteReplacedVitrineImageUrls(beforeUrls, afterUrls).catch(() => undefined);
    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      void this.media
        .syncUserProfileMediaFolderName(userId, result.lastName, result.firstName)
        .catch(() => undefined);
    }
    return result;
  }

  async ackProfileOnboarding(userId: string) {
    await this.prisma.userProfile.updateMany({
      where: { userId },
      data: { profileOnboardingPending: false },
    });
    return this.getUserProfileVitrine(userId);
  }

  private async uploadToUserProfileFolder(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');
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

  async uploadUserAvatarImage(userId: string, file: Express.Multer.File) {
    this.media.assertLkVitrineImage(file, 'avatar');
    return this.uploadToUserProfileFolder(userId, file);
  }

  async uploadUserCoverImage(userId: string, file: Express.Multer.File) {
    this.media.assertLkVitrineImage(file, 'cover');
    return this.uploadToUserProfileFolder(userId, file);
  }

  async uploadUserProfileRichMedia(userId: string, file: Express.Multer.File) {
    this.media.assertLkProfileRichFile(file);
    return this.uploadToUserProfileFolder(userId, file);
  }

  async findRetailUserByIdForAdmin(id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, role: UserRole.USER, isActive: true },
      include: { profile: true },
    });
    if (!u) throw new NotFoundException('User not found');
    const { passwordHash: _, ...safe } = u;
    return safe;
  }
}
