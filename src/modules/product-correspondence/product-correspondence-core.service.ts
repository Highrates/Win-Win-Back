import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductQaAuthorRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductQaCoreService } from '../product-qa/product-qa-core.service';
import { productQaAuthorRoleFromJwt } from '../product-qa/product-qa-auth.util';

@Injectable()
export class ProductCorrespondenceCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qaCore: ProductQaCoreService,
  ) {}

  resolveActiveProductBySlug(slug: string) {
    return this.qaCore.resolveActiveProductBySlug(slug);
  }

  resolveProductById(productId: string) {
    return this.qaCore.resolveProductById(productId);
  }

  assertStaffCatalogAccess(userId: string, role: string) {
    return this.qaCore.assertStaffCatalogAccess(userId, role);
  }

  normalizePageLimit(limitRaw?: number) {
    return this.qaCore.normalizePageLimit(limitRaw);
  }

  async resolveOrCreateCorrespondence(
    productId: string,
    customerUserId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return db.productCorrespondence.upsert({
      where: {
        productId_customerUserId: { productId, customerUserId },
      },
      create: { productId, customerUserId },
      update: {},
      select: { id: true, productId: true, customerUserId: true },
    });
  }

  async getCorrespondenceForCustomer(productId: string, customerUserId: string) {
    const row = await this.prisma.productCorrespondence.findUnique({
      where: { productId_customerUserId: { productId, customerUserId } },
      select: { id: true, productId: true, customerUserId: true },
    });
    if (!row) throw new NotFoundException('Переписка не найдена');
    return row;
  }

  async assertCorrespondenceAccess(
    correspondenceId: string,
    viewerUserId: string,
    jwtRole: string,
  ): Promise<{ id: string; productId: string; customerUserId: string }> {
    const row = await this.prisma.productCorrespondence.findUnique({
      where: { id: correspondenceId },
      select: { id: true, productId: true, customerUserId: true },
    });
    if (!row) throw new NotFoundException('Переписка не найдена');
    const role = productQaAuthorRoleFromJwt(jwtRole);
    if (role === ProductQaAuthorRole.STAFF) {
      await this.assertStaffCatalogAccess(viewerUserId, jwtRole);
      return row;
    }
    if (row.customerUserId !== viewerUserId) {
      throw new ForbiddenException('Нет доступа к переписке');
    }
    return row;
  }
}
