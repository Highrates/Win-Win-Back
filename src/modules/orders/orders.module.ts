import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersAdminController } from './orders-admin.controller';

@Module({
  providers: [OrdersService],
  controllers: [OrdersController, OrdersAdminController],
  exports: [OrdersService],
})
export class OrdersModule {}
