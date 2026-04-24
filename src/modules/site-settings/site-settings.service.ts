import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type PublicSiteSettingsPayload = {
  heroImageUrls: string[];
  designerServiceOptions: string[];
};

@Injectable()
export class SiteSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private static parseHeroUrlList(raw: unknown): string[] {
    return Array.isArray(raw)
      ? raw
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .slice(0, 8)
      : [];
  }

  private static parseDesignerServices(raw: unknown): string[] {
    return Array.isArray(raw)
      ? raw
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter((x) => x.length > 0)
          .slice(0, 200)
      : [];
  }

  async getPublic(): Promise<PublicSiteSettingsPayload> {
    try {
      const row = await this.prisma.siteSettings.findUnique({ where: { id: 'site' } });
      return {
        heroImageUrls: SiteSettingsService.parseHeroUrlList(row?.heroImageUrls),
        designerServiceOptions: SiteSettingsService.parseDesignerServices(row?.designerServiceOptions),
      };
    } catch {
      // Если миграции ещё не применены (таблицы нет) — не валим витрину.
      return { heroImageUrls: [], designerServiceOptions: [] };
    }
  }

  async getAdmin(): Promise<PublicSiteSettingsPayload> {
    return this.getPublic();
  }

  async updateAdmin(patch: {
    heroImageUrls?: string[];
    designerServiceOptions?: string[];
  }): Promise<PublicSiteSettingsPayload> {
    const heroImageUrls =
      patch.heroImageUrls === undefined
        ? undefined
        : patch.heroImageUrls
            .map((x) => String(x ?? '').trim())
            .filter((x) => x.length > 0)
            .slice(0, 8);

    const designerServiceOptions =
      patch.designerServiceOptions === undefined
        ? undefined
        : patch.designerServiceOptions
            .map((x) => String(x ?? '').trim())
            .filter((x) => x.length > 0)
            .slice(0, 200);

    try {
      await this.prisma.siteSettings.upsert({
        where: { id: 'site' },
        create: {
          id: 'site',
          heroImageUrls: heroImageUrls ?? [],
          designerServiceOptions: designerServiceOptions !== undefined ? designerServiceOptions : [],
        },
        update: {
          ...(heroImageUrls !== undefined ? { heroImageUrls } : {}),
          ...(designerServiceOptions !== undefined ? { designerServiceOptions } : {}),
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
