import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: { items: { productId: string; quantity: number; price: number }[]; comment?: string }) {
    const totalAmount = dto.items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
    return this.prisma.order.create({
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

  async updateStatus(orderId: string, status: OrderStatus, documentUrls?: Record<string, string>) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status, documentUrls: documentUrls ?? undefined },
      include: { items: { include: { product: true } } },
    });
  }
}
