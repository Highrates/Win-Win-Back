import { Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralsController } from './referrals.controller';
import { ReferralsAdminController } from './referrals-admin.controller';
import { OrderSettingsModule } from '../order-settings/order-settings.module';
import { UserGroupProfileResolverModule } from '../user-group-profiles/user-group-profile-resolver.module';

@Module({
  imports: [OrderSettingsModule, UserGroupProfileResolverModule],
  providers: [ReferralsService],
  controllers: [ReferralsController, ReferralsAdminController],
  exports: [ReferralsService],
})
export class ReferralsModule {}
