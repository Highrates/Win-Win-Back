import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
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
import { UpdateStaffSelfDto } from './dto/staff-self.dto';
import { StaffAdminService } from './staff-admin.service';

const STAFF_AVATAR_MAX = 2 * 1024 * 1024;

@Controller('settings/admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class StaffSelfController {
  constructor(private readonly staffAdmin: StaffAdminService) {}

  @Get('me')
  getMe(@CurrentUser('sub') userId: string) {
    return this.staffAdmin.getStaffSelf(userId);
  }

  @Patch('me')
  updateMe(@CurrentUser('sub') userId: string, @Body() dto: UpdateStaffSelfDto) {
    return this.staffAdmin.updateStaffSelf(userId, dto);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: STAFF_AVATAR_MAX } }))
  uploadAvatar(@CurrentUser('sub') userId: string, @UploadedFile() file: Express.Multer.File) {
    return this.staffAdmin.uploadStaffAvatar(userId, userId, file);
  }
}
