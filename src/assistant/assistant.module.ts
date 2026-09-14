import { Module } from '@nestjs/common';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { OrderChatModule } from '../modules/order-chat/order-chat.module';
import { OrdersModule } from '../modules/orders/orders.module';
import { ProductQaModule } from '../modules/product-qa/product-qa.module';
import { ReferralsModule } from '../modules/referrals/referrals.module';
import { SourcingRequestsModule } from '../modules/sourcing-requests/sourcing-requests.module';
import { StaffModule } from '../modules/staff/staff.module';
import { UsersModule } from '../modules/users/users.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AssistantAdminController } from './assistant-admin.controller';
import { AssistantService } from './assistant.service';
import { AssistantToolsService } from './assistant-tools.service';
import { GptunnelClient } from './gptunnel.client';

@Module({
  imports: [
    PrismaModule,
    StaffModule,
    OrdersModule,
    OrderChatModule,
    CatalogModule,
    SourcingRequestsModule,
    UsersModule,
    ProductQaModule,
    ReferralsModule,
  ],
  controllers: [AssistantAdminController],
  providers: [AssistantService, AssistantToolsService, GptunnelClient],
})
export class AssistantModule {}
