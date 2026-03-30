import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MeilisearchService, PRODUCTS_INDEX } from '../../meilisearch/meilisearch.service';

/** Публичное дерево каталога: только корни и их прямые дети (без дублирования плоского списка). */
export type PublicCategoryTreeChild = {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  backgroundImageUrl: string | null;
};

export type PublicCategoryTreeRoot = PublicCategoryTreeChild & {
  children: PublicCategoryTreeChild[];
};

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

  /** Корни для меню: только slug, name, sortOrder. */
  async getCategoryRootsNav() {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { slug: true, name: true, sortOrder: true },
    });
    return { items: rows };
  }

  /**
   * Дерево для витрины: активные корни и их активные дети (один объект на узел, без плоского дублирования).
   */
  async getCategoryTree(): Promise<{ roots: PublicCategoryTreeRoot[] }> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        children: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            slug: true,
            name: true,
            sortOrder: true,
            backgroundImageUrl: true,
          },
        },
      },
    });
    const roots: PublicCategoryTreeRoot[] = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      sortOrder: r.sortOrder,
      backgroundImageUrl: r.backgroundImageUrl,
      children: r.children.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        sortOrder: c.sortOrder,
        backgroundImageUrl: c.backgroundImageUrl,
      })),
    }));
    return { roots };
  }

  /** Дети активного корня по slug родителя (для ленивой подгрузки / API). */
  async getCategoryChildrenByParentSlug(parentSlug: string) {
    const parentRow = await this.prisma.category.findFirst({
      where: { slug: parentSlug, isActive: true, parentId: null },
      select: { id: true, slug: true, name: true },
    });
    if (!parentRow) throw new NotFoundException('Parent category not found');
    const children = await this.prisma.category.findMany({
      where: { isActive: true, parentId: parentRow.id },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        sortOrder: true,
        backgroundImageUrl: true,
      },
    });
    return {
      parent: { slug: parentRow.slug, name: parentRow.name },
      children,
    };
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
    return {
      hits: result.hits,
      total: result.estimatedTotalHits ?? result.hits.length,
      page,
      limit,
    };
  }
}
