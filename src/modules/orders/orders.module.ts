import { Module } from '@nestjs/common';
import { CommercialProposalService } from './commercial-proposal.service';
import { CommercialProposalsAdminController } from './commercial-proposals-admin.controller';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersAdminController } from './orders-admin.controller';
import { OrdersMeController } from './orders-me.controller';
import { OrderChatModule } from '../order-chat/order-chat.module';
import { AuthModule } from '../auth/auth.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { OrderSettingsModule } from '../order-settings/order-settings.module';
import { UserGroupsModule } from '../user-groups/user-groups.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [OrderChatModule, AuthModule, ReferralsModule, OrderSettingsModule, UserGroupsModule, CatalogModule],
  providers: [OrdersService, CommercialProposalService],
  /**
   * Порядок: `me` и `admin` до `OrdersController`, иначе `GET orders/:id` съедает `GET orders/admin` (`:id` = admin).
   */
  controllers: [
    OrdersMeController,
    OrdersAdminController,
    CommercialProposalsAdminController,
    OrdersController,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
