import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

function formatRub(value: number): string {
  return `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} р.`;
}

export function normalizeSearchText(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, 'е');
}

export function searchForms(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const deyo = trimmed.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  return deyo === trimmed ? [trimmed] : [trimmed, deyo];
}

export function scoreTitleMatch(title: string, q: string): number {
  const t = normalizeSearchText(title);
  const nq = normalizeSearchText(q);
  if (!nq || !t) return 0;
  if (t === nq) return 100;
  if (t.startsWith(nq)) return 80;
  const tokens = nq.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((tok) => t.includes(tok))) return 55;
  if (t.includes(nq)) return 40;
  return 10;
}

function containsInsensitive(form: string): Prisma.StringFilter {
  return { contains: form, mode: 'insensitive' };
}

function nameMatchesAnyForm(forms: string[]): Array<{ name: Prisma.StringFilter }> {
  return forms.map((f) => ({ name: containsInsensitive(f) }));
}

export type SearchHit = {
  id: string;
  title: string;
  href: string;
  subtitle?: string | null;
  imageUrl?: string | null;
};

export type SearchGroupKey =
  | 'category'
  | 'product'
  | 'brand'
  | 'tag'
  | 'collection'
  | 'blog';

export type SearchGroup = {
  key: SearchGroupKey;
  label: string;
  items: SearchHit[];
  total: number;
  hasMore: boolean;
};

export type SearchMode = 'overlay' | 'full';

const LIMITS = {
  overlay: {
    product: { take: 24, limit: 10 },
    category: { take: 16, limit: 8 },
    brand: { take: 16, limit: 6 },
    tag: { take: 12, limit: 6 },
    collection: { take: 12, limit: 6 },
    blog: { take: 16, limit: 8 },
  },
  full: {
    product: { take: 80, limit: 48 },
    category: { take: 48, limit: 32 },
    brand: { take: 48, limit: 32 },
    tag: { take: 32, limit: 24 },
    collection: { take: 32, limit: 24 },
    blog: { take: 48, limit: 32 },
  },
} as const;

