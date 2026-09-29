import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type PublicSiteSettingsPayload = {
  heroImageUrls: string[];
  designerServiceOptions: string[];
  caseRoomTypeOptions: string[];
  designerCityOptions: string[];
};

@Injectable()
export class SiteSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private static parseStringList(raw: unknown, max = 200): string[] {
    return Array.isArray(raw)
      ? raw
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter((x) => x.length > 0)
          .slice(0, max)
      : [];
  }

  private static parseHeroUrlList(raw: unknown): string[] {
    return Array.isArray(raw)
      ? raw
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .slice(0, 8)
      : [];
  }

  async getPublic(): Promise<PublicSiteSettingsPayload> {
    try {
      const row = await this.prisma.siteSettings.findUnique({ where: { id: 'site' } });
      return {
        heroImageUrls: SiteSettingsService.parseHeroUrlList(row?.heroImageUrls),
        designerServiceOptions: SiteSettingsService.parseStringList(row?.designerServiceOptions),
        caseRoomTypeOptions: SiteSettingsService.parseStringList(row?.caseRoomTypeOptions),
        designerCityOptions: SiteSettingsService.parseStringList(row?.designerCityOptions),
      };
    } catch {
      return {
        heroImageUrls: [],
        designerServiceOptions: [],
        caseRoomTypeOptions: [],
        designerCityOptions: [],
      };
    }
  }

  async getAdmin(): Promise<PublicSiteSettingsPayload> {
    return this.getPublic();
  }

  async updateAdmin(patch: {
    heroImageUrls?: string[];
    designerServiceOptions?: string[];
    caseRoomTypeOptions?: string[];
    designerCityOptions?: string[];
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
        : SiteSettingsService.parseStringList(patch.designerServiceOptions);

    const caseRoomTypeOptions =
      patch.caseRoomTypeOptions === undefined
        ? undefined
        : SiteSettingsService.parseStringList(patch.caseRoomTypeOptions);

    const designerCityOptions =
      patch.designerCityOptions === undefined
        ? undefined
        : SiteSettingsService.parseStringList(patch.designerCityOptions);

    try {
      await this.prisma.siteSettings.upsert({
        where: { id: 'site' },
        create: {
          id: 'site',
          heroImageUrls: heroImageUrls ?? [],
          designerServiceOptions: designerServiceOptions !== undefined ? designerServiceOptions : [],
          caseRoomTypeOptions: caseRoomTypeOptions !== undefined ? caseRoomTypeOptions : [],
          designerCityOptions: designerCityOptions !== undefined ? designerCityOptions : [],
        },
        update: {
          ...(heroImageUrls !== undefined ? { heroImageUrls } : {}),
          ...(designerServiceOptions !== undefined ? { designerServiceOptions } : {}),
          ...(caseRoomTypeOptions !== undefined ? { caseRoomTypeOptions } : {}),
          ...(designerCityOptions !== undefined ? { designerCityOptions } : {}),
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
