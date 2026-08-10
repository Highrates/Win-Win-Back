import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProductQaAuthorRole, ProductQaMessageStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { productQaAuthorRoleFromJwt } from './product-qa-auth.util';
import {
  PRODUCT_QA_BODY_MAX_CHARS,
  PRODUCT_QA_EDIT_WITHIN_MS,
} from './product-qa.constants';
import {
  correspondenceMessageInclude,
  mapCorrespondenceMessage,
} from '../product-correspondence/product-correspondence.mapper';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaGateway } from './product-qa.gateway';
import { labelQaAuthor, mapQaMessage, qaAuthorInclude, qaMessageInclude } from './product-qa.mapper';
import type { ProductQaMessageOut, ProductQaMessageRevisionOut } from './product-qa.types';

@Injectable()
export class ProductQaEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: ProductQaCoreService,
    private readonly gateway: ProductQaGateway,
  ) {}

  async editMessageBySlug(
    slug: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
    body: string,
  ): Promise<ProductQaMessageOut> {
    const product = await this.core.resolveActiveProductBySlug(slug);
    return this.editMessage(product.id, messageId, jwtUserId, jwtRole, body);
  }

  async editMessage(
    productId: string,
    messageId: string,
    jwtUserId: string,
    jwtRole: string,
    bodyRaw: string,
  ): Promise<ProductQaMessageOut> {
    const authorRole = productQaAuthorRoleFromJwt(jwtRole);
    const message = await this.prisma.productQaMessage.findFirst({
      where: { id: messageId, thread: { productId } },
      include: qaMessageInclude(),
    });
    if (!message) throw new NotFoundException('Сообщение не найдено');

    if (authorRole === ProductQaAuthorRole.STAFF) {
      await this.core.assertStaffCatalogAccess(jwtUserId, jwtRole);
      if (message.status === ProductQaMessageStatus.DELETED) {
        throw new BadRequestException('Нельзя редактировать удалённое сообщение');
      }
    } else {
      this.assertUserCanEdit(message, jwtUserId);
    }

    const body = bodyRaw.trim();
    if (!body) throw new BadRequestException('Пустое сообщение');
    if (body.length > PRODUCT_QA_BODY_MAX_CHARS) {
      throw new BadRequestException('Слишком длинное сообщение');
    }
    if (body === message.body.trim()) {
      return mapQaMessage(message);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.productQaMessageRevision.create({
        data: {
          messageId: message.id,
          body: message.body,
          editedByUserId: jwtUserId,
        },
      });
      const qaUpdated = await tx.productQaMessage.update({
        where: { id: message.id },
        data: {
          body,
          editedAt: new Date(),
          editedByUserId: jwtUserId,
        },
        include: qaMessageInclude(),
      });

      if (authorRole === ProductQaAuthorRole.STAFF) {
        const corrLink = await tx.productCorrespondenceMessage.findFirst({
          where: { publishedQaMessageId: message.id },
          select: { id: true, correspondenceId: true, body: true },
        });
        if (corrLink) {
          await tx.productCorrespondenceMessageRevision.create({
            data: {
              messageId: corrLink.id,
              body: corrLink.body,
              editedByUserId: jwtUserId,
            },
          });
          await tx.productCorrespondenceMessage.update({
            where: { id: corrLink.id },
            data: {
              body,
              editedAt: new Date(),
              editedByUserId: jwtUserId,
            },
          });
        }
      }

      return qaUpdated;
    });

    const out = mapQaMessage(updated);
    this.gateway.broadcastMessageUpdated(productId, out);

    if (authorRole === ProductQaAuthorRole.STAFF) {
      const corrMessage = await this.prisma.productCorrespondenceMessage.findFirst({
        where: { publishedQaMessageId: message.id },
        include: correspondenceMessageInclude(),
      });
      if (corrMessage) {
        this.gateway.broadcastCorrespondenceMessageUpdated(
          corrMessage.correspondenceId,
          mapCorrespondenceMessage(corrMessage),
        );
      }
    }

    return out;
  }

  async listRevisions(
    productId: string,
    messageId: string,
    staffUserId: string,
    staffRole: string,
  ): Promise<{ items: ProductQaMessageRevisionOut[] }> {
    await this.core.assertStaffCatalogAccess(staffUserId, staffRole);
    const message = await this.prisma.productQaMessage.findFirst({
      where: { id: messageId, thread: { productId } },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Сообщение не найдено');

    const rows = await this.prisma.productQaMessageRevision.findMany({
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
          row.editedByUserId === staffUserId &&
            (staffRole === UserRole.ADMIN || staffRole === UserRole.MODERATOR)
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
      status: ProductQaMessageStatus;
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
    if (
      message.status !== ProductQaMessageStatus.VISIBLE &&
      message.status !== ProductQaMessageStatus.PENDING
    ) {
      throw new BadRequestException('Сообщение нельзя редактировать');
    }
    if (Date.now() - message.createdAt.getTime() > PRODUCT_QA_EDIT_WITHIN_MS) {
      throw new BadRequestException('Истекло время редактирования');
    }
  }
}
