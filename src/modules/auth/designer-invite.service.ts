import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveSecret } from '../../config/resolve-secret';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from './mail.service';
import { UsersService } from '../users/users.service';

const INVITE_JWT_MAX = 64 * 1024;
const DESIGNER_INVITE_DAILY_LIMIT = 100;

@Injectable()
export class DesignerInviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly users: UsersService,
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

  private async buildInviteLinkForRow(rowId: string): Promise<string> {
    const token = await this.jwt.signAsync(
      { sub: rowId, typ: 'dinv' },
      { secret: this.secret(), expiresIn: '14d' },
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
      throw new ForbiddenException('Доступно только одобренным партнёрам Win-Win');
    }
    return inviter;
  }

  /** Активные приглашения партнёра: не погашены и не истекли. */
  async listActiveInvitesForUser(inviterUserId: string) {
    await this.assertApprovedPartnerInviter(inviterUserId);
    const now = new Date();
    const rows = await this.prisma.designerInvite.findMany({
      where: {
        inviterId: inviterUserId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, emailNorm: true, createdAt: true, expiresAt: true },
    });
    const items = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        email: row.emailNorm,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        inviteLink: await this.buildInviteLinkForRow(row.id),
      })),
    );
    return { items };
  }

  async sendInvite(inviterUserId: string, emailRaw: string) {
    const inviter = await this.assertApprovedPartnerInviter(inviterUserId);
    const p = inviter.profile;
    const refCode = await this.users.ensureWinWinReferralCodeForUser(inviterUserId);
    if (!refCode) throw new BadRequestException('Не удалось получить реферальный номер');
    const email = emailRaw.trim().toLowerCase();
    if (!email.includes('@') || email.length < 4) {
      throw new BadRequestException('Некорректный email');
    }
    if (inviter.email && inviter.email.toLowerCase() === email) {
      throw new BadRequestException('Нельзя пригласить самого себя');
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

    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const now = new Date();
    await this.prisma.designerInvite.updateMany({
      where: {
        inviterId: inviterUserId,
        emailNorm: email,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    const row = await this.prisma.designerInvite.create({
      data: { inviterId: inviterUserId, emailNorm: email, refCode, expiresAt },
    });

    try {
      const link = await this.buildInviteLinkForRow(row.id);
      const invName =
        [p?.firstName, p?.lastName]
          .filter((x) => x != null && String(x).trim().length > 0)
          .map((s) => String(s).trim())
          .join(' ') || (inviter.email ? inviter.email : 'Партнёр Win-Win');
      await this.mail.sendDesignerInvite({ to: email, inviteLink: link, inviterLabel: invName, refCode });
      return { ok: true as const, expiresAt: expiresAt.toISOString(), inviteLink: link };
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
      throw new BadRequestException('Ссылка приглашения недействительна или истекла');
    }
    if (payload.typ !== 'dinv' || !payload.sub) {
      throw new BadRequestException('Ссылка приглашения недействительна');
    }
    const row = await this.prisma.designerInvite.findUnique({
      where: { id: payload.sub },
      include: { inviter: { select: { id: true, email: true } } },
    });
    if (!row) throw new BadRequestException('Приглашение не найдено');
    if (row.consumedAt) {
      throw new BadRequestException('Приглашение уже использовано');
    }
    if (row.expiresAt < new Date()) {
      throw new BadRequestException('Срок приглашения истёк');
    }
    const existing = await this.prisma.user.findFirst({
      where: { email: row.emailNorm, isActive: true },
      select: { id: true },
    });
    return {
      email: row.emailNorm,
      prefillRef: row.refCode,
      accountExists: Boolean(existing),
    };
  }

  /** Проверка токена перед `register/complete` — email в регистрации = email в приглашении. */
  async assertValidForNewAccountEmail(
    token: string | null | undefined,
    registrationEmail: string | null,
  ): Promise<{ inviteId: string; refCode: string } | null> {
    if (!token?.trim()) return null;
    if (!registrationEmail?.trim()) {
      throw new BadRequestException('Для приглашения завершите регистрацию по email');
    }
    let payload: { sub?: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: string; typ?: string }>(token, {
        secret: this.secret(),
      });
    } catch {
      throw new BadRequestException('Ссылка приглашения недействительна или истекла');
    }
    if (payload.typ !== 'dinv' || !payload.sub) {
      throw new BadRequestException('Ссылка приглашения недействительна');
    }
    const em = registrationEmail.trim().toLowerCase();
    const row = await this.prisma.designerInvite.findFirst({
      where: {
        id: payload.sub,
        emailNorm: em,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) {
      throw new BadRequestException('Приглашение не подходит к этому email');
    }
    return { inviteId: row.id, refCode: row.refCode };
  }

  /**
   * Вход / ЛК: подтвердить приглашение, привязать реферала по коду из письма, погасить.
   */
  async claimByTokenForUser(userId: string, token: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, role: UserRole.USER, isActive: true },
      select: { id: true, email: true },
    });
    if (!user?.email) throw new BadRequestException('У аккаунта нет email, приглашение не применимо');
    let payload: { sub?: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: string; typ?: string }>(token, {
        secret: this.secret(),
      });
    } catch {
      throw new BadRequestException('Ссылка приглашения недействительна или истекла');
    }
    if (payload.typ !== 'dinv' || !payload.sub) {
      throw new BadRequestException('Ссылка приглашения недействительна');
    }
    const em = user.email.toLowerCase();
    const row = await this.prisma.designerInvite.findFirst({
      where: {
        id: payload.sub,
        emailNorm: em,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) {
      throw new BadRequestException('Приглашение не подходит к этому аккаунту');
    }
    await this.users.tryAttachWinWinReferralByCodeForExistingUser(userId, row.refCode);
    await this.prisma.designerInvite.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return { ok: true as const, prefillRef: row.refCode };
  }
}
