import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogAdminService } from './catalog-admin.service';
import { CatalogProductAdminService } from './catalog-product-admin.service';
import { CatalogVariantAdminService } from './catalog-variant-admin.service';
import { CatalogVariantPricingService } from './catalog-variant-pricing.service';
import { CuratedCollectionsAdminService } from './curated-collections-admin.service';
import { ProductSetsAdminService } from './product-sets-admin.service';
import { PricingAdminService } from './pricing-admin.service';
import { BrandMaterialsAdminService } from './brand-materials-admin.service';
import { ProductStructureAdminService } from './product-structure-admin.service';
import { StorageModule } from '../storage/storage.module';
import { MediaLibraryModule } from '../media-library/media-library.module';
import { AuthModule } from '../auth/auth.module';
import { UserGroupProfileResolverModule } from '../user-group-profiles/user-group-profile-resolver.module';
import { CatalogTierPricingService } from './catalog-tier-pricing.service';

@Module({
  imports: [AuthModule, StorageModule, MediaLibraryModule, UserGroupProfileResolverModule],
  providers: [
    CatalogService,
    CatalogTierPricingService,
    CatalogVariantPricingService,
    CatalogVariantAdminService,
    CatalogProductAdminService,
    CatalogAdminService,
    CuratedCollectionsAdminService,
    ProductSetsAdminService,
    PricingAdminService,
    BrandMaterialsAdminService,
    ProductStructureAdminService,
  ],
  controllers: [CatalogController, CatalogAdminController],
  exports: [CatalogService, CatalogTierPricingService, StorageModule],
})
export class CatalogModule {}
