import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { OrderChatService } from './order-chat.service';
import { OrderChatGateway } from './order-chat.gateway';
import { OrderChatRetentionService } from './order-chat-retention.service';
import { OrderChatUserController } from './order-chat-user.controller';
import { OrderChatAdminController } from './order-chat-admin.controller';
import { OrderChatMeUnreadController } from './order-chat-me-unread.controller';

@Module({
  imports: [PrismaModule, StorageModule, forwardRef(() => AuthModule)],
  controllers: [OrderChatUserController, OrderChatAdminController, OrderChatMeUnreadController],
  providers: [OrderChatService, OrderChatGateway, OrderChatRetentionService],
  exports: [OrderChatService],
})
export class OrderChatModule {}
