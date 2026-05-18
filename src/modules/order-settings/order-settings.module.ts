import { Module } from '@nestjs/common';
import { OrderSettingsService } from './order-settings.service';
import { OrderSettingsAdminController } from './order-settings-admin.controller';
import { OrderSettingsPublicController } from './order-settings-public.controller';

@Module({
  providers: [OrderSettingsService],
  controllers: [OrderSettingsAdminController, OrderSettingsPublicController],
  exports: [OrderSettingsService],
})
export class OrderSettingsModule {}
