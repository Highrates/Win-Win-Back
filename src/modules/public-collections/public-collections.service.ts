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
    const row = await this.prisma.publicCollection.findUnique({
      where: { slug },
      include: {
        items: {
          where: { product: { isActive: true } },
          orderBy: { sortOrder: 'asc' },
          include: {
            product: {
              include: {
                brand: true,
                images: { orderBy: { sortOrder: 'asc' } },
                variants: {
                  where: { isActive: true },
                  orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
                  take: 1,
                  select: {
                    id: true,
                    variantLabel: true,
                    price: true,
                    currency: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!row || !row.isActive) return null;
    return row;
  }
}
