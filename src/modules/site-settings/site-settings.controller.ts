import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '@prisma/client';
import { SiteSettingsService } from './site-settings.service';
import { UpdateSiteSettingsAdminDto } from './dto/site-settings.dto';

@Controller('settings')
export class SiteSettingsController {
  constructor(private readonly svc: SiteSettingsService) {}

  /** Публичные настройки витрины (главная и т.п.). */
  @Public()
  @Get('site')
  getPublic() {
    return this.svc.getPublic();
  }

  /** Админ: текущие настройки сайта. */
  @Get('admin/site')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  getAdmin() {
    return this.svc.getAdmin();
  }

  /** Админ: обновить настройки сайта. */
  @Patch('admin/site')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  updateAdmin(@Body() dto: UpdateSiteSettingsAdminDto) {
    return this.svc.updateAdmin({
      heroImageUrls: dto.heroImageUrls,
      designerServiceOptions: dto.designerServiceOptions,
    });
  }
}

