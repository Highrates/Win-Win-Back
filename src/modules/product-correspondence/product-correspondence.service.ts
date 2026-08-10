import { Injectable } from '@nestjs/common';
import type { PostProductQaMessageDto } from '../product-qa/dto/product-qa.dto';
import { ProductCorrespondenceListService } from './product-correspondence-list.service';
import { ProductCorrespondenceEditService } from './product-correspondence-edit.service';
import { ProductCorrespondencePostService } from './product-correspondence-post.service';
import { ProductCorrespondenceCoreService } from './product-correspondence-core.service';
import type { PostProductCorrespondenceMessageDto, PublishCorrespondenceToQaDto, PublishCorrespondencePairToQaDto } from './dto/product-correspondence.dto';
import type {
  ProductCorrespondenceMessageOut,
  ProductCorrespondenceMessagesListOut,
  ProductCorrespondenceMyProductsListOut,
  ProductCorrespondenceThreadsListOut,
} from './product-correspondence.types';

@Injectable()
export class ProductCorrespondenceService {
  constructor(
    private readonly list: ProductCorrespondenceListService,
    private readonly post: ProductCorrespondencePostService,
    private readonly edit: ProductCorrespondenceEditService,
    private readonly core: ProductCorrespondenceCoreService,
  ) {}

  listMessagesBySlug(
    slug: string,
    customerUserId: string,
    opts?: { limit?: number; beforeMessageId?: string },
  ): Promise<ProductCorrespondenceMessagesListOut> {
    return this.list.listMessagesBySlug(slug, customerUserId, opts);
  }

  listMessagesForProduct(
    productId: string,
    customerUserId: string,
    opts?: { limit?: number; beforeMessageId?: string },
  ): Promise<ProductCorrespondenceMessagesListOut> {
    return this.list.listMessagesForProduct(productId, customerUserId, opts);
  }

  listMyProducts(userId: string): Promise<ProductCorrespondenceMyProductsListOut> {
    return this.list.listMyProducts(userId);
  }

  listThreadsForProduct(productId: string): Promise<ProductCorrespondenceThreadsListOut> {
    return this.list.listThreadsForProduct(productId);
  }

  async listThreadsForProductAsStaff(
    staffUserId: string,
    staffRole: string,
    productId: string,
  ): Promise<ProductCorrespondenceThreadsListOut> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    return this.list.listThreadsForProduct(productId);
  }

  async listMessagesForProductAsStaff(
    staffUserId: string,
    staffRole: string,
    productId: string,
    customerUserId: string,
    opts?: { limit?: number; beforeMessageId?: string },
  ): Promise<ProductCorrespondenceMessagesListOut> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    return this.list.listMessagesForProduct(productId, customerUserId, opts);
  }

  postBySlug(
    slug: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostProductQaMessageDto | PostProductCorrespondenceMessageDto,
  ): Promise<ProductCorrespondenceMessageOut> {
    return this.post.postBySlug(slug, jwtUserId, jwtRole, dto);
  }

  postForProduct(
    productId: string,
    jwtUserId: string,
    jwtRole: string,
    dto: PostProductCorrespondenceMessageDto,
    opts?: { customerUserId?: string },
  ): Promise<ProductCorrespondenceMessageOut> {
    return this.post.postForProduct(productId, jwtUserId, jwtRole, dto, opts);
  }

  publishMessageToQa(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
    dto?: PublishCorrespondenceToQaDto,
  ): Promise<ProductCorrespondenceMessageOut> {
    return this.post.publishMessageToQa(
      productId,
      messageId,
      staffUserId,
      staffRole,
      dto?.topicSlug,
    );
  }

  publishPairToQa(
    productId: string,
    staffUserId: string,
    staffRole: string,
    dto: PublishCorrespondencePairToQaDto,
  ) {
    return this.post.publishPairToQa(
      productId,
      dto.questionMessageId,
      dto.answerMessageId,
      staffUserId,
      staffRole,
      dto.topicSlug,
    );
  }

  editMessageBySlug(
    slug: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
    body: string,
  ): Promise<ProductCorrespondenceMessageOut> {
    return this.edit.editMessageBySlug(slug, messageId, jwtUserId, jwtRole, body);
  }

  editMessageForProduct(
    productId: string,
    customerUserId: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
    body: string,
  ): Promise<ProductCorrespondenceMessageOut> {
    return this.edit.editMessageForProduct(
      productId,
      customerUserId,
      messageId,
      jwtUserId,
      jwtRole,
      body,
    );
  }

  listMessageRevisions(
    productId: string,
    customerUserId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
  ) {
    return this.edit.listRevisions(
      productId,
      customerUserId,
      messageId,
      staffUserId,
      staffRole,
    );
  }
}
