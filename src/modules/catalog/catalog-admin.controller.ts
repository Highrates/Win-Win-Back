import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CatalogAdminService } from './catalog-admin.service';
import { CuratedCollectionsAdminService } from './curated-collections-admin.service';
import {
  BulkDeleteCuratedCollectionsDto,
  CreateCuratedCollectionAdminDto,
  UpdateCuratedCollectionAdminDto,
} from './dto/curated-collections-admin.dto';
import { ProductSetsAdminService } from './product-sets-admin.service';
import {
  BulkDeleteProductSetsDto,
  CreateProductSetAdminDto,
  UpdateProductSetAdminDto,
} from './dto/product-sets-admin.dto';
import {
  BulkDeleteBrandsDto,
  BulkDeleteCategoriesDto,
  BulkDeleteProductsDto,
  CreateBrandAdminDto,
  CreateCategoryAdminDto,
  CreateProductAdminDto,
  CreateProductVariantAdminDto,
  ReorderCategoriesDto,
  UpdateBrandAdminDto,
  UpdateBrandMaterialsAdminDto,
  UpdateCategoryAdminDto,
  UpdateProductElementsDto,
  UpdateProductModificationsDto,
  UpdateProductShellAdminDto,
  UpdateProductVariantAdminDto,
} from './dto/catalog-admin.dto';
import { PricingPreviewAdminDto, UpsertPricingProfileAdminDto } from './dto/pricing-admin.dto';
import { PricingAdminService } from './pricing-admin.service';
import { slugifyVariantLabel } from './slug-transliteration';

const uploadStorage = memoryStorage();
const RICH_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

