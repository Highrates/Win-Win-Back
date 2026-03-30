import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class CollectionsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: { title: string; description?: string }) {
    return this.prisma.collection.create({
      data: { userId, title: dto.title, description: dto.description },
      include: { items: { include: { product: true } } },
    });
  }

  async findByUser(userId: string) {
    return this.prisma.collection.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { items: { include: { product: true } } },
    });
  }

  async addProduct(collectionId: string, userId: string, productId: string) {
    const col = await this.prisma.collection.findFirst({ where: { id: collectionId, userId } });
    if (!col) return null;
    return this.prisma.collectionItem.create({
      data: { collectionId, productId },
      include: { product: true },
    });
  }

  async removeProduct(collectionId: string, userId: string, productId: string) {
    const col = await this.prisma.collection.findFirst({ where: { id: collectionId, userId } });
    if (!col) return null;
    return this.prisma.collectionItem.deleteMany({ where: { collectionId, productId } });
  }

  async createShareLink(collectionId: string, userId: string) {
    const col = await this.prisma.collection.findFirst({ where: { id: collectionId, userId } });
    if (!col) return null;
    const shareToken = randomBytes(24).toString('hex');
    await this.prisma.collection.update({
      where: { id: collectionId },
      data: { shareToken },
    });
    return { shareToken };
  }

  async getByShareToken(shareToken: string) {
    return this.prisma.collection.findUnique({
      where: { shareToken },
      include: { items: { include: { product: { include: { images: true } } }, orderBy: { sortOrder: 'asc' } } },
    });
  }
}
