import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PublicCollectionsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.publicCollection.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { items: true } } },
    });
  }

  async findBySlug(slug: string) {
    return this.prisma.publicCollection.findUnique({
      where: { slug, isActive: true },
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: { product: { include: { images: true, brand: true } } },
        },
      },
    });
  }
}
