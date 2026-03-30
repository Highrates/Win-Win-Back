import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReferralsService {
  constructor(private prisma: PrismaService) {}

  async getConfig() {
    const rows = await this.prisma.referralConfig.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async getMyReferrals(userId: string) {
    return this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: { referred: { select: { id: true, email: true, phone: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyRewards(userId: string, page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.referralReward.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referralReward.count({ where: { userId } }),
    ]);
    return { items, total, page, limit };
  }

  async getReportForExport(userId: string) {
    const referrals = await this.getMyReferrals(userId);
    const rewards = await this.prisma.referralReward.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { referrals, rewards };
  }
}
