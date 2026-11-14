import { Prisma } from '@prisma/client';

type LandingClient = {
  chinaToursLanding: {
    upsert: (args: {
      where: { id: string };
      create: { id: string };
      update: Record<string, never>;
    }) => Promise<{
      id: string;
      title: string;
      description: string;
      imageUrl: string | null;
      featuredTourIds: Prisma.JsonValue;
      updatedAt: Date;
    }>;
  };
};

/** Singleton лендинга /tours (id = "landing"). */
export function ensureChinaToursLanding(db: LandingClient) {
  return db.chinaToursLanding.upsert({
    where: { id: 'landing' },
    create: { id: 'landing' },
    update: {},
  });
}

export function parseFeaturedTourIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

type FeaturedPruneClient = {
  chinaToursLanding: {
    findUnique: (args: {
      where: { id: string };
      select: { featuredTourIds: true };
    }) => Promise<{ featuredTourIds: Prisma.JsonValue } | null>;
    update: (args: {
      where: { id: string };
      data: { featuredTourIds: string[] };
    }) => Promise<unknown>;
  };
};

/** Убирает tourId из JSON featuredTourIds (нет FK → иначе stale «фантомы» в админке). */
export async function pruneTourIdFromFeatured(db: FeaturedPruneClient, tourId: string) {
  const landing = await db.chinaToursLanding.findUnique({
    where: { id: 'landing' },
    select: { featuredTourIds: true },
  });
  if (!landing) return;
  const ids = parseFeaturedTourIds(landing.featuredTourIds);
  if (!ids.includes(tourId)) return;
  await db.chinaToursLanding.update({
    where: { id: 'landing' },
    data: { featuredTourIds: ids.filter((id) => id !== tourId) },
  });
}
