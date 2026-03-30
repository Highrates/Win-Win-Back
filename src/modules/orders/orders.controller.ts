import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: { items: { productId: string; quantity: number; price: number }[]; comment?: string }) {
    return this.ordersService.create(userId, dto);
  }

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
