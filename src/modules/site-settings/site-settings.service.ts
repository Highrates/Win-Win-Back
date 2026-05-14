import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type PublicSiteSettingsPayload = {
  heroImageUrls: string[];
  designerServiceOptions: string[];
  caseRoomTypeOptions: string[];
  /** Подписи статусов заказа (ключ — значение enum Prisma `OrderStatus`). */
  orderStatusLabels: Record<string, string>;
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

  private static parseCaseRoomTypes(raw: unknown): string[] {
    return Array.isArray(raw)
      ? raw
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter((x) => x.length > 0)
          .slice(0, 200)
      : [];
  }

  private static readonly orderStatusKeySet = new Set<string>(Object.values(OrderStatus));

  private static parseOrderStatusLabels(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = String(k).trim();
      if (!key || !SiteSettingsService.orderStatusKeySet.has(key)) continue;
      if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 120);
    }
    return out;
  }

  async getPublic(): Promise<PublicSiteSettingsPayload> {
    try {
      const row = await this.prisma.siteSettings.findUnique({ where: { id: 'site' } });
      return {
        heroImageUrls: SiteSettingsService.parseHeroUrlList(row?.heroImageUrls),
        designerServiceOptions: SiteSettingsService.parseDesignerServices(row?.designerServiceOptions),
        caseRoomTypeOptions: SiteSettingsService.parseCaseRoomTypes(row?.caseRoomTypeOptions),
        orderStatusLabels: SiteSettingsService.parseOrderStatusLabels(row?.orderStatusLabels),
      };
    } catch {
      // Если миграции ещё не применены (таблицы нет) — не валим витрину.
      return {
        heroImageUrls: [],
        designerServiceOptions: [],
        caseRoomTypeOptions: [],
        orderStatusLabels: {},
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
    orderStatusLabels?: Record<string, string>;
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

    const caseRoomTypeOptions =
      patch.caseRoomTypeOptions === undefined
        ? undefined
        : patch.caseRoomTypeOptions
            .map((x) => String(x ?? '').trim())
            .filter((x) => x.length > 0)
            .slice(0, 200);

    const orderStatusLabels =
      patch.orderStatusLabels === undefined
        ? undefined
        : SiteSettingsService.parseOrderStatusLabels(patch.orderStatusLabels);

    try {
      await this.prisma.siteSettings.upsert({
        where: { id: 'site' },
        create: {
          id: 'site',
          heroImageUrls: heroImageUrls ?? [],
          designerServiceOptions: designerServiceOptions !== undefined ? designerServiceOptions : [],
          caseRoomTypeOptions: caseRoomTypeOptions !== undefined ? caseRoomTypeOptions : [],
          orderStatusLabels: orderStatusLabels !== undefined ? orderStatusLabels : undefined,
        },
        update: {
          ...(heroImageUrls !== undefined ? { heroImageUrls } : {}),
          ...(designerServiceOptions !== undefined ? { designerServiceOptions } : {}),
          ...(caseRoomTypeOptions !== undefined ? { caseRoomTypeOptions } : {}),
          ...(orderStatusLabels !== undefined ? { orderStatusLabels } : {}),
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
