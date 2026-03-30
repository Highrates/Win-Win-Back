import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogAdminController } from './catalog-admin.controller';

@Module({
  providers: [CatalogService],
  controllers: [CatalogController, CatalogAdminController],
  exports: [CatalogService],
})
export class CatalogModule {}
