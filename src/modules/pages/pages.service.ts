import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PageType } from '@prisma/client';

@Injectable()
export class PagesService {
  constructor(private prisma: PrismaService) {}

  async findBySlug(slug: string) {
    return this.prisma.page.findFirst({
      where: { slug, isPublished: true },
    });
  }

  async findByType(type: PageType) {
    return this.prisma.page.findFirst({
      where: { type, isPublished: true },
    });
  }

  async findAllForAdmin() {
    return this.prisma.page.findMany({
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }],
    });
  }
}
