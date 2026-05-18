import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralsController } from './referrals.controller';
import { ReferralsAdminController } from './referrals-admin.controller';
import { OrderSettingsModule } from '../order-settings/order-settings.module';

@Module({
  imports: [OrderSettingsModule],
  providers: [ReferralsService],
  controllers: [ReferralsController, ReferralsAdminController],
  exports: [ReferralsService],
})
export class ReferralsModule {}
