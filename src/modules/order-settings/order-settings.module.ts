import { Module } from '@nestjs/common';
import { UserGroupProfileResolverModule } from '../user-group-profiles/user-group-profile-resolver.module';
import { OrderSettingsService } from './order-settings.service';
import { OrderSettingsAdminController } from './order-settings-admin.controller';
import { OrderSettingsPublicController } from './order-settings-public.controller';

@Module({
  imports: [UserGroupProfileResolverModule],
  providers: [OrderSettingsService],
  controllers: [OrderSettingsAdminController, OrderSettingsPublicController],
  exports: [OrderSettingsService],
})
export class OrderSettingsModule {}