@Injectable()
export class SearchPublicService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    qRaw: string,
    mode: SearchMode = 'overlay',
  ): Promise<{ q: string; mode: SearchMode; groups: SearchGroup[] }> {
    const q = qRaw.trim().slice(0, 80);
    const forms = searchForms(q);
    if (q.length < 2 || forms.length === 0) {
      return { q, mode, groups: [] };
    }

    const lim = LIMITS[mode] ?? LIMITS.overlay;

    const hasActiveProducts: Prisma.CategoryWhereInput = {
      OR: [
        { primaryProducts: { some: { isActive: true } } },
        {
          children: {
            some: { primaryProducts: { some: { isActive: true } } },
          },
        },
      ],
    };

    const productOr: Prisma.ProductWhereInput[] = [];
    for (const f of forms) {
      const c = containsInsensitive(f);
      productOr.push(
        { name: c },
        { slug: c },
        { shortDescription: c },
        {
          variants: {
            some: {
              OR: [{ sku: c }, { variantLabel: c }],
            },
          },
        },
      );
    }

    const brandWhere: Prisma.BrandWhereInput = {
      isActive: true,
      OR: forms.flatMap((f) => {
        const c = containsInsensitive(f);
        return [{ name: c }, { slug: c }, { shortDescription: c }];
      }),
    };

    const categoryWhere: Prisma.CategoryWhereInput = {
      isActive: true,
      AND: [{ OR: nameMatchesAnyForm(forms) }, hasActiveProducts],
    };

    const productWhere: Prisma.ProductWhereInput = {
      isActive: true,
      OR: productOr,
    };

    const tagWhere: Prisma.CatalogTagWhereInput = {
      AND: [
        { OR: nameMatchesAnyForm(forms) },
        {
          products: {
            some: { product: { isActive: true } },
          },
        },
      ],
    };

    const collectionWhere: Prisma.CuratedCollectionWhereInput = {
      isActive: true,
      kind: 'PRODUCT',
      OR: forms.flatMap((f) => {
        const c = containsInsensitive(f);
        return [{ name: c }, { slug: c }];
      }),
    };

    const blogWhere: Prisma.BlogPostWhereInput = {
      isPublished: true,
      OR: [{ publishedAt: null }, { publishedAt: { lte: new Date() } }],
      AND: [
        {
          OR: forms.flatMap((f) => {
            const c = containsInsensitive(f);
            return [{ title: c }, { excerpt: c }];
          }),
        },
      ],
    };

    const [
      categoryTotal,
      categories,
      productTotal,
      products,
      brandTotal,
      brands,
      tagTotal,
      tags,
      collectionTotal,
      collections,
      blogTotal,
      posts,
    ] = await Promise.all([
      this.prisma.category.count({ where: categoryWhere }),
      this.prisma.category.findMany({
        where: categoryWhere,
        take: lim.category.take,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          parent: { select: { slug: true, name: true } },
        },
      }),
      this.prisma.product.count({ where: productWhere }),
      this.prisma.product.findMany({
        where: productWhere,
        take: lim.product.take,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          slug: true,
          images: {
            take: 1,
            orderBy: { sortOrder: 'asc' },
            select: { url: true },
          },
          variants: {
            where: { isActive: true },
            select: { price: true },
            orderBy: { price: 'asc' },
            take: 20,
          },
        },
      }),
      this.prisma.brand.count({ where: brandWhere }),
      this.prisma.brand.findMany({
        where: brandWhere,
        take: lim.brand.take,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          shortDescription: true,
          logoUrl: true,
          coverImageUrl: true,
        },
      }),
      this.prisma.catalogTag.count({ where: tagWhere }),
      this.prisma.catalogTag.findMany({
        where: tagWhere,
        take: lim.tag.take,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          coverImageUrl: true,
        },
      }),
      this.prisma.curatedCollection.count({ where: collectionWhere }),
      this.prisma.curatedCollection.findMany({
        where: collectionWhere,
        take: lim.collection.take,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          coverImageUrl: true,
        },
      }),
      this.prisma.blogPost.count({ where: blogWhere }),
      this.prisma.blogPost.findMany({
        where: blogWhere,
        take: lim.blog.take,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          coverUrl: true,
          category: { select: { name: true } },
        },
      }),
    ]);

    const groups: SearchGroup[] = [];

    const rankedCategories = [...categories]
      .sort((a, b) => scoreTitleMatch(b.name, q) - scoreTitleMatch(a.name, q))
      .slice(0, lim.category.limit);
    if (rankedCategories.length) {
      groups.push({
        key: 'category',
        label: 'Каталог',
        total: categoryTotal,
        hasMore: categoryTotal > rankedCategories.length,
        items: rankedCategories.map((c) => ({
          id: c.id,
          title: c.name,
          href: `/catalog/${encodeURIComponent(c.slug)}`,
          subtitle: c.parent?.name ?? null,
        })),
      });
    }

    const rankedProducts = [...products]
      .sort((a, b) => scoreTitleMatch(b.name, q) - scoreTitleMatch(a.name, q))
      .slice(0, lim.product.limit);
    if (rankedProducts.length) {
      groups.push({
        key: 'product',
        label: 'Товары',
        total: productTotal,
        hasMore: productTotal > rankedProducts.length,
        items: rankedProducts.map((p) => {
          const prices = p.variants
            .map((v) => Number(v.price))
            .filter((n) => Number.isFinite(n) && n > 0);
          const min = prices.length ? Math.min(...prices) : null;
          const max = prices.length ? Math.max(...prices) : null;
          let subtitle: string | null = null;
          if (min != null) {
            const formatted = formatRub(min);
            subtitle = max != null && max > min ? `от ${formatted}` : formatted;
          }
          return {
            id: p.id,
            title: p.name,
            href: `/product/${encodeURIComponent(p.slug)}`,
            subtitle,
            imageUrl: p.images[0]?.url ?? null,
          };
        }),
      });
    }

    const rankedBrands = [...brands]
      .sort((a, b) => scoreTitleMatch(b.name, q) - scoreTitleMatch(a.name, q))
      .slice(0, lim.brand.limit);
    if (rankedBrands.length) {
      groups.push({
        key: 'brand',
        label: 'Бренды',
        total: brandTotal,
        hasMore: brandTotal > rankedBrands.length,
        items: rankedBrands.map((b) => ({
          id: b.id,
          title: b.name,
          href: `/brands/${encodeURIComponent(b.slug)}`,
          subtitle: b.shortDescription ?? null,
          imageUrl: b.logoUrl ?? b.coverImageUrl ?? null,
        })),
      });
    }

    const rankedTags = [...tags]
      .sort((a, b) => scoreTitleMatch(b.name, q) - scoreTitleMatch(a.name, q))
      .slice(0, lim.tag.limit);
    if (rankedTags.length) {
      groups.push({
        key: 'tag',
        label: 'Зоны',
        total: tagTotal,
        hasMore: tagTotal > rankedTags.length,
        items: rankedTags.map((t) => ({
          id: t.id,
          title: t.name,
          href: `/catalog?tag=${encodeURIComponent(t.slug)}`,
          imageUrl: t.coverImageUrl,
        })),
      });
    }

    const rankedCollections = [...collections]
      .sort((a, b) => scoreTitleMatch(b.name, q) - scoreTitleMatch(a.name, q))
      .slice(0, lim.collection.limit);
    if (rankedCollections.length) {
      groups.push({
        key: 'collection',
        label: 'Коллекции',
        total: collectionTotal,
        hasMore: collectionTotal > rankedCollections.length,
        items: rankedCollections.map((c) => ({
          id: c.id,
          title: c.name,
          href: `/collections/${encodeURIComponent(c.slug)}`,
          subtitle: c.description,
          imageUrl: c.coverImageUrl,
        })),
      });
    }

    const rankedPosts = [...posts]
      .sort((a, b) => scoreTitleMatch(b.title, q) - scoreTitleMatch(a.title, q))
      .slice(0, lim.blog.limit);
    if (rankedPosts.length) {
      groups.push({
        key: 'blog',
        label: 'Блог',
        total: blogTotal,
        hasMore: blogTotal > rankedPosts.length,
        items: rankedPosts.map((p) => ({
          id: p.id,
          title: p.title,
          href: `/blog/${encodeURIComponent(p.slug)}`,
          subtitle: p.category?.name ?? p.excerpt ?? null,
          imageUrl: p.coverUrl,
        })),
      });
    }

    return { q, mode, groups };
  }
}
