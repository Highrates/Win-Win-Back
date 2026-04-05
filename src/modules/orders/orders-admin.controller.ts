import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrdersService } from './orders.service';
import { UpdateOrderStatusAdminDto } from './dto/order-admin.dto';

@Controller('orders/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class OrdersAdminController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('q') q?: string,
  ) {
    const page = pageRaw ? parseInt(pageRaw, 10) : 1;
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;
    return this.orders.findManyForAdmin(
      Number.isFinite(page) ? page : 1,
      Number.isFinite(limit) ? limit : 20,
      q?.trim() || undefined,
    );
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const order = await this.orders.findOneForAdmin(id);
    if (!order) throw new NotFoundException();
    return order;
  }

  @Patch(':id/status')
  async patchStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusAdminDto) {
    const order = await this.orders.updateStatus(id, dto.status, dto.documentUrls);
    return order;
  }
}
