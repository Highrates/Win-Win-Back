import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateProductQaTopicDto, PatchProductQaTopicDto } from './dto/product-qa.dto';
import { PRODUCT_QA_DEFAULT_TOPIC_SLUG } from './product-qa.constants';
import { ProductQaBroadcastService } from './product-qa-broadcast.service';
import { ProductQaCoreService } from './product-qa-core.service';
import { mapQaTopic } from './product-qa.mapper';
import type { ProductQaTopicOut } from './product-qa.types';
import { normalizeProductQaTopicSlug } from './product-qa.util';

@Injectable()
export class ProductQaTopicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductQaCoreService,
    private readonly broadcast: ProductQaBroadcastService,
  ) {}

  async createTopic(
    productId: string,
    staffUserId: string,
    staffRole: string,
    dto: CreateProductQaTopicDto,
  ): Promise<ProductQaTopicOut> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    await this.core.resolveProductById(productId);
    await this.core.ensureDefaultThread(productId);

    const title = dto.title?.trim();
    if (!title) throw new BadRequestException('Укажите название топика');

    const slug = normalizeProductQaTopicSlug(dto.slug?.trim() || title);
    if (slug === PRODUCT_QA_DEFAULT_TOPIC_SLUG) {
      throw new BadRequestException('Этот slug зарезервирован');
    }

    const maxSort = await this.prisma.productQaThread.aggregate({
      where: { productId },
      _max: { sortOrder: true },
    });

    try {
      const created = await this.prisma.productQaThread.create({
        data: {
          productId,
          title,
          slug,
          isDefault: false,
          sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
        },
        select: {
          id: true,
          slug: true,
          title: true,
          messageCountPublic: true,
          isDefault: true,
          sortOrder: true,
        },
      });
      void this.broadcast.broadcastMeta(productId);
      return mapQaTopic(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Топик с таким slug уже существует');
      }
      throw e;
    }
  }

  async patchTopic(
    productId: string,
    topicId: string,
    staffUserId: string,
    staffRole: string,
    dto: PatchProductQaTopicDto,
  ): Promise<ProductQaTopicOut> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    const thread = await this.prisma.productQaThread.findFirst({
      where: { id: topicId, productId },
      select: { id: true },
    });
    if (!thread) throw new NotFoundException('Топик не найден');

    const title = dto.title?.trim();
    const sortOrder =
      dto.sortOrder != null && Number.isFinite(dto.sortOrder)
        ? Math.floor(dto.sortOrder)
        : undefined;

    const updated = await this.prisma.productQaThread.update({
      where: { id: topicId },
      data: {
        ...(title ? { title } : {}),
        ...(sortOrder != null ? { sortOrder } : {}),
      },
      select: {
        id: true,
        slug: true,
        title: true,
        messageCountPublic: true,
        isDefault: true,
        sortOrder: true,
      },
    });
    void this.broadcast.broadcastMeta(productId);
    return mapQaTopic(updated);
  }
}
