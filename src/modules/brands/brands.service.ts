import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BrandsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.brand.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async findBySlug(slug: string) {
    return this.prisma.brand.findUnique({
      where: { slug, isActive: true },
      include: { products: { where: { isActive: true }, include: { images: true } } },
    });
  }
}
