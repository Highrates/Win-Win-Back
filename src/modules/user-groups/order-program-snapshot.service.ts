import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserGroupProfileResolverService } from '../user-group-profiles/user-group-profile-resolver.service';

/** Фиксирует профили покупателя на заказе при первом выходе из черновика. */
@Injectable()
export class OrderProgramSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profileResolver: UserGroupProfileResolverService,
  ) {}

  async captureForOrderIfNeeded(orderId: string, buyerUserId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        buyerReferralProgramProfileIdSnapshot: true,
        buyerDesignerBonusProfileIdSnapshot: true,
      },
    });
    if (
      order?.buyerReferralProgramProfileIdSnapshot &&
      order?.buyerDesignerBonusProfileIdSnapshot
    ) {
      return;
    }

    const [referral, bonus] = await Promise.all([
      this.profileResolver.resolveReferralProgramForUser(buyerUserId),
      this.profileResolver.resolveDesignerBonusForUser(buyerUserId),
    ]);

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        buyerReferralProgramProfileIdSnapshot: referral.profileId,
        buyerDesignerBonusProfileIdSnapshot: bonus.profileId,
        programSnapshotsCapturedAt: new Date(),
      },
    });
  }
}
