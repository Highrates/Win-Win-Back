import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogAdminService } from './catalog-admin.service';
import { ObjectStorageService } from '../storage/object-storage.service';

@Module({
  providers: [CatalogService, CatalogAdminService, ObjectStorageService],
  controllers: [CatalogController, CatalogAdminController],
  exports: [CatalogService],
})
export class CatalogModule {}
