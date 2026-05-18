import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReferralsService } from './referrals.service';
import { Throttle } from '@nestjs/throttler';

@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private referralsService: ReferralsService) {}

  @Get('config')
  config() {
    return this.referralsService.getConfig();
  }

  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('partner-program/summary')
  partnerProgramSummary(@CurrentUser('sub') userId: string) {
    return this.referralsService.getPartnerProgramSummary(userId);
  }

  @Post('partner-program/payout-request')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  partnerPayoutRequest(@CurrentUser('sub') userId: string, @Body() _body: Record<string, unknown>) {
    void _body;
    return this.referralsService.requestPartnerPayout(userId);
  }

  @Get('my')
  myReferrals(@CurrentUser('sub') userId: string) {
    return this.referralsService.getMyReferrals(userId);
  }

  @Get('rewards')
  myRewards(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.referralsService.getMyRewards(
      userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('report')
  report(@CurrentUser('sub') userId: string) {
    return this.referralsService.getReportForExport(userId);
  }
}
