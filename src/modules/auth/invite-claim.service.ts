import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { resolveSecret } from '../../config/resolve-secret';
import { PrismaService } from '../../prisma/prisma.service';

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
      throw new BadRequestException('Ссылка приглашения недействительна или истекла');
    }
    if (payload.typ !== 'dinv' || !payload.sub?.trim()) {
      throw new BadRequestException('Ссылка приглашения недействительна');
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
      throw new BadRequestException('Для приглашения завершите регистрацию по email');
    }
    const inviteId = await this.inviteIdFromToken(token);
    const row = await this.prisma.designerInvite.findFirst({
      where: {
        id: inviteId,
        emailNorm,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, refCode: true, emailNorm: true },
    });
    if (!row) {
      throw new BadRequestException(mismatchMessage);
    }
    return { inviteId: row.id, refCode: row.refCode, emailNorm: row.emailNorm };
  }

  /** Перед `register/complete` — null если токена нет. */
  async resolveForNewRegistration(
    token: string | null | undefined,
    registrationEmail: string | null,
  ): Promise<{ inviteId: string; refCode: string } | null> {
    if (!token?.trim()) return null;
    if (!registrationEmail?.trim()) {
      throw new BadRequestException('Для приглашения завершите регистрацию по email');
    }
    const r = await this.resolveActiveForEmail(token, registrationEmail);
    return { inviteId: r.inviteId, refCode: r.refCode };
  }

  /**
   * Погасить инвайт в транзакции регистрации (идемпотентно: если уже не активен — no-op).
   */
  async consumeInTx(
    tx: TxClient,
    inviteId: string,
    emailNorm: string,
  ): Promise<boolean> {
    const em = emailNorm.trim().toLowerCase();
    const ex = await tx.designerInvite.findFirst({
      where: {
        id: inviteId,
        consumedAt: null,
        emailNorm: em,
        expiresAt: { gt: new Date() },
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
