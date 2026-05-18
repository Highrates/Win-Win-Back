import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrderSettingsService } from './order-settings.service';
import { UpdateOrderSettingsAdminDto } from './dto/order-settings-admin.dto';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class OrderSettingsAdminController {
  constructor(private readonly orderSettingsService: OrderSettingsService) {}

  @Get('admin/orders')
  getOrdersSettings() {
    return this.orderSettingsService.getAdmin();
  }

  @Patch('admin/orders')
  patchOrdersSettings(@Body() dto: UpdateOrderSettingsAdminDto) {
    return this.orderSettingsService.patchAdmin(dto);
  }
}
