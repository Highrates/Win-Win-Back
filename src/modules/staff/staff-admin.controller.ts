import {
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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateStaffAdminDto, UpdateStaffAdminDto } from './dto/staff-admin.dto';
import { StaffAdminService } from './staff-admin.service';

const STAFF_AVATAR_MAX = 2 * 1024 * 1024;

@Controller('settings/admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class StaffAdminController {
  constructor(private readonly staffAdmin: StaffAdminService) {}

  @Get('sections')
  listSections(@Query('locale') localeRaw?: string) {
    const locale = localeRaw === 'zh' ? 'zh' : 'ru';
    return this.staffAdmin.listSectionCatalog(locale);
  }

  @Get()
  list() {
    return this.staffAdmin.listStaff();
  }

  @Post()
  create(@CurrentUser('sub') actorUserId: string, @Body() dto: CreateStaffAdminDto) {
    return this.staffAdmin.createStaff(actorUserId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser('sub') actorUserId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStaffAdminDto,
  ) {
    return this.staffAdmin.updateStaff(actorUserId, id, dto);
  }

  @Post(':id/reset-password')
  resetPassword(@CurrentUser('sub') actorUserId: string, @Param('id') id: string) {
    return this.staffAdmin.resetPassword(actorUserId, id);
  }

  @Post(':id/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: STAFF_AVATAR_MAX } }))
  uploadAvatar(
    @CurrentUser('sub') actorUserId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.staffAdmin.uploadStaffAvatar(actorUserId, id, file);
  }
}
