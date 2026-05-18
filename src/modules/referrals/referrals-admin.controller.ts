import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReferralsService } from './referrals.service';
import { UpdateReferralProgramAdminDto } from './dto/referral-program-admin.dto';

@Controller('referrals/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class ReferralsAdminController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('program')
  getProgram() {
    return this.referralsService.getAdminProgramConfig();
  }

  @Patch('program')
  patchProgram(@Body() dto: UpdateReferralProgramAdminDto) {
    return this.referralsService.updateAdminProgramConfig(dto).then(() => this.referralsService.getAdminProgramConfig());
  }
}
