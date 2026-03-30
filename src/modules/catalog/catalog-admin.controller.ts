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
  BulkDeleteCategoriesDto,
  CreateCategoryAdminDto,
  ReorderCategoriesDto,
  UpdateCategoryAdminDto,
} from './dto/catalog-admin.dto';

const uploadStorage = memoryStorage();

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
