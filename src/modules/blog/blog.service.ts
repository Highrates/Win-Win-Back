import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeBlogPostBodyHtml } from './blog-html.util';

/** После миграции с `sortOrder` обязательно: `cd backend && npx prisma generate`. */
const publicPostListSelect = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverUrl: true,
  publishedAt: true,
  sortOrder: true,
  category: { select: { id: true, slug: true, name: true } },
} as unknown as Prisma.BlogPostSelect;

const publicListOrderBy = [
  { sortOrder: 'asc' },
  { publishedAt: 'desc' },
  { createdAt: 'desc' },
] as unknown as Prisma.BlogPostOrderByWithRelationInput[];

@Injectable()
export class BlogService {
  constructor(private prisma: PrismaService) {}

  /** Только рубрики, в которых есть хотя бы одна опубликованная статья. */
  async getPublicCategories() {
    return this.prisma.blogCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      where: {
        posts: { some: { isPublished: true } },
      },
    });
  }

  async getPosts(params: {
    categoryId?: string;
    categorySlug?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 50);
    let categoryId = params.categoryId?.trim();
    if (!categoryId && params.categorySlug?.trim()) {
      const cat = await this.prisma.blogCategory.findFirst({
        where: { slug: params.categorySlug.trim() },
        select: { id: true },
      });
      categoryId = cat?.id;
    }
    const where = categoryId
      ? { categoryId, isPublished: true as const }
      : { isPublished: true as const };
    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: publicListOrderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: publicPostListSelect,
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getPostBySlug(slug: string) {
    const s = slug.trim();
    if (!s) return null;
    const row = await this.prisma.blogPost.findFirst({
      where: { slug: s, isPublished: true },
      include: { category: true, author: { select: { id: true } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      body: sanitizeBlogPostBodyHtml(row.body),
      coverUrl: row.coverUrl,
      publishedAt: row.publishedAt,
      category: row.category
        ? { id: row.category.id, slug: row.category.slug, name: row.category.name }
        : null,
      author: row.author,
    };
  }
}
