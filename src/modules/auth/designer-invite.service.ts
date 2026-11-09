import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { inviteInvalid, inviteMismatch } from './designer-invite.errors';
import { ConfigService } from '@nestjs/config';
import { resolveSecret } from '../../config/resolve-secret';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from './mail.service';
import { UsersService } from '../users/users.service';
import { InviteClaimService } from './invite-claim.service';
import {
  DESIGNER_INVITE_BURST_LIMIT,
  DESIGNER_INVITE_BURST_WINDOW_MS,
  DESIGNER_INVITE_DAILY_LIMIT,
  DESIGNER_INVITE_LIST_LIMIT,
  DESIGNER_INVITE_TTL_DAYS,
  DESIGNER_INVITE_TTL_JWT,
  DESIGNER_INVITE_TTL_LABEL,
  DESIGNER_PARTNER_FALLBACK_NAME,
} from './designer-invite.constants';

const INVITE_JWT_MAX = 64 * 1024;

export const DESIGNER_INVITE_REJECT_ALREADY_HAS_SPONSOR = 'already_has_sponsor';
/** Одобренный партнёр / пользователь с командой — привязка только после одобрения админа. */
export const DESIGNER_INVITE_REJECT_NEEDS_ADMIN = 'needs_admin_approval';
/** Админ отклонил заявку на перевод в структуру. */
export const DESIGNER_INVITE_REJECT_ADMIN_REJECTED = 'admin_rejected';

const REJECT_REASON_LABELS: Record<string, string> = {
  [DESIGNER_INVITE_REJECT_ALREADY_HAS_SPONSOR]: 'Отклонено: уже в структуре',
  [DESIGNER_INVITE_REJECT_NEEDS_ADMIN]: 'Ожидает одобрения админа',
  [DESIGNER_INVITE_REJECT_ADMIN_REJECTED]: 'Отклонено администратором',
};

