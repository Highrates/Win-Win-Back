import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogAdminService } from './catalog-admin.service';
import { CuratedCollectionsAdminService } from './curated-collections-admin.service';
import { ProductSetsAdminService } from './product-sets-admin.service';
import { PricingAdminService } from './pricing-admin.service';
import { StorageModule } from '../storage/storage.module';
import { MediaLibraryModule } from '../media-library/media-library.module';

@Module({
  imports: [StorageModule, MediaLibraryModule],
  providers: [
    CatalogService,
    CatalogAdminService,
    CuratedCollectionsAdminService,
    ProductSetsAdminService,
    PricingAdminService,
  ],
  controllers: [CatalogController, CatalogAdminController],
  exports: [CatalogService, StorageModule],
})
export class CatalogModule {}
