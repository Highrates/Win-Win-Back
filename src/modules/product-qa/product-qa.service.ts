import { Injectable } from '@nestjs/common';
import type {
  CreateProductQaTopicDto,
  PatchProductQaTopicDto,
  PostProductQaMessageDto,
} from './dto/product-qa.dto';
import { ProductQaMessageStatus } from '@prisma/client';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaListService } from './product-qa-list.service';
import { ProductQaModerationService } from './product-qa-moderation.service';
import { ProductQaPostService } from './product-qa-post.service';
import { ProductQaTopicService } from './product-qa-topic.service';
import { ProductQaUploadService } from './product-qa-upload.service';
import { ProductQaStaffUnreadService } from './product-qa-staff-unread.service';
import { ProductQaPendingSummaryService } from './product-qa-pending-summary.service';
import { ProductQaChatProductsService, type ListChatProductsOpts } from './product-qa-chat-products.service';
import { ProductQaEditService } from './product-qa-edit.service';
import type {
  ProductQaMessageOut,
  ProductQaMessagesListOut,
  ProductQaMetaOut,
  ProductQaPendingSummaryOut,
  ProductQaChatProductsListOut,
  ProductQaTopicOut,
} from './product-qa.types';

/** Фасад для контроллеров — делегирует в специализированные сервисы. */
@Injectable()
export class ProductQaService {
  constructor(
    private readonly core: ProductQaCoreService,
    private readonly list: ProductQaListService,
    private readonly post: ProductQaPostService,
    private readonly topics: ProductQaTopicService,
    private readonly moderation: ProductQaModerationService,
    private readonly upload: ProductQaUploadService,
    private readonly staffUnread: ProductQaStaffUnreadService,
    private readonly pendingSummary: ProductQaPendingSummaryService,
    private readonly chatProducts: ProductQaChatProductsService,
    private readonly edit: ProductQaEditService,
  ) {}

  resolveJoinTarget(body: { productSlug?: string; productId?: string }) {
    return this.core.resolveJoinTarget(body);
  }

  resolveActiveProductById(productId: string) {
    return this.core.resolveActiveProductById(productId);
  }

  resolveActiveProductBySlug(slug: string) {
    return this.core.resolveActiveProductBySlug(slug);
  }

  getMetaBySlug(slug: string): Promise<ProductQaMetaOut> {
    return this.list.getMetaBySlug(slug);
  }

  listTopicsBySlug(slug: string): Promise<{ topics: ProductQaTopicOut[] }> {
    return this.list.listTopicsBySlug(slug);
  }

  listTopicsForProduct(productId: string): Promise<{ topics: ProductQaTopicOut[] }> {
    return this.list.listTopicsForProduct(productId);
  }

  async listTopicsForProductAsStaff(
    staffUserId: string,
    staffRole: string,
    productId: string,
  ): Promise<{ topics: ProductQaTopicOut[] }> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    return this.list.listTopicsForProduct(productId);
  }

  listMessagesBySlug(
    slug: string,
    opts?: Parameters<ProductQaListService['listMessagesBySlug']>[1],
  ): Promise<ProductQaMessagesListOut> {
    return this.list.listMessagesBySlug(slug, opts);
  }

  listMessagesForProduct(
    productId: string,
    opts?: Parameters<ProductQaListService['listMessagesForProduct']>[1],
  ): Promise<ProductQaMessagesListOut> {
    return this.list.listMessagesForProduct(productId, opts);
  }

  async listMessagesForProductAsStaff(
    staffUserId: string,
    staffRole: string,
    productId: string,
    opts?: Parameters<ProductQaListService['listMessagesForProduct']>[1],
  ): Promise<ProductQaMessagesListOut> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    return this.list.listMessagesForProduct(productId, opts);
  }

  postMessageBySlug(
    slug: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostProductQaMessageDto,
  ): Promise<ProductQaMessageOut> {
    return this.post.postMessageBySlug(slug, jwtUserId, jwtRole, dto);
  }

  postMessageForProduct(
    productId: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostProductQaMessageDto,
  ): Promise<ProductQaMessageOut> {
    return this.post.postMessageForProduct(productId, jwtUserId, jwtRole, dto);
  }

  createTopic(
    productId: string,
    staffUserId: string,
    staffRole: string,
    dto: CreateProductQaTopicDto,
  ): Promise<ProductQaTopicOut> {
    return this.topics.createTopic(productId, staffUserId, staffRole, dto);
  }

  patchTopic(
    productId: string,
    topicId: string,
    staffUserId: string,
    staffRole: string,
    dto: PatchProductQaTopicDto,
  ): Promise<ProductQaTopicOut> {
    return this.topics.patchTopic(productId, topicId, staffUserId, staffRole, dto);
  }

  uploadAttachment(
    productId: string,
    jwtUserId: string,
    jwtRole: string,
    file: Express.Multer.File,
  ) {
    return this.upload.uploadAttachment(productId, jwtUserId, jwtRole, file);
  }

  revokePendingUpload(productId: string, jwtUserId: string, url: string) {
    return this.upload.revokePendingUpload(productId, jwtUserId, url);
  }

  setMessageStatus(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
    status: ProductQaMessageStatus,
  ): Promise<ProductQaMessageOut> {
    return this.moderation.setMessageStatus(
      productId,
      messageId,
      staffUserId,
      staffRole,
      status,
    );
  }

  approvePendingMessage(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
  ): Promise<ProductQaMessageOut> {
    return this.moderation.approvePendingMessage(
      productId,
      messageId,
      staffUserId,
      staffRole,
    );
  }

  rejectPendingMessage(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
  ): Promise<ProductQaMessageOut> {
    return this.moderation.rejectPendingMessage(
      productId,
      messageId,
      staffUserId,
      staffRole,
    );
  }

  getStaffQaUnreadSummary(
    staffUserId: string,
    staffRole: string,
    opts?: { from?: string; to?: string },
  ) {
    return this.staffUnread.getUnreadSummary(staffUserId, staffRole, opts);
  }

  getStaffQaPendingSummary(
    staffUserId: string,
    staffRole: string,
  ): Promise<ProductQaPendingSummaryOut> {
    return this.pendingSummary.getPendingSummary(staffUserId, staffRole);
  }

  getStaffQaChatProducts(
    staffUserId: string,
    staffRole: string,
    opts?: ListChatProductsOpts,
  ): Promise<ProductQaChatProductsListOut> {
    return this.chatProducts.listChatProducts(staffUserId, staffRole, opts);
  }

  markProductQaSeen(staffUserId: string, staffRole: string, productId: string) {
    return this.staffUnread.markProductSeen(staffUserId, staffRole, productId);
  }

  editMessageBySlug(
    slug: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
    body: string,
  ): Promise<ProductQaMessageOut> {
    return this.edit.editMessageBySlug(slug, messageId, jwtUserId, jwtRole, body);
  }

  editMessageForProduct(
    productId: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
    body: string,
  ): Promise<ProductQaMessageOut> {
    return this.edit.editMessage(productId, messageId, jwtUserId, jwtRole, body);
  }

  listMessageRevisions(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
  ) {
    return this.edit.listRevisions(productId, messageId, staffUserId, staffRole);
  }
}
