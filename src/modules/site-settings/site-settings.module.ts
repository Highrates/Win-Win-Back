import { Module } from '@nestjs/common';
import { SiteSettingsController } from './site-settings.controller';
import { SiteSettingsService } from './site-settings.service';

@Module({
  providers: [SiteSettingsService],
  controllers: [SiteSettingsController],
  exports: [SiteSettingsService],
})
export class SiteSettingsModule {}

