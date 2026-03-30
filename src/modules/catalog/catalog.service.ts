import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MeilisearchService, PRODUCTS_INDEX } from '../../meilisearch/meilisearch.service';

@Injectable()
export class CatalogService {
  constructor(
    private prisma: PrismaService,
    private meilisearch: MeilisearchService,
  ) {}

  async getCategories() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { products: true } }, children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
  }

  async getCategoryBySlug(slug: string) {
    return this.prisma.category.findUnique({
      where: { slug, isActive: true },
      include: {
        parent: true,
        children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        _count: { select: { products: true } },
      },
    });
  }

  async getProductBySlug(slug: string) {
    return this.prisma.product.findUnique({
      where: { slug, isActive: true },
      include: {
        category: true,
        brand: true,
        images: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  async searchProducts(params: {
    q?: string;
    categoryId?: string;
    brandId?: string;
    page?: number;
    limit?: number;
  }) {
    const index = this.meilisearch.getIndex(PRODUCTS_INDEX);
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 20, 100);
    const filters: string[] = [];
    if (params.categoryId) filters.push(`categoryId = "${params.categoryId}"`);
    if (params.brandId) filters.push(`brandId = "${params.brandId}"`);
    const filter = filters.length ? filters.join(' AND ') : undefined;
    const result = await index.search(params.q ?? '', { filter, limit, offset: (page - 1) * limit });
    return { hits: result.hits, total: result.estimatedTotal ?? result.hits.length, page, limit };
  }
}
