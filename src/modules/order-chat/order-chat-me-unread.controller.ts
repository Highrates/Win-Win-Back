import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrderChatService } from './order-chat.service';

@Controller('order-chat')
@UseGuards(JwtAuthGuard)
export class OrderChatMeUnreadController {
  constructor(private readonly chat: OrderChatService) {}

  @Get('me/unread-count')
  async unread(@CurrentUser('sub') userId: string) {
    const count = await this.chat.unreadCountForCustomer(userId);
    return { count };
  }
}
