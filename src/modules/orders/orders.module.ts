import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersAdminController } from './orders-admin.controller';
import { OrdersMeController } from './orders-me.controller';
import { OrderChatModule } from '../order-chat/order-chat.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [OrderChatModule, AuthModule],
  providers: [OrdersService],
  /**
   * Порядок: `me` и `admin` до `OrdersController`, иначе `GET orders/:id` съедает `GET orders/admin` (`:id` = admin).
   */
  controllers: [OrdersMeController, OrdersAdminController, OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
