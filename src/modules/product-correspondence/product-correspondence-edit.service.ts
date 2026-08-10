import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductQaAuthorRole, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { productQaAuthorRoleFromJwt } from '../product-qa/product-qa-auth.util';
import {
  PRODUCT_QA_BODY_MAX_CHARS,
  PRODUCT_QA_EDIT_WITHIN_MS,
} from '../product-qa/product-qa.constants';
import { ProductQaGateway } from '../product-qa/product-qa.gateway';
import { labelQaAuthor, mapQaMessage, qaAuthorInclude, qaMessageInclude } from '../product-qa/product-qa.mapper';
import {
  correspondenceMessageInclude,
  mapCorrespondenceMessage,
} from './product-correspondence.mapper';
import { ProductCorrespondenceCoreService } from './product-correspondence-core.service';
import type {
  ProductCorrespondenceMessageOut,
  ProductCorrespondenceMessageRevisionOut,
} from './product-correspondence.types';

@Injectable()
export class ProductCorrespondenceEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductCorrespondenceCoreService,
    private readonly gateway: ProductQaGateway,
  ) {}

  async editMessageBySlug(
    slug: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
    body: string,
  ): Promise<ProductCorrespondenceMessageOut> {
    const product = await this.core.resolveActiveProductBySlug(slug);
    const correspondence = await this.core.getCorrespondenceForCustomer(product.id, jwtUserId);
    return this.editMessage(product.id, correspondence.id, messageId, jwtUserId, jwtRole, body);
  }

  async editMessageForProduct(
    productId: string,
    customerUserId: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
    body: string,
  ): Promise<ProductCorrespondenceMessageOut> {
    const correspondence = await this.core.getCorrespondenceForCustomer(productId, customerUserId);
    return this.editMessage(productId, correspondence.id, messageId, jwtUserId, jwtRole, body);
  }

  private async editMessage(
    productId: string,
    correspondenceId: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
    bodyRaw: string,
  ): Promise<ProductCorrespondenceMessageOut> {
    const authorRole = productQaAuthorRoleFromJwt(jwtRole);
    const message = await this.prisma.productCorrespondenceMessage.findFirst({
      where: { id: messageId, correspondenceId },
      include: correspondenceMessageInclude(),
    });
    if (!message) throw new NotFoundException('Сообщение не найдено');

    if (authorRole === ProductQaAuthorRole.STAFF) {
      await this.core.assertStaffCatalogAccess(jwtUserId, jwtRole);
    } else {
      this.assertUserCanEdit(message, jwtUserId);
    }

    const body = bodyRaw.trim();
    if (!body) throw new BadRequestException('Пустое сообщение');
    if (body.length > PRODUCT_QA_BODY_MAX_CHARS) {
      throw new BadRequestException('Слишком длинное сообщение');
    }
    if (body === message.body.trim()) {
      return mapCorrespondenceMessage(message);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.productCorrespondenceMessageRevision.create({
        data: {
          messageId: message.id,
          body: message.body,
          editedByUserId: jwtUserId,
        },
      });
      const corr = await tx.productCorrespondenceMessage.update({
        where: { id: message.id },
        data: {
          body,
          editedAt: new Date(),
          editedByUserId: jwtUserId,
        },
        include: correspondenceMessageInclude(),
      });
      if (corr.publishedQaMessageId) {
        await tx.productQaMessageRevision.create({
          data: {
            messageId: corr.publishedQaMessageId,
            body: message.body,
            editedByUserId: jwtUserId,
          },
        });
        await tx.productQaMessage.update({
          where: { id: corr.publishedQaMessageId },
          data: {
            body,
            editedAt: new Date(),
            editedByUserId: jwtUserId,
          },
        });
      }
      return corr;
    });

    const out = mapCorrespondenceMessage(updated);
    this.gateway.broadcastCorrespondenceMessageUpdated(correspondenceId, out);
    if (updated.publishedQaMessageId) {
      const qaMessage = await this.prisma.productQaMessage.findUniqueOrThrow({
        where: { id: updated.publishedQaMessageId },
        include: qaMessageInclude(),
      });
      this.gateway.broadcastMessageUpdated(productId, mapQaMessage(qaMessage));
    }
    return out;
  }

  async listRevisions(
    productId: string,
    customerUserId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
  ): Promise<{ items: ProductCorrespondenceMessageRevisionOut[] }> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    const correspondence = await this.core.getCorrespondenceForCustomer(productId, customerUserId);
    const message = await this.prisma.productCorrespondenceMessage.findFirst({
      where: { id: messageId, correspondenceId: correspondence.id },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Сообщение не найдено');

    const rows = await this.prisma.productCorrespondenceMessageRevision.findMany({
      where: { messageId },
      orderBy: { createdAt: 'desc' },
      include: {
        editedBy: { select: qaAuthorInclude() },
      },
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        body: row.body,
        editedByUserId: row.editedByUserId,
        editedByLabel: labelQaAuthor(
          staffRole === UserRole.ADMIN || staffRole === UserRole.MODERATOR
            ? ProductQaAuthorRole.STAFF
            : ProductQaAuthorRole.USER,
          row.editedBy,
        ),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private assertUserCanEdit(
    message: {
      authorUserId: string;
      authorRole: ProductQaAuthorRole;
      createdAt: Date;
    },
    jwtUserId: string,
  ): void {
    if (message.authorUserId !== jwtUserId) {
      throw new ForbiddenException('Можно редактировать только свои сообщения');
    }
    if (message.authorRole !== ProductQaAuthorRole.USER) {
      throw new ForbiddenException('Редактирование недоступно');
    }
    if (Date.now() - message.createdAt.getTime() > PRODUCT_QA_EDIT_WITHIN_MS) {
      throw new BadRequestException('Истекло время редактирования');
    }
  }
}
