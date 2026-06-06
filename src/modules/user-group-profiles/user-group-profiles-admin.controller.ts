import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DesignerBonusProfilesService } from './designer-bonus-profiles.service';
import { ReferralProgramProfilesService } from './referral-program-profiles.service';
import { UpsertDesignerBonusProfileAdminDto } from './dto/designer-bonus-profile-admin.dto';
import { UpsertReferralProgramProfileAdminDto } from './dto/referral-program-profile-admin.dto';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class UserGroupProfilesAdminController {
  constructor(
    private readonly referralProgramProfiles: ReferralProgramProfilesService,
    private readonly designerBonusProfiles: DesignerBonusProfilesService,
  ) {}

  @Get('admin/referral-program-profiles')
  listReferralProgramProfiles() {
    return this.referralProgramProfiles.list();
  }

  @Post('admin/referral-program-profiles')
  createReferralProgramProfile(@Body() dto: UpsertReferralProgramProfileAdminDto) {
    return this.referralProgramProfiles.create(dto);
  }

  @Patch('admin/referral-program-profiles/:id')
  patchReferralProgramProfile(
    @Param('id') id: string,
    @Body() dto: UpsertReferralProgramProfileAdminDto,
  ) {
    return this.referralProgramProfiles.update(id, dto);
  }

  @Delete('admin/referral-program-profiles/:id')
  deleteReferralProgramProfile(@Param('id') id: string) {
    return this.referralProgramProfiles.remove(id);
  }

  @Get('admin/designer-bonus-profiles')
  listDesignerBonusProfiles() {
    return this.designerBonusProfiles.list();
  }

  @Post('admin/designer-bonus-profiles')
  createDesignerBonusProfile(@Body() dto: UpsertDesignerBonusProfileAdminDto) {
    return this.designerBonusProfiles.create(dto);
  }

  @Patch('admin/designer-bonus-profiles/:id')
  patchDesignerBonusProfile(
    @Param('id') id: string,
    @Body() dto: UpsertDesignerBonusProfileAdminDto,
  ) {
    return this.designerBonusProfiles.update(id, dto);
  }

  @Delete('admin/designer-bonus-profiles/:id')
  deleteDesignerBonusProfile(@Param('id') id: string) {
    return this.designerBonusProfiles.remove(id);
  }
}
