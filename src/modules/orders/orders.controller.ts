import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/** Создание заказов только через `orders/me/preparation/*` + submit → согласование. */
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  myOrders(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ordersService.findByUser(userId, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20);
  }

  @Get(':id')
  one(@CurrentUser('sub') userId: string, @Param('id') orderId: string) {
    return this.ordersService.findOne(userId, orderId);
  }
}
