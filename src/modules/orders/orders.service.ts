import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(userId: string, dto: { items: { productId: string; quantity: number; price: number }[]; comment?: string }) {
    const totalAmount = dto.items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
    const order = await this.prisma.order.create({
      data: {
        userId,
        status: OrderStatus.ORDERED,
        totalAmount,
        comment: dto.comment,
        items: {
          create: dto.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            price: i.price,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });
    await this.audit.log({
      action: AuditAction.CREATE,
      entityType: 'Order',
      entityId: order.id,
      path: '/api/v1/orders',
      httpMethod: 'POST',
      metadata: {
        totalAmount: Number(order.totalAmount),
        itemCount: order.items.length,
      },
    });
    return order;
  }

  async findByUser(userId: string, page = 1, limit = 20) {
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { items: { include: { product: true } } },
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);
    return { items: orders, total, page, limit };
  }

  async findOne(userId: string, orderId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: { include: { product: { include: { images: true, brand: true } } } } },
    });
  }

  async findManyForAdmin(page = 1, limit = 20, q?: string) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const where: Prisma.OrderWhereInput | undefined = q
      ? {
          OR: [
            { id: { contains: q, mode: 'insensitive' } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            { user: { phone: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : undefined;
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          user: { select: { id: true, email: true, phone: true } },
          items: { include: { product: { select: { id: true, name: true, slug: true } } } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page: Math.max(page, 1), limit: take };
  }

  async findOneForAdmin(orderId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId },
      include: {
        user: { select: { id: true, email: true, phone: true } },
        items: { include: { product: { include: { images: true, brand: true } } } },
      },
    });
  }

  async updateStatus(orderId: string, status: OrderStatus, documentUrls?: Record<string, string>) {
    const prev = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!prev) throw new NotFoundException('Order not found');
    const order = await this.prisma.order.update({
      where: { id: orderId },
      data: { status, documentUrls: documentUrls ?? undefined },
      include: { items: { include: { product: true } } },
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'Order',
      entityId: orderId,
      path: `/api/v1/orders/admin/${orderId}/status`,
      httpMethod: 'PATCH',
      metadata: {
        from: prev.status,
        to: status,
        hasDocumentUrls: !!documentUrls && Object.keys(documentUrls).length > 0,
      },
    });
    return order;
  }
}
