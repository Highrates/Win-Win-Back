import { PrismaService } from '../../prisma/prisma.service';

type WithProductId = { id: string };

/** Для публичных списков товаров: `likedByMe` только при авторизованном запросе. */
export async function enrichProductsWithLikedByMe<T extends WithProductId>(
  prisma: PrismaService,
  products: T[],
  userId?: string,
): Promise<(T & { likedByMe?: boolean })[]> {
  if (!userId || products.length === 0) return products;

  const ids = products.map((p) => p.id.trim()).filter(Boolean);
  const likedSet = new Set<string>();
  const chunkSize = 80;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = await prisma.productLike.findMany({
      where: { userId, productId: { in: chunk } },
      select: { productId: true },
    });
    for (const r of rows) likedSet.add(r.productId);
  }

  return products.map((p) => ({
    ...p,
    likedByMe: likedSet.has(p.id),
  }));
}
