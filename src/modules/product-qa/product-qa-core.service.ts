import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ProductQaMessageStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StaffAccessService } from '../staff/staff-access.service';
import {
  PRODUCT_QA_DEFAULT_TOPIC_SLUG,
  PRODUCT_QA_DEFAULT_TOPIC_TITLE,
  PRODUCT_QA_MESSAGES_PAGE_MAX,
  PRODUCT_QA_MESSAGES_PAGE_DEFAULT,
} from './product-qa.constants';
import { isProductQaPreModerationEnabled } from './product-qa-premod.util';
import { mapQaTopic } from './product-qa.mapper';
import type { ProductQaMetaOut, ProductQaTopicOut } from './product-qa.types';

const TOPIC_SELECT = {
  id: true,
  slug: true,
  title: true,
  messageCountPublic: true,
  isDefault: true,
  sortOrder: true,
} as const;

@Injectable()
export class ProductQaCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAccess: StaffAccessService,
    private readonly config: ConfigService,
  ) {}

  normalizePageLimit(limitRaw?: number): number {
    if (limitRaw != null && Number.isFinite(limitRaw)) {
      const n = Math.floor(limitRaw);
      return Math.min(PRODUCT_QA_MESSAGES_PAGE_MAX, Math.max(1, n));
    }
    return PRODUCT_QA_MESSAGES_PAGE_DEFAULT;
  }

  async resolveJoinTarget(body: {
    productSlug?: string;
    productId?: string;
  }): Promise<{ id: string; slug: string }> {
    const productId = body?.productId?.trim();
    if (productId) return this.resolveActiveProductById(productId);
    const slug = body?.productSlug?.trim();
    if (!slug) throw new BadRequestException('productSlug or productId required');
    return this.resolveActiveProductBySlug(slug);
  }

  async resolveActiveProductById(productId: string): Promise<{ id: string; slug: string }> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isActive: true },
      select: { id: true, slug: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return product;
  }

  async resolveActiveProductBySlug(slug: string): Promise<{ id: string; slug: string }> {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true },
      select: { id: true, slug: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return product;
  }

  async resolveProductById(productId: string): Promise<{ id: string; slug: string }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, slug: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return product;
  }

  async assertStaffCatalogAccess(userId: string, role: string): Promise<void> {
    await this.staffAccess.assertStaffCanAccessSection(userId, role as UserRole, 'catalog');
  }

  async ensureDefaultThread(
    productId: string,
  ): Promise<{ id: string; messageCountPublic: number; slug: string; title: string }> {
    return this.prisma.productQaThread.upsert({
      where: {
        productId_slug: { productId, slug: PRODUCT_QA_DEFAULT_TOPIC_SLUG },
      },
      create: {
        productId,
        slug: PRODUCT_QA_DEFAULT_TOPIC_SLUG,
        title: PRODUCT_QA_DEFAULT_TOPIC_TITLE,
        isDefault: true,
        sortOrder: 0,
      },
      update: {},
      select: {
        id: true,
        messageCountPublic: true,
        slug: true,
        title: true,
      },
    });
  }

  async resolveThread(productId: string, topicSlugRaw?: string | null) {
    await this.ensureDefaultThread(productId);
    const slug = topicSlugRaw?.trim() || PRODUCT_QA_DEFAULT_TOPIC_SLUG;
    const thread = await this.prisma.productQaThread.findUnique({
      where: { productId_slug: { productId, slug } },
      select: { id: true, messageCountPublic: true, slug: true, title: true },
    });
    if (!thread) throw new BadRequestException('Топик не найден');
    return thread;
  }

  async loadTopics(productId: string): Promise<ProductQaTopicOut[]> {
    await this.ensureDefaultThread(productId);
    const rows = await this.prisma.productQaThread.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: TOPIC_SELECT,
    });
    return rows.map(mapQaTopic);
  }

  async buildMeta(productId: string): Promise<ProductQaMetaOut> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { qaMessageCountPublic: true },
    });
    const topics = await this.loadTopics(productId);
    const defaultTopic = topics.find((t) => t.isDefault) ?? topics[0] ?? null;
    return {
      messageCount: Math.max(0, product?.qaMessageCountPublic ?? 0),
      threadId: defaultTopic?.id ?? null,
      topics,
      preModerationEnabled: isProductQaPreModerationEnabled(this.config),
    };
  }

  async lockProductForUpdate(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`,
    );
    if (rows.length === 0) throw new NotFoundException('Товар не найден');
  }

  async touchProductChatActivity(
    tx: Prisma.TransactionClient,
    productId: string,
    at: Date,
  ): Promise<void> {
    await tx.product.update({
      where: { id: productId },
      data: { lastChatActivityAt: at },
    });
  }

  async recalculatePublicCounts(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const grouped = await tx.productQaMessage.groupBy({
      by: ['threadId'],
      where: {
        status: ProductQaMessageStatus.VISIBLE,
        thread: { productId },
      },
      _count: { _all: true },
    });
    const countByThread = new Map(grouped.map((g) => [g.threadId, g._count._all]));

    const threads = await tx.productQaThread.findMany({
      where: { productId },
      select: { id: true },
    });

    let productTotal = 0;
    for (const thread of threads) {
      const count = countByThread.get(thread.id) ?? 0;
      productTotal += count;
      await tx.productQaThread.update({
        where: { id: thread.id },
        data: { messageCountPublic: count },
      });
    }

    await tx.product.update({
      where: { id: productId },
      data: { qaMessageCountPublic: productTotal },
    });
  }
}
