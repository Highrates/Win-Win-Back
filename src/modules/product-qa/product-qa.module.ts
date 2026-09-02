import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrderChatModule } from '../order-chat/order-chat.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffModule } from '../staff/staff.module';
import { StorageModule } from '../storage/storage.module';
import { MeilisearchModule } from '../../meilisearch/meilisearch.module';
import { ProductQaService } from './product-qa.service';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaListService } from './product-qa-list.service';
import { ProductQaPostService } from './product-qa-post.service';
import { ProductQaTopicService } from './product-qa-topic.service';
import { ProductQaBroadcastService } from './product-qa-broadcast.service';
import { ProductQaModerationService } from './product-qa-moderation.service';
import { ProductQaUploadService } from './product-qa-upload.service';
import { ProductQaSearchSyncService } from './product-qa-search-sync.service';
import { ProductQaNotifyService } from './product-qa-notify.service';
import { ProductQaStaffUnreadService } from './product-qa-staff-unread.service';
import { ProductQaPendingSummaryService } from './product-qa-pending-summary.service';
import { ProductQaChatProductsService } from './product-qa-chat-products.service';
import { ProductQaQueueMetricsService } from './product-qa-queue-metrics.service';
import { ProductQaEditService } from './product-qa-edit.service';
import { ProductQaPublicController } from './product-qa-public.controller';
import { ProductQaAdminController } from './product-qa-admin.controller';
import { ProductQaGateway } from './product-qa.gateway';
import { ProductCorrespondenceCoreService } from '../product-correspondence/product-correspondence-core.service';
import { ProductCorrespondenceEditService } from '../product-correspondence/product-correspondence-edit.service';
import { ProductCorrespondenceListService } from '../product-correspondence/product-correspondence-list.service';
import { ProductCorrespondencePostService } from '../product-correspondence/product-correspondence-post.service';
import { ProductCorrespondenceService } from '../product-correspondence/product-correspondence.service';
import { ProductCorrespondencePublicController } from '../product-correspondence/product-correspondence-public.controller';
import { ProductCorrespondenceMeController } from '../product-correspondence/product-correspondence-me.controller';
import { ProductCorrespondenceAdminController } from '../product-correspondence/product-correspondence-admin.controller';

@Module({
  imports: [PrismaModule, AuthModule, StaffModule, StorageModule, MeilisearchModule, OrderChatModule],
  controllers: [
    ProductQaPublicController,
    ProductQaAdminController,
    ProductCorrespondencePublicController,
    ProductCorrespondenceMeController,
    ProductCorrespondenceAdminController,
  ],
  providers: [
    ProductQaCoreService,
    ProductQaListService,
    ProductQaPostService,
    ProductQaTopicService,
    ProductQaBroadcastService,
    ProductQaModerationService,
    ProductQaUploadService,
    ProductQaSearchSyncService,
    ProductQaNotifyService,
    ProductQaStaffUnreadService,
    ProductQaPendingSummaryService,
    ProductQaQueueMetricsService,
    ProductQaChatProductsService,
    ProductQaEditService,
    ProductQaGateway,
    ProductQaService,
    ProductCorrespondenceCoreService,
    ProductCorrespondenceListService,
    ProductCorrespondencePostService,
    ProductCorrespondenceEditService,
    ProductCorrespondenceService,
  ],
  exports: [ProductQaService, ProductCorrespondenceService],
})
export class ProductQaModule {}
