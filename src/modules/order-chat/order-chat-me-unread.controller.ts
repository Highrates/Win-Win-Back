import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CUSTOMER_IN_WORK_STATUSES } from '../orders/order-status.constants';
import { OrderChatService } from './order-chat.service';

@Controller('order-chat')
@UseGuards(JwtAuthGuard)
export class OrderChatMeUnreadController {
  constructor(private readonly chat: OrderChatService) {}

  @Get('me/unread-count')
  async unread(@CurrentUser('sub') userId: string, @Query('scope') scope?: string) {
    const workStatuses = scope === 'work' ? [...CUSTOMER_IN_WORK_STATUSES] : undefined;
    const count = await this.chat.unreadCountForCustomer(userId, {
      orderStatuses: workStatuses,
    });
    return { count };
  }
}
