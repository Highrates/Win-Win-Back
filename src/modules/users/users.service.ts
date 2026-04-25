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
import { randomBytes } from 'node:crypto';
import { MediaLibraryService } from '../media-library/media-library.service';
import { MailService } from '../auth/mail.service';

/** Символы для публичного кода (без 0/O, I, L). */
const WinWinCrockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' as const;

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
    private mail: MailService,
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

  /**
   * Привязка по публичному ref-коду (регистрация или accept invite). Идемпотентно, если upline уже есть.
   */
  private async winWinReferralLevelInTx(
    tx: Prisma.TransactionClient,
    inviterUserId: string,
  ): Promise<1 | 2> {
    const inviterIsL1UnderRoot = await tx.referral.findFirst({
      where: { referredId: inviterUserId, level: 1 },
      select: { id: true },
    });
    return inviterIsL1UnderRoot ? 2 : 1;
  }

  /**
   * Запрет циклов в дереве рефералов.
   *
   * Проверяем, что `referredId` не является предком `referrerId`:
   * referrerId -> ... -> referredId (по цепочке "кто пригласил X").
   *
   * В модели Win-Win глубина обычно 2, но для защиты от неконсистентных данных
   * ставим ограничение на шаги.
   */
  private async assertNoWinWinReferralCycleInTx(
    tx: Prisma.TransactionClient,
    referrerId: string,
    referredId: string,
  ): Promise<void> {
    if (!referrerId || !referredId) return;
    if (referrerId === referredId) {
      throw new BadRequestException('Нельзя привязать пользователя к самому себе');
    }
    let cur = referrerId;
    for (let k = 0; k < 12; k++) {
      const rel = await tx.referral.findFirst({
        where: { referredId: cur },
        select: { referrerId: true },
      });
      if (!rel?.referrerId) return;
      if (rel.referrerId === referredId) {
        throw new BadRequestException('Нельзя создать цикл в реферальной структуре');
      }
      if (rel.referrerId === cur) {
        // на всякий случай от "битого" ребра A->A в БД
        throw new BadRequestException('Неконсистентная реферальная структура');
      }
      cur = rel.referrerId;
    }
  }

  private async tryAttachWinWinReferralInTx(
    tx: Prisma.TransactionClient,
    newUserId: string,
    refRaw: string,
  ): Promise<void> {
    const t = (refRaw ?? '').trim();
    if (t.length < 3) return;
    const inv = await this.findActivePartnerByPublicReferralCode(t);
    if (!inv || inv.userId === newUserId) return;
    const level = await this.winWinReferralLevelInTx(tx, inv.userId);
    const clash = await tx.referral.findUnique({ where: { referredId: newUserId } });
    if (clash) return;
    try {
      await this.assertNoWinWinReferralCycleInTx(tx, inv.userId, newUserId);
      await tx.referral.create({
        data: { referrerId: inv.userId, referredId: newUserId, level },
      });
    } catch (e) {
      // Игнорируем только конфликт уникальности `Referral.referredId` (гонка).
      const code = typeof e === 'object' && e && 'code' in e ? (e as { code?: unknown }).code : undefined;
      if (code === 'P2002') return;
      throw e;
    }
  }

  /** Существующий USER: проставить реф-дерево по коду, если ещё нет записи Referred. */
  async tryAttachWinWinReferralByCodeForExistingUser(userId: string, refRaw: string): Promise<void> {
    await this.prisma.$transaction((tx) => this.tryAttachWinWinReferralInTx(tx, userId, refRaw));
  }

  async createRetailUser(dto: {
    phone: string | null;
    email: string | null;
    password: string;
    consentPersonalData: boolean;
    consentSms: boolean;
    /** Публичный реф. номер партнёра Win-Win: L1, если владелец — не L1; иначе L2. */
    referralCode?: string | null;
    /** После `DesignerInvite` — погасить приглашение. */
    designerInviteId?: string | null;
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
    const refRaw = (dto.referralCode ?? '').trim();
    const designerInviteId = (dto.designerInviteId ?? '').trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
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

      if (refRaw.length >= 3) {
        await this.tryAttachWinWinReferralInTx(tx, user.id, refRaw);
      }

      if (designerInviteId && email) {
        const ex = await tx.designerInvite.findFirst({
          where: {
            id: designerInviteId,
            consumedAt: null,
            emailNorm: email,
            expiresAt: { gt: new Date() },
          },
        });
        if (ex) {
          await tx.designerInvite.update({
            where: { id: ex.id },
            data: { consumedAt: new Date() },
          });
        }
      }

      const { passwordHash: _pw, ...safe } = user;
      return safe;
    });
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

    const designerWhere: Prisma.UserWhereInput = {
      ...where,
      profile: { is: { winWinPartnerApproved: true } },
    };

    const [items, total, designerTotal] = await Promise.all([
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
          profile: { select: { firstName: true, lastName: true, winWinPartnerApproved: true } },
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: designerWhere }),
    ]);

    return { items, total, designerTotal };
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
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const email = u?.email?.trim() ? u.email.trim() : null;
    return {
      ...p,
      email,
      referralInviteCodeExempt: this.isReferralInviteCodeExempt(email),
    };
  }

  /** Список email (через запятую в `WINWIN_REFERRAL_EXEMPT_EMAILS`) без обязательного реф. кода (первые на платформе). */
  private isReferralInviteCodeExempt(email: string | null | undefined): boolean {
    const raw = process.env.WINWIN_REFERRAL_EXEMPT_EMAILS ?? '';
    if (!raw.trim() || !email?.trim()) return false;
    const set = new Set(
      raw
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0),
    );
    return set.has(email.trim().toLowerCase());
  }

  /** Нормализация введённого кода (как в БД: без пробелов/дефисов, upper). */
  private normalizeWinWinPublicReferralCodeInput(raw: string): string {
    return raw.replace(/[\s-]/g, '').toUpperCase();
  }

  /**
   * Партнёр по публичному реф. коду (только одобренные).
   * Нужно для кликабельного реф. кода в админке.
   */
  async findActivePartnerByWinWinPublicReferralCodeForAdmin(
    raw: string,
  ): Promise<{ userId: string; winWinReferralCode: string } | null> {
    return this.findActivePartnerByPublicReferralCode(raw);
  }

  /**
   * Профиль одобренного партнёра с таким публичным реф. кодом.
   * `raw` — ввод пользователя; сравнение с `UserProfile.winWinReferralCode`.
   */
  private async findActivePartnerByPublicReferralCode(
    raw: string,
  ): Promise<{ userId: string; winWinReferralCode: string } | null> {
    const n = this.normalizeWinWinPublicReferralCodeInput(raw);
    if (n.length < 3) return null;
    const p = await this.prisma.userProfile.findFirst({
      where: { winWinPartnerApproved: true, winWinReferralCode: n },
      select: { userId: true, winWinReferralCode: true },
    });
    if (!p?.winWinReferralCode) return null;
    return { userId: p.userId, winWinReferralCode: p.winWinReferralCode };
  }

  private randomWinWinReferralCodeBytes(length: number): string {
    const buf = randomBytes(length);
    let s = '';
    for (let i = 0; i < length; i++) s += WinWinCrockford[buf[i]! % 32]!;
    return s;
  }

  /** Публичный реф. код для партнёра (у одобренных; уникален). */
  async ensureWinWinReferralCodeForUser(userId: string): Promise<string> {
    const row = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (row?.winWinReferralCode) return row.winWinReferralCode;
    for (let k = 0; k < 32; k++) {
      const candidate = this.randomWinWinReferralCodeBytes(8);
      try {
        const u = await this.prisma.userProfile.update({
          where: { userId },
          data: { winWinReferralCode: candidate },
        });
        return u.winWinReferralCode!;
      } catch {
        /* unique collision */
      }
    }
    throw new BadRequestException('Не удалось сгенерировать реферальный номер');
  }

  async listPartnerApplicationsForAdmin(params: { skip: number; take: number }) {
    const take = Math.min(100, Math.max(1, params.take));
    const skip = Math.max(0, params.skip);
    const where = {
      role: UserRole.USER,
      isActive: true,
      profile: {
        is: {
          partnerApplicationSubmittedAt: { not: null },
          winWinPartnerApproved: false,
          partnerApplicationRejectedAt: null,
        },
      },
    } as const;
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { profile: { partnerApplicationSubmittedAt: 'desc' } },
        skip,
        take,
        include: {
          profile: {
            select: {
              firstName: true,
              lastName: true,
              city: true,
              partnerApplicationSubmittedAt: true,
              partnerApplicationReferralCode: true,
              partnerApplicationCvUrl: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  /** Сколько заявок на партнёра в очереди (для бейджа в админ-меню). */
  async countPendingPartnerApplicationsForAdmin(): Promise<{ total: number }> {
    const where = {
      role: UserRole.USER,
      isActive: true,
      profile: {
        is: {
          partnerApplicationSubmittedAt: { not: null },
          winWinPartnerApproved: false,
          partnerApplicationRejectedAt: null,
        },
      },
    } as const;
    const total = await this.prisma.user.count({ where });
    return { total };
  }

  /**
   * Одобрение заявки: партнёр, реф. код, запись в Referral (L1/L2 рассчитывается так же, как в `tryAttachWinWinReferralInTx`),
   * если в заявке был валидный чужой ref-код и пользователь ещё не привязан.
   */
  async approveWinWinPartnerByAdmin(targetUserId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const p = await tx.userProfile.findUnique({ where: { userId: targetUserId } });
      if (!p?.partnerApplicationSubmittedAt) {
        throw new BadRequestException('Нет заявки на рассмотрении');
      }
      if (p.winWinPartnerApproved) {
        throw new BadRequestException('Пользователь уже партнёр Win-Win');
      }
      if (p.partnerApplicationRejectedAt) {
        throw new BadRequestException('Заявка отклонена, ожидается повторная подача');
      }

      let publicCode = p.winWinReferralCode;
      if (!publicCode) {
        for (let k = 0; k < 32; k++) {
          const candidate = this.randomWinWinReferralCodeBytes(8);
          const clash = await tx.userProfile.findFirst({ where: { winWinReferralCode: candidate } });
          if (!clash) {
            publicCode = candidate;
            break;
          }
        }
        if (!publicCode) {
          throw new BadRequestException('Не удалось сгенерировать реферальный номер');
        }
      }

      await tx.userProfile.update({
        where: { userId: targetUserId },
        data: {
          winWinPartnerApproved: true,
          winWinReferralCode: publicCode,
          partnerApplicationRejectedAt: null,
        },
      });

      const u = await tx.user.findUnique({
        where: { id: targetUserId },
        select: {
          email: true,
          profile: { select: { firstName: true, lastName: true } },
        },
      });

      if (p.partnerApplicationReferralCode?.trim()) {
        const n = this.normalizeWinWinPublicReferralCodeInput(p.partnerApplicationReferralCode);
        const inv = await tx.userProfile.findFirst({
          where: { winWinPartnerApproved: true, winWinReferralCode: n },
        });
        if (inv && inv.userId !== targetUserId) {
          const ex = await tx.referral.findUnique({ where: { referredId: targetUserId } });
          if (!ex) {
            const level = await this.winWinReferralLevelInTx(tx, inv.userId);
            await this.assertNoWinWinReferralCycleInTx(tx, inv.userId, targetUserId);
            await tx.referral.create({
              data: { referrerId: inv.userId, referredId: targetUserId, level },
            });
          }
        }
      }

      const email = u?.email?.trim() ? u.email.trim().toLowerCase() : null;
      const name =
        [u?.profile?.firstName, u?.profile?.lastName]
          .filter((x) => x && String(x).trim().length > 0)
          .map((x) => String(x).trim())
          .join(' ') || null;
      return { ok: true as const, winWinReferralCode: publicCode!, email, name };
    });

    // Письмо о смене статуса — best-effort (не блокируем апрув).
    if (result.email) {
      this.mail
        .sendWinWinPartnerApproved({
          to: result.email,
          name: result.name,
          referralCode: result.winWinReferralCode,
        })
        .catch(() => undefined);
    }
    const { email: _e, name: _n, ...publicResult } = result;
    return publicResult;
  }

  /** Отклонение заявки: данные в профиле сохраняются для просмотра, из очереди снимается. */
  async rejectWinWinPartnerByAdmin(targetUserId: string) {
    const p = await this.prisma.userProfile.findUnique({ where: { userId: targetUserId } });
    if (!p?.partnerApplicationSubmittedAt) {
      throw new BadRequestException('Нет заявки на рассмотрении');
    }
    if (p.winWinPartnerApproved) {
      throw new BadRequestException('Пользователь уже партнёр Win-Win');
    }
    if (p.partnerApplicationRejectedAt) {
      throw new BadRequestException('Заявка уже отклонена');
    }
    await this.prisma.userProfile.update({
      where: { userId: targetUserId },
      data: { partnerApplicationRejectedAt: new Date() },
    });
    return { ok: true as const };
  }

  /**
   * L1 (прямые) и L2 (привлечённые ими) для админки «Структура дизайнера».
   * L2 — записи `Referral` с `level: 2` и `referrerId` = userId участника L1.
   */
  async getWinWinReferralStructureForAdmin(partnerUserId: string) {
    const p = await this.prisma.userProfile.findUnique({
      where: { userId: partnerUserId },
      select: { winWinPartnerApproved: true },
    });
    if (!p?.winWinPartnerApproved) {
      return {
        l1: [] as {
          id: string;
          userId: string;
          email: string | null;
          name: string;
          isPartner: boolean;
          joinedAt: string;
          l2: { id: string; userId: string; email: string | null; name: string; isPartner: boolean; joinedAt: string }[];
        }[],
      };
    }
    const l1Rels = await this.prisma.referral.findMany({
      where: { referrerId: partnerUserId, level: 1 },
      orderBy: { createdAt: 'asc' },
      include: {
        referred: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
                winWinPartnerApproved: true,
                partnerApplicationRejectedAt: true,
              },
            },
          },
        },
      },
    });
    const l1Ids = l1Rels.map((r) => r.referredId);
    const l2Rels =
      l1Ids.length > 0
        ? await this.prisma.referral.findMany({
            where: { referrerId: { in: l1Ids }, level: 2 },
            orderBy: { createdAt: 'asc' },
            include: {
              referred: {
                select: {
                  id: true,
                  email: true,
                  profile: {
                    select: {
                      firstName: true,
                      lastName: true,
                      winWinPartnerApproved: true,
                      partnerApplicationRejectedAt: true,
                    },
                  },
                },
              },
            },
          })
        : [];
    const l2ByL1 = new Map<string, typeof l2Rels>();
    for (const r2 of l2Rels) {
      const list = l2ByL1.get(r2.referrerId) ?? [];
      list.push(r2);
      l2ByL1.set(r2.referrerId, list);
    }
    const mapRow = (r2: (typeof l2Rels)[0]) => {
      if (r2.referred.profile?.partnerApplicationRejectedAt) return null;
      const f2 = r2.referred.profile?.firstName?.trim() ?? '';
      const l2n = r2.referred.profile?.lastName?.trim() ?? '';
      const name2 = [f2, l2n].filter(Boolean).join(' ') || '—';
      return {
        id: r2.id,
        userId: r2.referredId,
        email: r2.referred.email,
        name: name2,
        isPartner: Boolean(r2.referred.profile?.winWinPartnerApproved),
        joinedAt: r2.createdAt.toISOString(),
      };
    };
    const l1 = l1Rels.flatMap((r) => {
      if (r.referred.profile?.partnerApplicationRejectedAt) return [];
      const f = r.referred.profile?.firstName?.trim() ?? '';
      const l = r.referred.profile?.lastName?.trim() ?? '';
      const name = [f, l].filter(Boolean).join(' ') || '—';
      const l2 = (l2ByL1.get(r.referredId) ?? []).map(mapRow).filter(Boolean) as {
        id: string;
        userId: string;
        email: string | null;
        name: string;
        isPartner: boolean;
        joinedAt: string;
      }[];
      return {
        id: r.id,
        userId: r.referredId,
        email: r.referred.email,
        name,
        isPartner: Boolean(r.referred.profile?.winWinPartnerApproved),
        joinedAt: r.createdAt.toISOString(),
        l2,
      };
    });
    return { l1 };
  }

  /** Пригласивший партнёр (кто «над» в структуре). */
  async getWinWinReferralInviterForAdmin(userId: string): Promise<{
    referrerId: string;
    email: string | null;
    name: string;
    winWinReferralCode: string | null;
    joinedAt: string;
  } | null> {
    const rel = await this.prisma.referral.findFirst({
      where: { referredId: userId },
      orderBy: { createdAt: 'asc' },
      include: {
        referrer: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true, winWinReferralCode: true } },
          },
        },
      },
    });
    if (!rel?.referrer) return null;
    const f = rel.referrer.profile?.firstName?.trim() ?? '';
    const l = rel.referrer.profile?.lastName?.trim() ?? '';
    const name = [f, l].filter(Boolean).join(' ') || '—';
    return {
      referrerId: rel.referrer.id,
      email: rel.referrer.email,
      name,
      winWinReferralCode: rel.referrer.profile?.winWinReferralCode ?? null,
      joinedAt: rel.createdAt.toISOString(),
    };
  }

  /** Заявка на статус партнёра Win-Win (текст + CV). */
  async submitPartnerApplication(
    userId: string,
    file: Express.Multer.File,
    coverLetter: string,
    referralCode: string | undefined,
  ) {
    const text = (coverLetter ?? '').trim();
    if (text.length < 20) {
      throw new BadRequestException('Расскажите о себе: не меньше 20 символов');
    }
    if (text.length > 50_000) {
      throw new BadRequestException('Слишком длинный текст');
    }
    if (!file) {
      throw new BadRequestException('Прикрепите файл CV');
    }

    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const email = u?.email?.trim() ? u.email.trim() : null;
    const exempt = this.isReferralInviteCodeExempt(email);
    const code = (referralCode ?? '').trim();
    let storedRef: string | null = null;
    if (!exempt) {
      // Анти-перебор: одинаковая задержка и недифференцированная ошибка.
      const delayMs = 250;
      await new Promise((r) => setTimeout(r, delayMs));
      const invalid = code.length < 3 || code.length > 64;
      const inv = invalid ? null : await this.findActivePartnerByPublicReferralCode(code);
      if (invalid || !inv || inv.userId === userId) {
        throw new BadRequestException('Некорректные данные');
      }
      storedRef = inv.winWinReferralCode;
    }

    const before = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (before?.winWinPartnerApproved) {
      throw new BadRequestException('Вы уже партнёр Win-Win');
    }
    if (before?.partnerApplicationSubmittedAt && !before?.partnerApplicationRejectedAt) {
      throw new BadRequestException('Заявка уже подана');
    }

    this.media.assertLkProfileRichFile(file);
    const { publicUrl } = await this.uploadToUserProfileFolder(userId, file);
    const now = new Date();

    await this.prisma.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        partnerApplicationCoverLetter: text,
        partnerApplicationCvUrl: publicUrl,
        partnerApplicationSubmittedAt: now,
        partnerApplicationReferralCode: storedRef,
        partnerApplicationRejectedAt: null,
      },
      update: {
        partnerApplicationCoverLetter: text,
        partnerApplicationCvUrl: publicUrl,
        partnerApplicationSubmittedAt: now,
        partnerApplicationReferralCode: storedRef,
        partnerApplicationRejectedAt: null,
      },
    });
    return this.getUserProfileVitrine(userId);
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
    let u = await this.prisma.user.findFirst({
      where: { id, role: UserRole.USER, isActive: true },
      include: { profile: true },
    });
    if (!u) throw new NotFoundException('User not found');
    if (u.profile?.winWinPartnerApproved && !u.profile.winWinReferralCode) {
      await this.ensureWinWinReferralCodeForUser(id);
      u = await this.prisma.user.findFirst({
        where: { id, role: UserRole.USER, isActive: true },
        include: { profile: true },
      });
      if (!u) throw new NotFoundException('User not found');
    }
    const { passwordHash: _, ...safe } = u;
    return {
      ...safe,
      referralInviteCodeExempt: this.isReferralInviteCodeExempt(safe.email),
    };
  }
}
