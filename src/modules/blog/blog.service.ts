import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BlogService {
  constructor(private prisma: PrismaService) {}

  async getCategories() {
    return this.prisma.blogCategory.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async getPosts(params: { categoryId?: string; page?: number; limit?: number }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 50);
    const where = params.categoryId ? { categoryId: params.categoryId, isPublished: true } : { isPublished: true };
    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { category: true, author: { select: { id: true } } },
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getPostBySlug(slug: string) {
    return this.prisma.blogPost.findFirst({
      where: { slug, isPublished: true },
      include: { category: true, author: { select: { id: true } } },
    });
  }
}
