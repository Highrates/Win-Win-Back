import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private referralsService: ReferralsService) {}

  @Get('config')
  config() {
    return this.referralsService.getConfig();
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
