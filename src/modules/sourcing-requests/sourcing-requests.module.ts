import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AuthModule } from '../auth/auth.module';
import { OrderChatModule } from '../order-chat/order-chat.module';
import { CatalogModule } from '../catalog/catalog.module';
import { SourcingRequestsService } from './sourcing-requests.service';
import { SourcingCommercialProposalService } from './sourcing-commercial-proposal.service';
import { SourcingRequestsController } from './sourcing-requests.controller';
import { SourcingRequestsAdminController } from './sourcing-requests-admin.controller';
import { SourcingCommercialProposalsAdminController } from './sourcing-commercial-proposals-admin.controller';
import { SourcingChatUserController } from './sourcing-chat-user.controller';
import { SourcingChatAdminController } from './sourcing-chat-admin.controller';

@Module({
  imports: [PrismaModule, StorageModule, AuthModule, OrderChatModule, CatalogModule],
  providers: [SourcingRequestsService, SourcingCommercialProposalService],
  controllers: [
    SourcingCommercialProposalsAdminController,
    SourcingChatAdminController,
    SourcingChatUserController,
    SourcingRequestsAdminController,
    SourcingRequestsController,
  ],
  exports: [SourcingRequestsService],
})
export class SourcingRequestsModule {}
