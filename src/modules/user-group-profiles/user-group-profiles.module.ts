import { Module } from '@nestjs/common';
import { ReferralsModule } from '../referrals/referrals.module';
import { DesignerBonusProfilesService } from './designer-bonus-profiles.service';
import { ReferralProgramProfilesService } from './referral-program-profiles.service';
import { UserGroupProfileResolverModule } from './user-group-profile-resolver.module';
import { UserGroupProfilesAdminController } from './user-group-profiles-admin.controller';

@Module({
  imports: [UserGroupProfileResolverModule, ReferralsModule],
  controllers: [UserGroupProfilesAdminController],
  providers: [ReferralProgramProfilesService, DesignerBonusProfilesService],
  exports: [ReferralProgramProfilesService, DesignerBonusProfilesService],
})
export class UserGroupProfilesModule {}
