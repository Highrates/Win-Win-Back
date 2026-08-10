import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ProductQaMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { mapQaMessage, qaMessageInclude } from './product-qa.mapper';
import { ProductQaCoreService } from './product-qa-core.service';
import type { ProductQaMessagesListOut, ProductQaMetaOut, ProductQaTopicOut } from './product-qa.types';

@Injectable()
export class ProductQaListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductQaCoreService,
  ) {}

  async getMetaBySlug(slug: string): Promise<ProductQaMetaOut> {
    const product = await this.core.resolveActiveProductBySlug(slug);
    return this.core.buildMeta(product.id);
  }

  async listTopicsBySlug(slug: string): Promise<{ topics: ProductQaTopicOut[] }> {
    const product = await this.core.resolveActiveProductBySlug(slug);
    return { topics: await this.core.loadTopics(product.id) };
  }

  async listTopicsForProduct(productId: string): Promise<{ topics: ProductQaTopicOut[] }> {
    await this.core.resolveProductById(productId);
    return { topics: await this.core.loadTopics(productId) };
  }

  async listMessagesBySlug(
    slug: string,
    opts?: {
      limit?: number;
      beforeMessageId?: string | null;
      includeNonVisible?: boolean;
      topicSlug?: string | null;
      status?: ProductQaMessageStatus | null;
      viewerUserId?: string | null;
    },
  ): Promise<ProductQaMessagesListOut> {
    const product = await this.core.resolveActiveProductBySlug(slug);
    return this.listMessagesForProduct(product.id, opts);
  }

  async listMessagesForProduct(
    productId: string,
    opts?: {
      limit?: number;
      beforeMessageId?: string | null;
      includeNonVisible?: boolean;
      topicSlug?: string | null;
      status?: ProductQaMessageStatus | null;
      viewerUserId?: string | null;
    },
  ): Promise<ProductQaMessagesListOut> {
    const limit = this.core.normalizePageLimit(opts?.limit);
    const thread = await this.core.resolveThread(productId, opts?.topicSlug);

    let messageWhere: Prisma.ProductQaMessageWhereInput = { threadId: thread.id };
    if (opts?.status) {
      messageWhere = { ...messageWhere, status: opts.status };
    } else if (!opts?.includeNonVisible) {
      const viewerId = opts?.viewerUserId?.trim();
      messageWhere = viewerId
        ? {
            ...messageWhere,
            OR: [
              { status: ProductQaMessageStatus.VISIBLE },
              {
                status: ProductQaMessageStatus.PENDING,
                authorUserId: viewerId,
              },
              {
                status: ProductQaMessageStatus.REJECTED,
                authorUserId: viewerId,
              },
            ],
          }
        : { ...messageWhere, status: ProductQaMessageStatus.VISIBLE };
    }

    const beforeId = opts?.beforeMessageId?.trim();
    if (beforeId) {
      const anchor = await this.prisma.productQaMessage.findFirst({
        where: { id: beforeId, threadId: thread.id },
        select: { id: true, createdAt: true },
      });
      if (!anchor) throw new BadRequestException('Неизвестная граница истории сообщений');
      messageWhere = {
        AND: [
          messageWhere,
          {
            OR: [
              { createdAt: { lt: anchor.createdAt } },
              {
                AND: [{ createdAt: anchor.createdAt }, { id: { lt: anchor.id } }],
              },
            ],
          },
        ],
      };
    }

    const rowsDesc = await this.prisma.productQaMessage.findMany({
      where: messageWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: qaMessageInclude(),
    });

    const hasOlder = rowsDesc.length > limit;
    const chronological = rowsDesc.slice(0, limit).reverse();

    return {
      threadId: thread.id,
      topicSlug: thread.slug,
      messages: chronological.map(mapQaMessage),
      hasOlder,
    };
  }
}
