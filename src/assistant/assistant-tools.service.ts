import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CatalogAdminService } from '../modules/catalog/catalog-admin.service';
import { OrdersService } from '../modules/orders/orders.service';
import { ProductQaService } from '../modules/product-qa/product-qa.service';
import { SourcingRequestsService } from '../modules/sourcing-requests/sourcing-requests.service';
import { UsersService } from '../modules/users/users.service';
import { staffCanUseAssistantTool } from './assistant-tool-acl';
import type { GptToolDef } from './gptunnel.client';

export type AssistantToolAcl = {
  sections: readonly string[];
  isSuperAdmin: boolean;
  staffId: string;
  staffRole: UserRole;
};

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email?.trim()) return null;
  const [user, domain] = email.trim().split('@');
  if (!domain) return '***';
  const u = user.length <= 2 ? `${user[0] ?? '*'}*` : `${user.slice(0, 2)}***`;
  return `${u}@${domain}`;
}

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

function maskName(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  const t = name.trim();
  return `${t.slice(0, 1)}***`;
}

@Injectable()
export class AssistantToolsService {
  constructor(
    private readonly orders: OrdersService,
    private readonly catalogAdmin: CatalogAdminService,
    private readonly sourcing: SourcingRequestsService,
    private readonly users: UsersService,
    private readonly productQa: ProductQaService,
  ) {}

