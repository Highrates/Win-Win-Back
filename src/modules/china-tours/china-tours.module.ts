import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrderChatModule } from '../order-chat/order-chat.module';
import { ChinaToursService } from './china-tours.service';
import { ChinaToursController } from './china-tours.controller';
import { ChinaToursAdminService } from './china-tours-admin.service';
import { ChinaToursAdminController } from './china-tours-admin.controller';

@Module({
  imports: [AuthModule, OrderChatModule],
  providers: [ChinaToursService, ChinaToursAdminService],
  controllers: [ChinaToursController, ChinaToursAdminController],
  exports: [ChinaToursService, ChinaToursAdminService],
})
export class ChinaToursModule {}
