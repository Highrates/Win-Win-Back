import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DesignersService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, limit = 20) {
    const [items, total] = await Promise.all([
      this.prisma.designer.findMany({
        where: { isPublic: true },
        orderBy: { sortOrder: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, email: true } } },
      }),
      this.prisma.designer.count({ where: { isPublic: true } }),
    ]);
    return { items, total, page, limit };
  }

  async findBySlug(slug: string) {
    return this.prisma.designer.findUnique({
      where: { slug, isPublic: true },
      include: { user: { select: { id: true, email: true } } },
    });
  }
}