  listToolDefs(acl?: AssistantToolAcl): GptToolDef[] {
    const defs: GptToolDef[] = [
      {
        type: 'function',
        function: {
          name: 'get_orders_dashboard',
          description:
            'Сводка заказов для дашборда: новые (на согласовании), активные, завершённые, разбивка по каждому статусу.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_orders',
          description:
            'Список заказов админки (чтение). Фильтры: q (id/email/телефон), bucket (как в админке), page, limit (до 50). Персональные данные маскируются.',
          parameters: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Поиск' },
              bucket: {
                type: 'string',
                description: 'Корзина списка заказов (new | active | completed и т.п.)',
              },
              page: { type: 'integer', description: 'Страница, с 1' },
              limit: { type: 'integer', description: '1–50' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_sourcing_summary',
          description:
            'Заявки на подбор мебели (sourcing): pendingReview, inProgress, completed, cancelled.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_products',
          description:
            'Поиск товаров каталога по названию. visibility: all | catalog | hidden. Возвращает цену, активность, категорию.',
          parameters: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Строка поиска' },
              visibility: {
                type: 'string',
                enum: ['all', 'catalog', 'hidden'],
                description: 'По умолчанию all',
              },
              page: { type: 'integer' },
              limit: { type: 'integer', description: '1–50' },
            },
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_qa_pending_summary',
          description:
            'Очередь модерации Q&A: publicQaPending, correspondenceAwaitingPublish, топ товаров по pending (до 5).',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_signup_summary',
          description: 'Новые регистрации USER: за 7 и 30 дней, всего активных retail-пользователей.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_partner_applications_pending',
          description: 'Сколько заявок «Стать партнёром» ждут рассмотрения.',
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
      },
    ];
    if (!acl) return defs;
    return defs.filter((d) =>
      staffCanUseAssistantTool(d.function.name, acl.sections, acl.isSuperAdmin),
    );
  }

  async execute(
    name: string,
    argsJson: string,
    acl?: AssistantToolAcl,
  ): Promise<unknown> {
    if (
      acl &&
      !staffCanUseAssistantTool(name, acl.sections, acl.isSuperAdmin)
    ) {
      return { error: 'Нет доступа к этому инструменту' };
    }

    let args: Record<string, unknown> = {};
    try {
      args = argsJson?.trim() ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
    } catch {
      return { error: 'Некорректный JSON аргументов tool' };
    }

    try {
      return await this.executeKnown(name, args, acl);
    } catch (e) {
      if (e instanceof BadRequestException) {
        const res = e.getResponse();
        const msg =
          typeof res === 'string'
            ? res
            : Array.isArray((res as { message?: unknown }).message)
              ? ((res as { message: string[] }).message).join('; ')
              : String(
                  (res as { message?: unknown }).message ??
                    (e instanceof Error ? e.message : 'Некорректный запрос'),
                );
        return { error: msg };
      }
      throw e;
    }
  }

  private async executeKnown(
    name: string,
    args: Record<string, unknown>,
    acl?: AssistantToolAcl,
  ): Promise<unknown> {
    if (name === 'get_orders_dashboard') {
      const overview = await this.orders.getDashboardStatusSummaryForAdmin();
      return {
        ...overview,
        adminLinks: {
          dashboard: '/admin',
          orders: '/admin/orders',
        },
      };
    }

    if (name === 'list_orders') {
      const page = clampInt(args.page, 1, 1, 100);
      const limit = clampInt(args.limit, 20, 1, 50);
      const q = typeof args.q === 'string' ? args.q : undefined;
      const bucket = typeof args.bucket === 'string' ? args.bucket : undefined;
      const result = await this.orders.findManyForAdmin(
        page,
        limit,
        q,
        undefined,
        bucket,
        acl?.staffId,
      );
      return {
        total: result.total,
        page: result.page,
        limit: result.limit,
        adminLink: '/admin/orders',
        items: result.items.map((o) => ({
          id: o.id,
          status: o.status,
          totalAmount: o.totalAmount,
          currency: o.currency,
          createdAt: o.createdAt,
          unreadCustomerChatCount: o.unreadCustomerChatCount,
          hasChatMessages: o.hasChatMessages,
          email: maskEmail(o.user?.email),
          phone: maskPhone(o.user?.phone),
          customerName: maskName(o.customerName),
          adminLink: `/admin/orders/${o.id}`,
        })),
      };
    }

    if (name === 'get_sourcing_summary') {
      const summary = await this.sourcing.getDashboardStatusSummaryForAdmin();
      return {
        ...summary,
        adminLink: '/admin/orders/sourcing',
      };
    }

    if (name === 'search_products') {
      const page = clampInt(args.page, 1, 1, 100);
      const limit = clampInt(args.limit, 20, 1, 50);
      const q = typeof args.q === 'string' ? args.q : undefined;
      const visibilityRaw =
        typeof args.visibility === 'string' ? args.visibility.trim() : 'all';
      const visibility =
        visibilityRaw === 'catalog' || visibilityRaw === 'hidden'
          ? visibilityRaw
          : 'all';
      const result = await this.catalogAdmin.listProductsForAdmin(
        q,
        page,
        limit,
        visibility,
      );
      return {
        total: result.total,
        page: result.page,
        limit: result.limit,
        adminLink: '/admin/catalog/products',
        items: result.items.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          isActive: p.isActive,
          price: p.price,
          currency: p.currency,
          category: p.category?.name ?? p.categoryPath ?? null,
          adminLink: `/admin/catalog/products/${p.id}`,
        })),
      };
    }

    if (name === 'get_qa_pending_summary') {
      if (!acl?.staffId) {
        return { error: 'Нет контекста staff для Q&A' };
      }
      const summary = await this.productQa.getStaffQaPendingSummary(
        acl.staffId,
        acl.staffRole,
      );
      return {
        total: summary.total,
        publicQaPending: summary.publicQaPending,
        correspondenceAwaitingPublish: summary.correspondenceAwaitingPublish,
        topProducts: (summary.byProduct ?? []).slice(0, 5).map((p) => ({
          productId: p.productId,
          productName: p.productName,
          publicQaPending: p.publicQaPending,
          correspondenceAwaitingPublish: p.correspondenceAwaitingPublish,
          adminLink: `/admin/catalog/qa-queue?productId=${encodeURIComponent(p.productId)}`,
        })),
        adminLink: '/admin/catalog/qa-queue',
      };
    }

    if (name === 'get_signup_summary') {
      const summary = await this.users.getDashboardSignupSummaryForAdmin();
      return {
        ...summary,
        adminLink: '/admin/clients',
      };
    }

    if (name === 'get_partner_applications_pending') {
      const pending = await this.users.countPendingPartnerApplicationsForAdmin();
      return {
        ...pending,
        adminLink: '/admin/applications',
      };
    }

    return { error: `Неизвестный tool: ${name}` };
  }
}
