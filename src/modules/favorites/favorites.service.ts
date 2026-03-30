import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private prisma: PrismaService) {}

  async findAll(userId: string) {
    return this.prisma.favorite.findMany({
      where: { userId },
      include: { product: { include: { images: true, brand: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async add(userId: string, productId: string) {
    return this.prisma.favorite.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
      include: { product: true },
    });
  }

  async remove(userId: string, productId: string) {
    return this.prisma.favorite.deleteMany({ where: { userId, productId } });
  }
}
