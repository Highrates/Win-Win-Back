import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserGroupProfileResolverModule } from '../user-group-profiles/user-group-profile-resolver.module';
import { OrderSettingsService } from './order-settings.service';
import { OrderSettingsAdminController } from './order-settings-admin.controller';
import { OrderSettingsPublicController } from './order-settings-public.controller';

@Module({
  imports: [AuthModule, UserGroupProfileResolverModule],
  providers: [OrderSettingsService],
  controllers: [OrderSettingsAdminController, OrderSettingsPublicController],
  exports: [OrderSettingsService],
})
export class OrderSettingsModule {}
