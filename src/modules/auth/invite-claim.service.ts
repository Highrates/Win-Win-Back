import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { resolveSecret } from '../../config/resolve-secret';
import { PrismaService } from '../../prisma/prisma.service';
import { inviteInvalid, inviteMismatch } from './designer-invite.errors';

export type ResolvedDesignerInvite = {
  inviteId: string;
  refCode: string;
  emailNorm: string;
};

type TxClient = Prisma.TransactionClient;

/**
 * Единая точка resolve/consume designer invite:
 * - регистрация (`register/complete` → createRetailUser)
 * - вход / ЛК (`claimByTokenForUser`)
 */
@Injectable()
export class InviteClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private secret(): string {
    return (
      this.config.get<string>('DESIGNER_INVITE_JWT_SECRET')?.trim() ||
      resolveSecret('JWT_SECRET', this.config.get<string>('JWT_SECRET'))
    );
  }

  private async inviteIdFromToken(token: string): Promise<string> {
    let payload: { sub?: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: string; typ?: string }>(token, {
        secret: this.secret(),
      });
    } catch {
      throw inviteInvalid('Ссылка приглашения недействительна или истекла');
    }
    if (payload.typ !== 'dinv' || !payload.sub?.trim()) {
      throw inviteInvalid('Ссылка приглашения недействительна');
    }
    return payload.sub.trim();
  }

  /**
   * Активный инвайт для email (не consumed, не истёк, email совпадает).
   * @throws BadRequestException если не подходит
   */
  async resolveActiveForEmail(
    token: string,
    emailRaw: string,
    mismatchMessage = 'Приглашение не подходит к этому email',
  ): Promise<ResolvedDesignerInvite> {
    const emailNorm = emailRaw.trim().toLowerCase();
    if (!emailNorm) {
      throw inviteMismatch('Для приглашения завершите регистрацию по email');
    }
    const inviteId = await this.inviteIdFromToken(token);
    const existing = await this.prisma.designerInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true,
        refCode: true,
        emailNorm: true,
        consumedAt: true,
        supersededAt: true,
        rejectedAt: true,
        rejectReason: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    if (!existing) {
      throw inviteInvalid('Ссылка приглашения недействительна или истекла');
    }
    if (existing.supersededAt) {
      throw inviteInvalid(
        'Приглашение заменено новым. Используйте ссылку из последнего письма или запросите приглашение снова.',
      );
    }
    if (existing.revokedAt) {
      throw inviteInvalid('Приглашение отозвано');
    }
    if (existing.rejectedAt) {
      throw inviteInvalid(
        existing.rejectReason === 'already_has_sponsor'
          ? 'Отклонено: уже в структуре'
          : existing.rejectReason === 'needs_admin_approval'
            ? 'Приглашение ожидает одобрения администратора'
            : 'Приглашение отклонено',
      );
    }
    if (existing.consumedAt) {
      throw inviteInvalid('Приглашение уже использовано');
    }
    if (existing.expiresAt < new Date()) {
      throw inviteInvalid('Срок приглашения истёк');
    }
    if (existing.emailNorm !== emailNorm) {
      throw inviteMismatch(mismatchMessage);
    }
    return { inviteId: existing.id, refCode: existing.refCode, emailNorm: existing.emailNorm };
  }

  /** Перед `register/complete` — null если токена нет. */
  async resolveForNewRegistration(
    token: string | null | undefined,
    registrationEmail: string | null,
  ): Promise<{ inviteId: string; refCode: string } | null> {
    if (!token?.trim()) return null;
    if (!registrationEmail?.trim()) {
      throw inviteMismatch('Для приглашения завершите регистрацию по email');
    }
    const r = await this.resolveActiveForEmail(token, registrationEmail);
    return { inviteId: r.inviteId, refCode: r.refCode };
  }

  /**
   * Погасить инвайт в транзакции регистрации (идемпотентно: если уже не активен — no-op).
   * `ignoreExpiry` — для админ-одобрения после истечения TTL ссылки.
   */
  async consumeInTx(
    tx: TxClient,
    inviteId: string,
    emailNorm: string,
    opts?: { ignoreExpiry?: boolean },
  ): Promise<boolean> {
    const em = emailNorm.trim().toLowerCase();
    const ex = await tx.designerInvite.findFirst({
      where: {
        id: inviteId,
        consumedAt: null,
        supersededAt: null,
        rejectedAt: null,
        revokedAt: null,
        emailNorm: em,
        ...(opts?.ignoreExpiry ? {} : { expiresAt: { gt: new Date() } }),
      },
      select: { id: true },
    });
    if (!ex) return false;
    await tx.designerInvite.update({
      where: { id: ex.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }

  /** Погасить после успешного claim существующего пользователя. */
  async markConsumed(inviteId: string): Promise<void> {
    await this.prisma.designerInvite.update({
      where: { id: inviteId },
      data: { consumedAt: new Date() },
    });
  }
}
