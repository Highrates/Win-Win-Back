import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CatalogAdminService } from './catalog-admin.service';
import {
  BulkDeleteBrandsDto,
  BulkDeleteCategoriesDto,
  CreateBrandAdminDto,
  CreateCategoryAdminDto,
  ReorderCategoriesDto,
  UpdateBrandAdminDto,
  UpdateCategoryAdminDto,
} from './dto/catalog-admin.dto';

const uploadStorage = memoryStorage();
const RICH_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

@Controller('catalog/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class CatalogAdminController {
  constructor(private readonly catalogAdmin: CatalogAdminService) {}

  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не передан');
    return this.catalogAdmin.uploadCategoryImage(file);
  }

  @Post('upload-brand-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 6 * 1024 * 1024 },
    }),
  )
  uploadBrandImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('kind') kindRaw?: string,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const kind = kindRaw as 'cover' | 'background' | 'gallery';
    if (kind !== 'cover' && kind !== 'background' && kind !== 'gallery') {
      throw new BadRequestException('Query kind must be cover, background, or gallery');
    }
    return this.catalogAdmin.uploadBrandImage(file, kind);
  }

  @Post('upload-rich-media')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: RICH_MEDIA_MAX_BYTES },
    }),
  )
  uploadRichMedia(
    @UploadedFile() file: Express.Multer.File,
    @Query('type') typeRaw?: string,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const t = typeRaw as 'image' | 'video';
    if (t !== 'image' && t !== 'video') {
      throw new BadRequestException('Query type must be image or video');
    }
    return this.catalogAdmin.uploadRichMedia(file, t);
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
}
