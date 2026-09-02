import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import { UpdateOrderStatusAdminDto } from './dto/order-admin.dto';
import { OrderChatService } from '../order-chat/order-chat.service';

@Controller('orders/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class OrdersAdminController {
  constructor(
    private readonly orders: OrdersService,
    private readonly orderChat: OrderChatService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('q') q?: string,
    @Query('userId') userId?: string,
    @Query('bucket') bucket?: string,
  ) {
    const page = pageRaw ? parseInt(pageRaw, 10) : 1;
    const limit = limitRaw ? parseInt(limitRaw, 10) : 20;
    return this.orders.findManyForAdmin(
      Number.isFinite(page) ? page : 1,
      Number.isFinite(limit) ? limit : 20,
      q?.trim() || undefined,
      userId?.trim() || undefined,
      bucket?.trim() || undefined,
      user.sub,
    );
  }

  @Get('pending-approval-count')
  pendingApprovalCount() {
    return this.orders.countPendingApprovalForAdmin();
  }

  @Get('dashboard-status-summary')
  dashboardStatusSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.orders.getDashboardStatusSummaryForAdmin({
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }

  @Get('chat-unread-summary')
  chatUnreadSummary(@CurrentUser() user: JwtPayload) {
    return this.orderChat.unreadCustomerChatSummaryForAdminBuckets(user.sub);
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const order = await this.orders.findOneForAdmin(id);
    if (!order) throw new NotFoundException();
    return order;
  }

  @Delete(':id')
  @HttpCode(204)
  async deletePendingApproval(@Param('id') id: string) {
    await this.orders.deletePendingApprovalOrderForAdmin(id);
  }

  /** Same status → 200 без audit (идемпотентность). */
  @Patch(':id/status')
  patchStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusAdminDto) {
    return this.orders.updateStatus(id, dto.status, dto.documentUrls);
  }
}