@Controller('catalog/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class CatalogAdminController {
  constructor(
    private readonly catalogAdmin: CatalogAdminService,
    private readonly curatedCollections: CuratedCollectionsAdminService,
    private readonly productSets: ProductSetsAdminService,
    private readonly pricingAdmin: PricingAdminService,
    private readonly audit: AuditService,
  ) {}

  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) throw new BadRequestException('Файл не передан');
    const path = (req.originalUrl || req.url || '').split('?')[0];
    const result = await this.catalogAdmin.uploadCategoryImage(file);
    await this.audit.log({
      action: AuditAction.UPLOAD,
      entityType: 'CatalogImage',
      path,
      httpMethod: 'POST',
      metadata: {
        kind: 'category',
        originalName: file.originalname,
        byteSize: file.size,
        url: result.url,
        mediaObjectId: result.mediaObjectId,
      },
    });
    return result;
  }

  @Post('upload-brand-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  async uploadBrandImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('kind') kindRaw: string | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const kind = kindRaw as 'cover' | 'background' | 'gallery';
    if (kind !== 'cover' && kind !== 'background' && kind !== 'gallery') {
      throw new BadRequestException('Query kind must be cover, background, or gallery');
    }
    const result = await this.catalogAdmin.uploadBrandImage(file, kind);
    const path = (req.originalUrl || req.url || '').split('?')[0];
    await this.audit.log({
      action: AuditAction.UPLOAD,
      entityType: 'BrandImage',
      path,
      httpMethod: 'POST',
      metadata: {
        kind,
        originalName: file.originalname,
        byteSize: file.size,
        url: result.url,
      },
    });
    return result;
  }

  @Post('upload-rich-media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: RICH_MEDIA_MAX_BYTES },
    }),
  )
  async uploadRichMedia(
    @UploadedFile() file: Express.Multer.File,
    @Query('type') typeRaw: string | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const t = typeRaw as 'image' | 'video';
    if (t !== 'image' && t !== 'video') {
      throw new BadRequestException('Query type must be image or video');
    }
    const { url } = await this.catalogAdmin.uploadRichMedia(file, t);
    const path = (req.originalUrl || req.url || '').split('?')[0];
    await this.audit.log({
      action: AuditAction.UPLOAD,
      entityType: 'RichMedia',
      path,
      httpMethod: 'POST',
      metadata: {
        mediaType: t,
        originalName: file.originalname,
        byteSize: file.size,
        url,
      },
    });
    return { url };
  }

  @Get('brands')
  listBrands(@Query('q') q?: string) {
    return this.catalogAdmin.listBrandsForAdmin(q);
  }

  @Post('brands/bulk-delete')
  bulkDeleteBrands(@Body() dto: BulkDeleteBrandsDto) {
    return this.catalogAdmin.deleteBrands(dto.ids);
  }

  @Post('brands')
  createBrand(@Body() dto: CreateBrandAdminDto) {
    return this.catalogAdmin.createBrand(dto);
  }

  @Get('brands/:id')
  getBrand(@Param('id') id: string) {
    return this.catalogAdmin.getBrandForAdmin(id);
  }

  @Patch('brands/:id')
  updateBrand(@Param('id') id: string, @Body() dto: UpdateBrandAdminDto) {
    return this.catalogAdmin.updateBrand(id, dto);
  }

  @Get('categories')
  list(@Query('q') q?: string) {
    return this.catalogAdmin.listCategories(q);
  }

  @Post('categories/reorder')
  reorder(@Body() dto: ReorderCategoriesDto) {
    const parentId = dto.parentId === undefined ? null : dto.parentId;
    return this.catalogAdmin.reorderCategories(parentId, dto.orderedIds);
  }

  @Post('categories/bulk-delete')
  bulkDelete(@Body() dto: BulkDeleteCategoriesDto) {
    return this.catalogAdmin.deleteCategories(dto.ids);
  }

  @Post('categories')
  create(@Body() dto: CreateCategoryAdminDto) {
    return this.catalogAdmin.createCategory(dto);
  }

  @Get('categories/:id')
  one(@Param('id') id: string) {
    return this.catalogAdmin.getCategory(id);
  }

  @Patch('categories/:id')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryAdminDto) {
    return this.catalogAdmin.updateCategory(id, dto);
  }

  /** Предпросмотр slug варианта (тот же алгоритм, что при сохранении). */
  @Get('slugify-variant')
  slugifyVariant(@Query('q') q?: string) {
    return { slug: slugifyVariantLabel(q ?? '') };
  }

  @Get('products')
  listProducts(@Query('q') q?: string) {
    return this.catalogAdmin.listProductsForAdmin(q);
  }

  @Post('products')
  createProduct(@Body() dto: CreateProductAdminDto) {
    return this.catalogAdmin.createProduct(dto);
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string) {
    return this.catalogAdmin.getProductForAdmin(id);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductShellAdminDto) {
    return this.catalogAdmin.updateProduct(id, dto);
  }

  @Get('products/:productId/variants/:variantId')
  getProductVariant(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.catalogAdmin.getVariantForAdmin(productId, variantId);
  }

  @Patch('products/:productId/variants/:variantId')
  updateProductVariant(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateProductVariantAdminDto,
  ) {
    return this.catalogAdmin.updateProductVariant(productId, variantId, dto);
  }

  @Post('products/:productId/variants')
  createProductVariant(
    @Param('productId') productId: string,
    @Body() dto: CreateProductVariantAdminDto,
  ) {
    return this.catalogAdmin.createProductVariant(productId, dto);
  }

  @Patch('products/:productId/modifications')
  updateProductModifications(
    @Param('productId') productId: string,
    @Body() dto: UpdateProductModificationsDto,
  ) {
    return this.catalogAdmin.updateProductModifications(productId, dto);
  }

  @Patch('products/:productId/elements')
  updateProductElements(
    @Param('productId') productId: string,
    @Body() dto: UpdateProductElementsDto,
  ) {
    return this.catalogAdmin.updateProductElements(productId, dto);
  }

  @Get('brands/:id/materials')
  listBrandMaterials(@Param('id') id: string) {
    return this.catalogAdmin.listBrandMaterials(id);
  }

  @Patch('brands/:id/materials')
  updateBrandMaterials(@Param('id') id: string, @Body() dto: UpdateBrandMaterialsAdminDto) {
    return this.catalogAdmin.updateBrandMaterials(id, dto);
  }

  @Delete('products/:productId/variants/:variantId')
  deleteProductVariant(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.catalogAdmin.deleteProductVariant(productId, variantId);
  }

  @Post('products/bulk-delete')
  bulkDeleteProducts(@Body() dto: BulkDeleteProductsDto) {
    return this.catalogAdmin.deleteProducts(dto.ids);
  }

  @Get('pricing-profiles')
  listPricingProfiles() {
    return this.pricingAdmin.listProfiles();
  }

  @Post('pricing-profiles')
  async createPricingProfile(@Body() dto: UpsertPricingProfileAdminDto) {
    const row = await this.pricingAdmin.createProfile(dto);
    await this.catalogAdmin.recalculateAllFormulaProductPrices();
    return row;
  }

  @Patch('pricing-profiles/:id')
  async updatePricingProfile(@Param('id') id: string, @Body() dto: UpsertPricingProfileAdminDto) {
    const row = await this.pricingAdmin.updateProfile(id, dto);
    await this.catalogAdmin.recalculateAllFormulaProductPrices();
    return row;
  }

  @Delete('pricing-profiles/:id')
  async deletePricingProfile(@Param('id') id: string) {
    await this.pricingAdmin.deleteProfile(id);
    await this.catalogAdmin.recalculateAllFormulaProductPrices();
    return { ok: true };
  }

  @Post('pricing-preview')
  previewPricing(@Body() dto: PricingPreviewAdminDto) {
    return this.pricingAdmin.previewRetailPrice({
      categoryIds: dto.categoryIds,
      costPriceCny: dto.costPriceCny,
      weightKg: dto.weightKg,
      volumeM3: dto.volumeM3,
    });
  }

  @Get('curated-collections')
  listCuratedCollections(@Query('q') q?: string) {
    return this.curatedCollections.listForAdmin(q);
  }

  @Post('curated-collections/bulk-delete')
  bulkDeleteCuratedCollections(@Body() dto: BulkDeleteCuratedCollectionsDto) {
    return this.curatedCollections.deleteMany(dto.ids);
  }

  @Post('curated-collections')
  createCuratedCollection(@Body() dto: CreateCuratedCollectionAdminDto) {
    return this.curatedCollections.create(dto);
  }

  @Get('curated-collections/:id')
  getCuratedCollection(@Param('id') id: string) {
    return this.curatedCollections.getForAdmin(id);
  }

  @Patch('curated-collections/:id')
  updateCuratedCollection(@Param('id') id: string, @Body() dto: UpdateCuratedCollectionAdminDto) {
    return this.curatedCollections.update(id, dto);
  }

  @Get('product-sets')
  listProductSets(@Query('q') q?: string) {
    return this.productSets.listForAdmin(q);
  }

  @Post('product-sets/bulk-delete')
  bulkDeleteProductSets(@Body() dto: BulkDeleteProductSetsDto) {
    return this.productSets.deleteMany(dto.ids);
  }

  @Post('product-sets')
  createProductSet(@Body() dto: CreateProductSetAdminDto) {
    return this.productSets.create(dto);
  }

  @Get('product-sets/:id')
  getProductSet(@Param('id') id: string) {
    return this.productSets.getForAdmin(id);
  }

  @Patch('product-sets/:id')
  updateProductSet(@Param('id') id: string, @Body() dto: UpdateProductSetAdminDto) {
    return this.productSets.update(id, dto);
  }
}
