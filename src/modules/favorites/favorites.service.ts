import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string) {
    return this.prisma.favorite.findMany({
      where: { userId },
      include: {
        productVariant: {
          include: {
            product: { include: { images: { orderBy: { sortOrder: 'asc' } }, brand: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async add(userId: string, productVariantId: string) {
    const id = productVariantId?.trim();
    if (!id) throw new BadRequestException('productVariantId обязателен');
    const v = await this.prisma.productVariant.findFirst({
      where: { id, isActive: true, product: { isActive: true } },
      select: { id: true },
    });
    if (!v) throw new NotFoundException('Вариант не найден');
    return this.prisma.favorite.upsert({
      where: { userId_productVariantId: { userId, productVariantId: id } },
      create: { userId, productVariantId: id },
      update: {},
      include: {
        productVariant: {
          include: {
            product: { include: { images: { orderBy: { sortOrder: 'asc' } }, brand: true } },
          },
        },
      },
    });
  }

  async remove(userId: string, productVariantId: string) {
    const id = productVariantId?.trim();
    if (!id) throw new BadRequestException('productVariantId обязателен');
    return this.prisma.favorite.deleteMany({ where: { userId, productVariantId: id } });
  }
}
