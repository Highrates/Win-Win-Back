import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type PublicSiteSettingsPayload = {
  heroImageUrls: string[];
};

@Injectable()
export class SiteSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublic(): Promise<PublicSiteSettingsPayload> {
    try {
      const row = await this.prisma.siteSettings.findUnique({ where: { id: 'site' } });
      const urlsRaw = row?.heroImageUrls;
      const heroImageUrls = Array.isArray(urlsRaw)
        ? urlsRaw
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .slice(0, 8)
        : [];
      return { heroImageUrls };
    } catch {
      // Если миграции ещё не применены (таблицы нет) — не валим витрину.
      return { heroImageUrls: [] };
    }
  }

  async getAdmin(): Promise<PublicSiteSettingsPayload> {
    return this.getPublic();
  }

  async updateAdmin(patch: { heroImageUrls?: string[] }): Promise<PublicSiteSettingsPayload> {
    const heroImageUrls =
      patch.heroImageUrls === undefined
        ? undefined
        : patch.heroImageUrls
            .map((x) => String(x ?? '').trim())
            .filter((x) => x.length > 0)
            .slice(0, 8);

    try {
      await this.prisma.siteSettings.upsert({
        where: { id: 'site' },
        create: {
          id: 'site',
          heroImageUrls: heroImageUrls ?? [],
        },
        update: {
          ...(heroImageUrls !== undefined ? { heroImageUrls } : {}),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка записи в БД';
      throw new InternalServerErrorException(
        `Не удалось сохранить настройки (возможно, не применены миграции): ${msg}`,
      );
    }

    return this.getAdmin();
  }
}

