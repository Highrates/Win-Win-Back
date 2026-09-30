import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import {
  AdminPatchCaseLikesBoostDto,
  BulkDeleteMyCasesDto,
  CreateMyCaseDto,
  UpdateMyCaseDto,
} from './dto/cases.dto';
import { CasesService } from './cases.service';

const LK_CASE_MEDIA_MAX = 100 * 1024 * 1024;

@Controller('cases')
@UseGuards(JwtAuthGuard)
@UseFilters(LkVitrineUploadExceptionFilter)
export class CasesController {
  constructor(private readonly svc: CasesService) {}

  @Get('me')
  listMy(@CurrentUser('sub') userId: string, @Query('q') q?: string) {
    return this.svc.listMyCases(userId, { q });
  }

  @Post('me')
  createMy(@CurrentUser('sub') userId: string, @Body() dto: CreateMyCaseDto) {
    return this.svc.createMyCase(userId, dto);
  }

  @Post('me/bulk-delete')
  bulkDeleteMy(@CurrentUser('sub') userId: string, @Body() dto: BulkDeleteMyCasesDto) {
    return this.svc.bulkDeleteMyCases(userId, dto.ids ?? []);
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

  /** S3 upload: обложки (`kind=cover`) и RichBlock (`kind=rich`, по умолчанию). */
  @Post('me/media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LK_CASE_MEDIA_MAX } }))
  uploadMyMedia(
    @CurrentUser('sub') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('kind') kindRaw?: string,
  ) {
    const kind = kindRaw === 'cover' ? 'cover' : 'rich';
    return this.svc.uploadMyCaseMedia(userId, file, kind);
  }

  // ---- Admin brand cases (до `admin/:id`, иначе `brands` станет id) ----

  @Get('admin/brands/:brandId/cases')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  listBrandCasesAdmin(
    @CurrentUser('sub') adminUserId: string,
    @CurrentUser('role') role: UserRole,
    @Param('brandId') brandId: string,
  ) {
    return this.svc.listBrandCasesForAdmin(adminUserId, role, brandId);
  }

  @Post('admin/brands/:brandId/cases')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  createBrandCaseAdmin(
    @CurrentUser('sub') adminUserId: string,
    @CurrentUser('role') role: UserRole,
    @Param('brandId') brandId: string,
    @Body() dto: CreateMyCaseDto,
  ) {
    return this.svc.createBrandCaseForAdmin(adminUserId, role, brandId, dto);
  }

  @Get('admin/brands/:brandId/cases/:caseId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  getBrandCaseAdmin(
    @CurrentUser('sub') adminUserId: string,
    @CurrentUser('role') role: UserRole,
    @Param('brandId') brandId: string,
    @Param('caseId') caseId: string,
  ) {
    return this.svc.getBrandCaseForAdmin(adminUserId, role, brandId, caseId);
  }

  @Patch('admin/brands/:brandId/cases/:caseId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  updateBrandCaseAdmin(
    @CurrentUser('sub') adminUserId: string,
    @CurrentUser('role') role: UserRole,
    @Param('brandId') brandId: string,
    @Param('caseId') caseId: string,
    @Body() dto: UpdateMyCaseDto,
  ) {
    return this.svc.updateBrandCaseForAdmin(adminUserId, role, brandId, caseId, dto);
  }

  @Delete('admin/brands/:brandId/cases/:caseId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  deleteBrandCaseAdmin(
    @CurrentUser('sub') adminUserId: string,
    @CurrentUser('role') role: UserRole,
    @Param('brandId') brandId: string,
    @Param('caseId') caseId: string,
  ) {
    return this.svc.deleteBrandCaseForAdmin(adminUserId, role, brandId, caseId);
  }

  // ---- Admin ----

  @Get('admin/users/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  listForUserAdmin(
    @CurrentUser('sub') adminUserId: string,
    @CurrentUser('role') role: UserRole,
    @Param('userId') userId: string,
  ) {
    return this.svc.listCasesByUserForAdmin(adminUserId, role, userId);
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

  @Patch('admin/:id/likes-boost')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  patchCaseLikesBoostAdmin(
    @CurrentUser('sub') adminUserId: string,
    @CurrentUser('role') role: UserRole,
    @Param('id') id: string,
    @Body() dto: AdminPatchCaseLikesBoostDto,
  ) {
    return this.svc.updateCaseLikesAdminBoostForAdmin(adminUserId, role, id, dto.likesAdminBoost);
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
