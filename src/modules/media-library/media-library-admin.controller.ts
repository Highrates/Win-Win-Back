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
import { MediaLibraryService } from './media-library.service';
import { CreateMediaFolderDto, UpdateMediaObjectDto } from './dto/media-library.dto';

const uploadStorage = memoryStorage();
const LIBRARY_UPLOAD_MAX = 100 * 1024 * 1024;

@Controller('catalog/admin/media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class MediaLibraryAdminController {
  constructor(
    private readonly media: MediaLibraryService,
    private readonly audit: AuditService,
  ) {}

  @Get('folders')
  listFolders() {
    return this.media.listFolders();
  }

  @Post('folders')
  createFolder(@Body() dto: CreateMediaFolderDto) {
    return this.media.createFolder(dto.name, dto.parentId);
  }

  @Delete('folders/:id')
  deleteFolder(@Param('id') id: string) {
    return this.media.deleteFolder(id);
  }

  @Get('objects')
  listObjects(
    @Query('q') q?: string,
    @Query('tab') tabRaw?: string,
    @Query('folderId') folderId?: string,
  ) {
    const tab =
      tabRaw === 'images' ||
      tabRaw === 'documents' ||
      tabRaw === 'models' ||
      tabRaw === 'videos'
        ? tabRaw
        : 'all';
    return this.media.listObjects({ q, tab, folderId });
  }

  @Get('objects/:id')
  getObject(@Param('id') id: string) {
    return this.media.getObject(id);
  }

  @Patch('objects/:id')
  updateObject(@Param('id') id: string, @Body() dto: UpdateMediaObjectDto) {
    return this.media.updateObject(id, dto);
  }

  @Delete('objects/:id')
  deleteObject(@Param('id') id: string) {
    return this.media.deleteObject(id);
  }

  /** Сверка префикса objects/ с таблицей MediaObject; удаляет лишние ключи (осторожно: вне БД под objects/ тоже сотрётся). */
  @Post('maintenance/sweep-orphan-objects')
  sweepOrphanObjects() {
    return this.media.sweepOrphanObjectKeysUnderPrefix('objects/');
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: LIBRARY_UPLOAD_MAX },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('folderId') folderId: string | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    const row = await this.media.uploadObject(file, folderId || null);
    const path = (req.originalUrl || req.url || '').split('?')[0];
    await this.audit.log({
      action: AuditAction.UPLOAD,
      entityType: 'MediaObject',
      entityId: row.id,
      path,
      httpMethod: 'POST',
      metadata: {
        storageKey: row.storageKey,
        originalName: row.originalName,
        byteSize: row.byteSize,
        mimeType: row.mimeType,
        folderId: row.folderId,
      },
    });
    return row;
  }
}
