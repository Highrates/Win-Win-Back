import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LkVitrineUploadExceptionFilter } from '../users/lk-vitrine-upload.exception-filter';
import { CreateMyCaseDto, UpdateMyCaseDto } from './dto/cases.dto';
import { CasesService } from './cases.service';

const LK_CASE_MEDIA_MAX = 100 * 1024 * 1024;

@Controller('cases')
@UseGuards(JwtAuthGuard)
@UseFilters(LkVitrineUploadExceptionFilter)
export class CasesController {
  constructor(private readonly svc: CasesService) {}

  @Get('me')
  listMy(@CurrentUser('sub') userId: string) {
    return this.svc.listMyCases(userId);
  }

  @Post('me')
  createMy(@CurrentUser('sub') userId: string, @Body() dto: CreateMyCaseDto) {
    return this.svc.createMyCase(userId, dto);
  }

  @Get('me/:id')
  getMy(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.svc.getMyCase(userId, id);
  }

  @Patch('me/:id')
  updateMy(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMyCaseDto,
  ) {
    return this.svc.updateMyCase(userId, id, dto);
  }

  @Delete('me/:id')
  deleteMy(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.svc.deleteMyCase(userId, id);
  }

  /** S3 upload: обложки и RichBlock (в ту же папку пользователя, что и профиль). */
  @Post('me/media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LK_CASE_MEDIA_MAX } }))
  uploadMyMedia(@CurrentUser('sub') userId: string, @UploadedFile() file: Express.Multer.File) {
    return this.svc.uploadMyCaseMedia(userId, file);
  }

  // ---- Admin ----

  @Get('admin/users/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  listForUserAdmin(
    @CurrentUser('sub') adminUserId: string,
    @Param('userId') userId: string,
  ) {
    return this.svc.listCasesByUserForAdmin(adminUserId, userId);
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  getCaseAdmin(
    @CurrentUser('sub') adminUserId: string,
    @CurrentUser('role') role: UserRole,
    @Param('id') id: string,
  ) {
    return this.svc.getCaseForAdmin(adminUserId, role, id);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  deleteAdmin(
    @CurrentUser('sub') adminUserId: string,
    @CurrentUser('role') role: UserRole,
    @Param('id') id: string,
  ) {
    return this.svc.deleteCaseForAdmin(adminUserId, role, id);
  }
}