@Injectable()
export class DesignerInviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly users: UsersService,
    private readonly inviteClaim: InviteClaimService,
  ) {}

  private publicSiteBase(): string {
    const fromEnv =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '');
    if (fromEnv?.trim()) return fromEnv.trim();

    // Локальная разработка: если переменную забыли — лучше рабочий localhost, чем несуществующий домен.
    const nodeEnv = this.config.get<string>('NODE_ENV') || process.env.NODE_ENV;
    if (!nodeEnv || nodeEnv === 'development') {
      return 'http://localhost:3000';
    }

    // Прод: ссылка в письме должна быть реальным публичным URL витрины (IP/домен).
    throw new BadRequestException('Не задан FRONTEND_PUBLIC_URL для ссылки в письме');
  }

  private secret(): string {
    return (
      this.config.get<string>('DESIGNER_INVITE_JWT_SECRET')?.trim() ||
      resolveSecret('JWT_SECRET', this.config.get<string>('JWT_SECRET'))
    );
  }

  private inviterDisplayName(inviter: {
    email: string | null;
    profile?: { firstName?: string | null; lastName?: string | null } | null;
  }): string {
    const fromName = [inviter.profile?.firstName, inviter.profile?.lastName]
      .filter((x) => x != null && String(x).trim().length > 0)
      .map((s) => String(s).trim())
      .join(' ');
    return fromName || (inviter.email ? inviter.email : DESIGNER_PARTNER_FALLBACK_NAME);
  }

  private async buildInviteLinkForRow(rowId: string): Promise<string> {
    const token = await this.jwt.signAsync(
      { sub: rowId, typ: 'dinv' },
      { secret: this.secret(), expiresIn: DESIGNER_INVITE_TTL_JWT },
    );
    if (token.length > INVITE_JWT_MAX) {
      throw new BadRequestException('Не удалось сформировать ссылку');
    }
    return `${this.publicSiteBase()}/invite/designer?t=${encodeURIComponent(token)}`;
  }

  private async assertApprovedPartnerInviter(inviterUserId: string) {
    const inviter = await this.prisma.user.findFirst({
      where: { id: inviterUserId, role: UserRole.USER, isActive: true },
      include: {
        profile: {
          select: { winWinPartnerApproved: true, winWinReferralCode: true, firstName: true, lastName: true },
        },
      },
    });
    if (!inviter) throw new NotFoundException('Пользователь не найден');
    if (!inviter.profile?.winWinPartnerApproved) {
      throw new ForbiddenException('Доступно только одобренным дизайнерам-партнёрам Wupapa');
    }
    return inviter;
  }

  /** Приглашённый в downline пригласившего (по цепочке Referral). */
  private async isInInviterDownline(inviterUserId: string, userId: string): Promise<boolean> {
    let cur = userId;
    for (let i = 0; i < 32; i++) {
      const rel = await this.prisma.referral.findFirst({
        where: { referredId: cur },
        select: { referrerId: true },
      });
      if (!rel) return false;
      if (rel.referrerId === inviterUserId) return true;
      cur = rel.referrerId;
    }
    return false;
  }

  /** Предупреждение при отправке, если email уже в аккаунте/структуре. */
  private async recipientInviteWarning(inviterUserId: string, email: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true, role: UserRole.USER },
      select: {
        id: true,
        profile: { select: { winWinPartnerApproved: true } },
      },
    });
    if (!user) return null;

    if (user.profile?.winWinPartnerApproved) {
      return 'Этот email уже принадлежит одобренному дизайнеру-партнёру Wupapa.';
    }

    const hasSponsor = await this.prisma.referral.findUnique({
      where: { referredId: user.id },
      select: { referrerId: true },
    });
    if (!hasSponsor) return null;

    if (await this.isInInviterDownline(inviterUserId, user.id)) {
      return 'Этот пользователь уже в вашей команде.';
    }
    return 'Этот пользователь уже в другой структуре.';
  }

  private async assertInviteInviterStillApproved(inviteId: string): Promise<void> {
    const row = await this.prisma.designerInvite.findUnique({
      where: { id: inviteId },
      select: {
        inviter: {
          select: {
            profile: { select: { winWinPartnerApproved: true } },
          },
        },
      },
    });
    if (!row?.inviter.profile?.winWinPartnerApproved) {
      throw inviteInvalid(
        'Пригласивший больше не является дизайнером-партнёром Wupapa. Ссылка недействительна — попросите новое приглашение.',
      );
    }
  }

  private classifyInviteStatus(row: {
    consumedAt: Date | null;
    revokedAt: Date | null;
    rejectedAt: Date | null;
    rejectReason: string | null;
    expiresAt: Date;
  }, now: Date): {
    status: 'pending' | 'pending_admin' | 'accepted' | 'expired' | 'revoked' | 'rejected';
    statusLabel: string;
    rejectReason: string | null;
  } {
    if (row.consumedAt) {
      return { status: 'accepted', statusLabel: 'Принято', rejectReason: null };
    }
    if (row.revokedAt) {
      return { status: 'revoked', statusLabel: 'Отозвано', rejectReason: null };
    }
    if (row.rejectedAt) {
      const reason = (row.rejectReason ?? '').trim();
      if (reason === DESIGNER_INVITE_REJECT_NEEDS_ADMIN) {
        return {
          status: 'pending_admin',
          statusLabel: 'Ожидает одобрения админа',
          rejectReason: reason,
        };
      }
      return {
        status: 'rejected',
        statusLabel: REJECT_REASON_LABELS[reason] ?? 'Отклонено',
        rejectReason: reason || null,
      };
    }
    if (row.expiresAt <= now) {
      return { status: 'expired', statusLabel: 'Истекло', rejectReason: null };
    }
    return { status: 'pending', statusLabel: 'Ожидает', rejectReason: null };
  }

  /**
   * История приглашений партнёра (без superseded):
   * ожидает / принято / истекло / отозвано (+ отклонено «уже в структуре»).
   * Список — последние N; statusCounts — по всей истории.
   */
  async listActiveInvitesForUser(inviterUserId: string) {
    await this.assertApprovedPartnerInviter(inviterUserId);
    const now = new Date();
    const where = {
      inviterId: inviterUserId,
      supersededAt: null,
    } as const;

    const [statusRows, rows] = await Promise.all([
      this.prisma.designerInvite.findMany({
        where,
        select: {
          consumedAt: true,
          rejectedAt: true,
          rejectReason: true,
          revokedAt: true,
          expiresAt: true,
        },
      }),
      this.prisma.designerInvite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: DESIGNER_INVITE_LIST_LIMIT,
        select: {
          id: true,
          emailNorm: true,
          createdAt: true,
          expiresAt: true,
          consumedAt: true,
          rejectedAt: true,
          rejectReason: true,
          revokedAt: true,
        },
      }),
    ]);

    const statusCounts = {
      pending: 0,
      pending_admin: 0,
      accepted: 0,
      expired: 0,
      revoked: 0,
      rejected: 0,
    };
    for (const row of statusRows) {
      statusCounts[this.classifyInviteStatus(row, now).status] += 1;
    }
    const total = statusRows.length;
    const truncated = total > DESIGNER_INVITE_LIST_LIMIT;

    const items = await Promise.all(
      rows.map(async (row) => {
        const classified = this.classifyInviteStatus(row, now);
        const canRevoke =
          classified.status === 'pending' || classified.status === 'pending_admin';
        const canResend =
          classified.status === 'pending' ||
          classified.status === 'expired' ||
          classified.status === 'revoked';
        return {
          id: row.id,
          email: row.emailNorm,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          status: classified.status,
          statusLabel: classified.statusLabel,
          rejectReason: classified.rejectReason,
          canRevoke,
          canResend,
          inviteLink:
            classified.status === 'pending' ? await this.buildInviteLinkForRow(row.id) : '',
        };
      }),
    );
    return {
      items,
      total,
      truncated,
      listLimit: DESIGNER_INVITE_LIST_LIMIT,
      statusCounts,
    };
  }

  /** Отозвать ожидающее приглашение — ссылка перестаёт работать. */
  async revokeInvite(inviterUserId: string, inviteId: string) {
    await this.assertApprovedPartnerInviter(inviterUserId);
    const id = inviteId.trim();
    if (!id) throw new BadRequestException('Некорректное приглашение');
    const now = new Date();
    const row = await this.prisma.designerInvite.findFirst({
      where: {
        id,
        inviterId: inviterUserId,
        consumedAt: null,
        supersededAt: null,
        revokedAt: null,
      },
      select: { id: true, rejectedAt: true, rejectReason: true, expiresAt: true },
    });
    if (!row) {
      throw new BadRequestException('Можно отозвать только ожидающее приглашение');
    }
    const pendingFresh = !row.rejectedAt && row.expiresAt > now;
    const pendingAdmin =
      Boolean(row.rejectedAt) && row.rejectReason === DESIGNER_INVITE_REJECT_NEEDS_ADMIN;
    if (!pendingFresh && !pendingAdmin) {
      throw new BadRequestException('Можно отозвать только ожидающее приглашение');
    }
    await this.prisma.designerInvite.update({
      where: { id: row.id },
      data: { revokedAt: now },
    });
    return { ok: true as const };
  }

  /** Переотправить: новое письмо/ссылка на тот же email (старое pending → superseded). */
  async resendInvite(inviterUserId: string, inviteId: string) {
    await this.assertApprovedPartnerInviter(inviterUserId);
    const id = inviteId.trim();
    if (!id) throw new BadRequestException('Некорректное приглашение');
    const row = await this.prisma.designerInvite.findFirst({
      where: { id, inviterId: inviterUserId, supersededAt: null },
      select: {
        emailNorm: true,
        consumedAt: true,
      },
    });
    if (!row) throw new NotFoundException('Приглашение не найдено');
    if (row.consumedAt) {
      throw new BadRequestException('Приглашение уже принято — переотправка не нужна');
    }
    return this.sendInvite(inviterUserId, row.emailNorm, { force: true });
  }

  async sendInvite(inviterUserId: string, emailRaw: string, opts?: { force?: boolean }) {
    const inviter = await this.assertApprovedPartnerInviter(inviterUserId);
    const refCode = await this.users.ensureWinWinReferralCodeForUser(inviterUserId);
    if (!refCode) throw new BadRequestException('Не удалось получить реферальный номер');
    const email = emailRaw.trim().toLowerCase();
    if (!email.includes('@') || email.length < 4) {
      throw new BadRequestException('Некорректный email');
    }
    if (inviter.email && inviter.email.toLowerCase() === email) {
      throw new BadRequestException('Нельзя пригласить самого себя');
    }

    const existingAccount = await this.prisma.user.findFirst({
      where: { email, isActive: true },
      select: { role: true },
    });
    if (
      existingAccount &&
      (existingAccount.role === UserRole.ADMIN || existingAccount.role === UserRole.MODERATOR)
    ) {
      throw new BadRequestException(
        'Этот email принадлежит сотруднику Wupapa. Укажите другой адрес для приглашения дизайнера-партнёра.',
      );
    }

    const recipientWarning = await this.recipientInviteWarning(inviterUserId, email);
    if (recipientWarning && !opts?.force) {
      return {
        ok: false as const,
        needsConfirmation: true as const,
        recipientWarning,
      };
    }

    const burstSince = new Date(Date.now() - DESIGNER_INVITE_BURST_WINDOW_MS);
    const burstCount = await this.prisma.designerInvite.count({
      where: { inviterId: inviterUserId, createdAt: { gte: burstSince } },
    });
    if (burstCount >= DESIGNER_INVITE_BURST_LIMIT) {
      throw new BadRequestException(
        'Слишком много приглашений за короткое время. Подождите несколько минут и попробуйте снова.',
      );
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dayCount = await this.prisma.designerInvite.count({
      where: { inviterId: inviterUserId, createdAt: { gte: since } },
    });
    if (dayCount >= DESIGNER_INVITE_DAILY_LIMIT) {
      throw new BadRequestException(
        `Достигнут лимит: не более ${DESIGNER_INVITE_DAILY_LIMIT} приглашений в сутки. Попробуйте завтра.`,
      );
    }

    const expiresAt = new Date(Date.now() + DESIGNER_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const row = await this.prisma.designerInvite.create({
      data: { inviterId: inviterUserId, emailNorm: email, refCode, expiresAt },
    });

    try {
      const link = await this.buildInviteLinkForRow(row.id);
      const invName = this.inviterDisplayName(inviter);
      const emailSent = await this.mail.sendDesignerInvite({
        to: email,
        inviteLink: link,
        inviterLabel: invName,
        refCode,
      });
      /** Старые гасим только после успешного mail-вызова (в т.ч. emailSent:false при выключенном шаблоне). */
      await this.prisma.designerInvite.updateMany({
        where: {
          inviterId: inviterUserId,
          emailNorm: email,
          consumedAt: null,
          supersededAt: null,
          revokedAt: null,
          rejectedAt: null,
          expiresAt: { gt: new Date() },
          id: { not: row.id },
        },
        data: { supersededAt: new Date() },
      });
      return {
        ok: true as const,
        emailSent,
        expiresAt: expiresAt.toISOString(),
        inviteLink: link,
        inviteTtlDays: DESIGNER_INVITE_TTL_DAYS,
        inviteTtlLabel: DESIGNER_INVITE_TTL_LABEL,
      };
    } catch (err) {
      await this.prisma.designerInvite.delete({ where: { id: row.id } }).catch(() => undefined);
      if (err instanceof BadRequestException || err instanceof ForbiddenException || err instanceof NotFoundException) {
        throw err;
      }
      throw new BadRequestException('Не удалось отправить письмо с приглашением. Повторите позже.');
    }
  }

  async verifyToken(token: string) {
    let payload: { sub?: string; typ?: string; exp?: number };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: string; typ?: string; exp?: number }>(token, {
        secret: this.secret(),
      });
    } catch {
      throw inviteInvalid('Ссылка приглашения недействительна или истекла');
    }
    if (payload.typ !== 'dinv' || !payload.sub) {
      throw inviteInvalid('Ссылка приглашения недействительна');
    }
    const row = await this.prisma.designerInvite.findUnique({
      where: { id: payload.sub },
      include: {
        inviter: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                winWinPartnerApproved: true,
                firstName: true,
                lastName: true,
                winWinReferralCode: true,
              },
            },
          },
        },
      },
    });
    if (!row) throw inviteInvalid('Приглашение не найдено');
    if (row.supersededAt) {
      throw inviteInvalid(
        'Приглашение заменено новым. Используйте ссылку из последнего письма или запросите приглашение снова.',
      );
    }
    if (row.revokedAt) {
      throw inviteInvalid('Приглашение отозвано');
    }
    if (row.rejectedAt) {
      const label =
        REJECT_REASON_LABELS[(row.rejectReason ?? '').trim()] ?? 'Приглашение отклонено';
      throw inviteInvalid(label);
    }
    if (row.consumedAt) {
      throw inviteInvalid('Приглашение уже использовано');
    }
    if (row.expiresAt < new Date()) {
      throw inviteInvalid('Срок приглашения истёк');
    }
    if (!row.inviter.profile?.winWinPartnerApproved) {
      throw inviteInvalid(
        'Пригласивший больше не является дизайнером-партнёром Wupapa. Ссылка недействительна — попросите новое приглашение.',
      );
    }

    const existing = await this.prisma.user.findFirst({
      where: { email: row.emailNorm, isActive: true },
      select: { id: true, role: true },
    });
    const isStaff =
      existing != null &&
      (existing.role === UserRole.ADMIN || existing.role === UserRole.MODERATOR);
    const inviterLabel = this.inviterDisplayName(row.inviter);
    return {
      email: row.emailNorm,
      prefillRef: row.refCode,
      accountExists: Boolean(existing),
      /** `none` — можно регистрировать; `customer` — войти в ЛК; `staff` — нельзя принять как партнёр. */
      accountKind: !existing ? ('none' as const) : isStaff ? ('staff' as const) : ('customer' as const),
      inviterLabel,
      joinTeamMessage: `Вы войдёте в команду ${inviterLabel}`,
      /** Напоминание: аккаунт только по телефону не находится по email приглашения. */
      phoneAccountHint:
        'Если у вас аккаунт по телефону без email — войдите и добавьте email из приглашения, иначе можно создать дубликат.',
    };
  }

  /** Проверка токена перед `register/complete` — email в регистрации = email в приглашении. */
  async assertValidForNewAccountEmail(
    token: string | null | undefined,
    registrationEmail: string | null,
  ): Promise<{ inviteId: string; refCode: string } | null> {
    const resolved = await this.inviteClaim.resolveForNewRegistration(token, registrationEmail);
    if (!resolved) return null;
    await this.assertInviteInviterStillApproved(resolved.inviteId);
    return resolved;
  }

  /**
   * Вход / ЛК: подтвердить приглашение, привязать реферала по коду из письма.
   * При уже существующем спонсоре — не гасим как consumed, а rejected + attached:false.
   * Одобренный партнёр / пользователь с downline — только через одобрение админа.
   */
  async claimByTokenForUser(userId: string, token: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: UserRole.USER, isActive: true },
      select: {
        id: true,
        email: true,
        profile: { select: { winWinPartnerApproved: true } },
        _count: { select: { referralsMade: true } },
      },
    });
    if (!user?.email) {
      throw inviteMismatch('У аккаунта нет email, приглашение не применимо');
    }
    const resolved = await this.inviteClaim.resolveActiveForEmail(
      token,
      user.email,
      'Приглашение не подходит к этому аккаунту',
    );
    await this.assertInviteInviterStillApproved(resolved.inviteId);

    const inviteMeta = await this.prisma.designerInvite.findUnique({
      where: { id: resolved.inviteId },
      select: { inviterId: true },
    });
    if (!inviteMeta) throw new BadRequestException('Приглашение не найдено');

    /** Уже в команде этого пригласившего (напр. пришёл раньше по общей ?ref=) — считаем принятым. */
    const existingSponsor = await this.prisma.referral.findUnique({
      where: { referredId: userId },
      select: { referrerId: true },
    });
    if (existingSponsor?.referrerId === inviteMeta.inviterId) {
      return this.prisma.$transaction(async (tx) => {
        await this.users.ensurePartnerApplicationReferralCodeIfEmptyInTx(
          tx,
          userId,
          resolved.refCode,
        );
        await this.inviteClaim.consumeInTx(tx, resolved.inviteId, resolved.emailNorm);
        return {
          ok: true as const,
          attached: true as const,
          alreadyInTeam: true as const,
          prefillRef: resolved.refCode,
        };
      });
    }

    /** Чужой спонсор — сразу отклоняем (до очереди админа: одобрить всё равно нельзя). */
    if (existingSponsor) {
      await this.prisma.designerInvite.update({
        where: { id: resolved.inviteId },
        data: {
          rejectedAt: new Date(),
          rejectReason: DESIGNER_INVITE_REJECT_ALREADY_HAS_SPONSOR,
        },
      });
      return {
        ok: true as const,
        attached: false as const,
        reason: DESIGNER_INVITE_REJECT_ALREADY_HAS_SPONSOR,
        message:
          'Не удалось принять приглашение: у вас уже есть спонсор в структуре. Приглашение отклонено.',
      };
    }

    const needsAdmin =
      Boolean(user.profile?.winWinPartnerApproved) || user._count.referralsMade > 0;
    if (needsAdmin) {
      await this.prisma.designerInvite.update({
        where: { id: resolved.inviteId },
        data: {
          rejectedAt: new Date(),
          rejectReason: DESIGNER_INVITE_REJECT_NEEDS_ADMIN,
          claimantUserId: userId,
        },
      });
      return {
        ok: true as const,
        attached: false as const,
        reason: DESIGNER_INVITE_REJECT_NEEDS_ADMIN,
        message:
          'Перевод дизайнера-партнёра или пользователя с командой в другую структуру возможен только после одобрения администратора. Заявка отправлена на проверку.',
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const attach = await this.users.tryAttachWinWinReferralInTx(tx, userId, resolved.refCode);
      if (!attach.attached) {
        if (attach.reason === 'already_has_sponsor') {
          await tx.designerInvite.update({
            where: { id: resolved.inviteId },
            data: {
              rejectedAt: new Date(),
              rejectReason: DESIGNER_INVITE_REJECT_ALREADY_HAS_SPONSOR,
            },
          });
          return {
            ok: true as const,
            attached: false as const,
            reason: DESIGNER_INVITE_REJECT_ALREADY_HAS_SPONSOR,
            message:
              'Не удалось принять приглашение: у вас уже есть спонсор в структуре. Приглашение отклонено.',
          };
        }
        throw new BadRequestException(
          attach.reason === 'invalid_code'
            ? 'Реферальный номер пригласившего недействителен'
            : 'Не удалось привязать приглашение',
        );
      }

      await this.users.ensurePartnerApplicationReferralCodeIfEmptyInTx(
        tx,
        userId,
        attach.sponsorRefCode,
      );
      await this.inviteClaim.consumeInTx(tx, resolved.inviteId, resolved.emailNorm);
      return {
        ok: true as const,
        attached: true as const,
        prefillRef: attach.sponsorRefCode,
      };
    });
  }

  private pendingStructureWhere() {
    return {
      rejectedAt: { not: null },
      rejectReason: DESIGNER_INVITE_REJECT_NEEDS_ADMIN,
      consumedAt: null,
      revokedAt: null,
      supersededAt: null,
    } as const;
  }

  /** Очередь: приглашения, где claim требует одобрения админа (партнёр / downline). */
  async listPendingAdminStructureClaims() {
    const rows = await this.prisma.designerInvite.findMany({
      where: this.pendingStructureWhere(),
      orderBy: { rejectedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        emailNorm: true,
        refCode: true,
        rejectedAt: true,
        createdAt: true,
        inviter: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true, winWinReferralCode: true } },
          },
        },
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        email: row.emailNorm,
        refCode: row.refCode,
        requestedAt: (row.rejectedAt ?? row.createdAt).toISOString(),
        inviterId: row.inviter.id,
        inviterEmail: row.inviter.email,
        inviterLabel: this.inviterDisplayName(row.inviter),
      })),
    };
  }

  async countPendingAdminStructureClaims(): Promise<{ total: number }> {
    const total = await this.prisma.designerInvite.count({
      where: this.pendingStructureWhere(),
    });
    return { total };
  }

  private async loadPendingStructureClaimRow(inviteId: string) {
    const id = inviteId.trim();
    if (!id) throw new BadRequestException('Некорректное приглашение');
    const row = await this.prisma.designerInvite.findUnique({
      where: { id },
      select: {
        id: true,
        emailNorm: true,
        refCode: true,
        consumedAt: true,
        revokedAt: true,
        supersededAt: true,
        rejectedAt: true,
        rejectReason: true,
        expiresAt: true,
        claimantUserId: true,
        inviter: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                winWinPartnerApproved: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Приглашение не найдено');
    if (row.consumedAt) throw new BadRequestException('Приглашение уже использовано');
    if (row.revokedAt) throw new BadRequestException('Приглашение отозвано');
    if (row.supersededAt) throw new BadRequestException('Приглашение заменено новым');
    if (!row.rejectedAt || row.rejectReason !== DESIGNER_INVITE_REJECT_NEEDS_ADMIN) {
      throw new BadRequestException('Приглашение не ожидает одобрения администратора');
    }
    return row;
  }

  /** Claimant по userId с заявки; fallback на emailNorm для старых строк без claimantUserId. */
  private async resolveStructureClaimantUser(row: {
    claimantUserId: string | null;
    emailNorm: string;
  }) {
    if (row.claimantUserId?.trim()) {
      const byId = await this.prisma.user.findFirst({
        where: { id: row.claimantUserId.trim(), role: UserRole.USER, isActive: true },
        select: {
          id: true,
          email: true,
          profile: { select: { firstName: true, lastName: true } },
        },
      });
      if (byId) return byId;
    }
    return this.prisma.user.findFirst({
      where: { email: row.emailNorm, role: UserRole.USER, isActive: true },
      select: {
        id: true,
        email: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    });
  }

  private notifyStructureDecision(params: {
    decision: 'approved' | 'rejected';
    inviteeEmail: string;
    inviteeName: string | null;
    inviterEmail: string | null;
    inviterName: string | null;
  }): void {
    const invitee = params.inviteeEmail.trim().toLowerCase();
    const inviter = params.inviterEmail?.trim().toLowerCase() || null;
    const send =
      params.decision === 'approved'
        ? this.mail.sendDesignerInviteStructureApproved?.bind(this.mail)
        : this.mail.sendDesignerInviteStructureRejected?.bind(this.mail);
    if (typeof send !== 'function') return;
    const payloadBase = {
      inviteeName: params.inviteeName,
      inviterName: params.inviterName,
      inviteeEmail: invitee,
    };
    if (invitee) {
      void Promise.resolve(send({ ...payloadBase, to: invitee, role: 'invitee' as const })).catch(
        () => undefined,
      );
    }
    if (inviter) {
      void Promise.resolve(send({ ...payloadBase, to: inviter, role: 'inviter' as const })).catch(
        () => undefined,
      );
    }
  }

  /** Админ одобряет перевод в структуру пригласившего. */
  async adminApproveStructureClaim(inviteId: string) {
    const row = await this.loadPendingStructureClaimRow(inviteId);
    if (!row.inviter.profile?.winWinPartnerApproved) {
      throw new BadRequestException('Пригласивший больше не является дизайнером-партнёром Wupapa');
    }

    const user = await this.resolveStructureClaimantUser(row);
    if (!user) {
      throw new BadRequestException('Пользователь из заявки не найден');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.designerInvite.update({
        where: { id: row.id },
        data: { rejectedAt: null, rejectReason: null },
      });
      const attach = await this.users.tryAttachWinWinReferralInTx(tx, user.id, row.refCode);
      if (!attach.attached) {
        throw new BadRequestException(
          attach.reason === 'already_has_sponsor'
            ? 'У пользователя уже есть спонсор в структуре'
            : attach.reason === 'invalid_code'
              ? 'Реферальный номер пригласившего недействителен'
              : 'Не удалось привязать к структуре',
        );
      }
      await this.users.ensurePartnerApplicationReferralCodeIfEmptyInTx(
        tx,
        user.id,
        attach.sponsorRefCode,
      );
      /** TTL ссылки не блокирует админ-одобрение: человек уже в очереди. */
      const consumed = await this.inviteClaim.consumeInTx(tx, row.id, row.emailNorm, {
        ignoreExpiry: true,
      });
      if (!consumed) {
        throw new BadRequestException('Не удалось погасить приглашение');
      }
      return {
        ok: true as const,
        attached: true as const,
        userId: user.id,
        prefillRef: attach.sponsorRefCode,
      };
    });

    this.notifyStructureDecision({
      decision: 'approved',
      inviteeEmail: user.email ?? row.emailNorm,
      inviteeName: this.profilePersonName(user.profile),
      inviterEmail: row.inviter.email,
      inviterName: this.profilePersonName(row.inviter.profile),
    });

    return result;
  }

  /** Админ отклоняет заявку на перевод в структуру. */
  async adminRejectStructureClaim(inviteId: string) {
    const row = await this.loadPendingStructureClaimRow(inviteId);

    const user = await this.resolveStructureClaimantUser(row);

    await this.prisma.designerInvite.update({
      where: { id: row.id },
      data: {
        rejectedAt: new Date(),
        rejectReason: DESIGNER_INVITE_REJECT_ADMIN_REJECTED,
      },
    });

    this.notifyStructureDecision({
      decision: 'rejected',
      inviteeEmail: user?.email ?? row.emailNorm,
      inviteeName: this.profilePersonName(user?.profile),
      inviterEmail: row.inviter.email,
      inviterName: this.profilePersonName(row.inviter.profile),
    });

    return { ok: true as const, rejected: true as const, id: row.id };
  }

  private profilePersonName(
    profile?: { firstName?: string | null; lastName?: string | null } | null,
  ): string | null {
    const fromName = [profile?.firstName, profile?.lastName]
      .filter((x) => x != null && String(x).trim().length > 0)
      .map((s) => String(s).trim())
      .join(' ');
    return fromName || null;
  }
}
