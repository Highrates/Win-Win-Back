import { Injectable, NotFoundException } from '@nestjs/common';
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
    const row = await this.prisma.brand.findUnique({
      where: { slug, isActive: true },
      include: {
        products: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
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
    });
    if (!row) throw new NotFoundException('Brand not found');

    const { products: rawProducts, ...brandRest } = row;
    const products = rawProducts.map((p) => {
      const dv = p.variants[0];
      /** Как в каталоге (Meilisearch): общая галерея товара, не снимки варианта. */
      const images = p.images.map((im, i) => ({ url: im.url, sortOrder: i }));
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        displayName: dv?.variantLabel?.trim() || p.name,
        variantId: dv?.id ?? null,
        price: dv?.price ?? null,
        currency: dv?.currency ?? 'RUB',
        images,
      };
    });

    return { ...brandRest, products };
  }
}
