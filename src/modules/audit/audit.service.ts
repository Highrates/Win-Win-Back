import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getRequestContextStore } from '../../common/request-context/request-context.storage';
import { parseAdminMutationPath } from './admin-mutation-path';

export interface AuditLogInput {
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  httpMethod?: string | null;
  path: string;
  metadata?: Prisma.InputJsonValue;
  /** Для публичных маршрутов (логин), когда в ALS ещё нет JWT-пользователя */
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
}

/** Макс. длина path в БД (полный URL обычно короче). */
const MAX_PATH_CHARS = 768;
/** Любая строка внутри metadata после компактации. */
const MAX_META_STRING_CHARS = 180;
/** Потолок размера JSON metadata (UTF-16 приблизительно ≈ байты для латиницы). */
const MAX_METADATA_JSON_CHARS = 2400;
const PRUNE_INTERVAL_MS = 86_400_000;

function compactJsonValue(v: unknown, depth: number): unknown {
  if (depth > 8) return '…';
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') {
    return v.length > MAX_META_STRING_CHARS ? `${v.slice(0, MAX_META_STRING_CHARS)}…` : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) {
    const cap = 32;
    const slice = v.length > cap ? v.slice(0, cap) : v;
    const mapped = slice.map((x) => compactJsonValue(x, depth + 1));
    if (v.length > cap) (mapped as unknown[]).push(`…+${v.length - cap}`);
    return mapped;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    const out: Record<string, unknown> = {};
    const keyCap = 32;
    for (let i = 0; i < keys.length && i < keyCap; i++) {
      const k = keys[i];
      out[k] = compactJsonValue(o[k], depth + 1);
    }
    if (keys.length > keyCap) {
      out._moreKeys = keys.length - keyCap;
    }
    return out;
  }
  return String(v);
}

function compactMetadata(meta: Prisma.InputJsonValue | undefined): Prisma.InputJsonValue | undefined {
  if (meta === undefined) return undefined;
  try {
    const compacted = compactJsonValue(meta as unknown, 0) as Prisma.InputJsonValue;
    const s = JSON.stringify(compacted);
    if (s.length > MAX_METADATA_JSON_CHARS) {
      return {
        _truncated: true,
        approxChars: s.length,
      } as unknown as Prisma.InputJsonValue;
    }
    return compacted;
  } catch {
    return undefined;
  }
}

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private pruneTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const raw = this.config.get<string>('AUDIT_RETENTION_DAYS');
    const trimmed = raw === undefined || raw === null ? '' : String(raw).trim();
    let days: number;
    if (trimmed === '') {
      days = 90;
    } else {
      const parsed = parseInt(trimmed, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      days = parsed;
    }
    this.pruneTimer = setInterval(() => {
      void this.pruneOlderThanDays(days);
    }, PRUNE_INTERVAL_MS);
    void this.pruneOlderThanDays(days);
    this.logger.log(`Audit retention: pruning entries older than ${days}d`);
  }

  onModuleDestroy() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }

  /** ConfigService + process.env (на случай внешней подстановки env без перезагрузки конфига). */
  private resolveJournalPurgePassword(): string {
    const a = this.config.get<string | undefined>('AUDIT_JOURNAL_PURGE_PASSWORD');
    const b = process.env.AUDIT_JOURNAL_PURGE_PASSWORD;
    for (const v of [a, b]) {
      if (v !== undefined && v !== null) {
        const t = String(v).trim();
        if (t.length > 0) return t;
      }
    }
    return '';
  }

  /** Удаляет записи старше `days` дней. Возвращает число удалённых строк. */
  async pruneOlderThanDays(days: number): Promise<number> {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const res = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (res.count > 0) {
      this.logger.log(`Audit prune: removed ${res.count} row(s) older than ${days}d`);
    }
    return res.count;
  }

  async log(input: AuditLogInput): Promise<void> {
    const store = getRequestContextStore();
    const u = store?.currentUser;
    const storeUa = store?.userAgent ?? undefined;
    const uaOff = ['0', 'false', 'no', 'off'].includes(
      (this.config.get<string>('AUDIT_STORE_USER_AGENT') || '').toLowerCase(),
    );
    const meta = compactMetadata(input.metadata);
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          entityType: input.entityType ?? undefined,
          entityId: input.entityId ?? undefined,
          httpMethod: input.httpMethod ?? undefined,
          path: input.path.slice(0, MAX_PATH_CHARS),
          metadata: meta === undefined ? undefined : meta,
          actorUserId: input.actorUserId ?? u?.sub,
          actorEmail: input.actorEmail ?? u?.email ?? undefined,
          actorRole: input.actorRole ?? u?.role,
          ip: store?.ip ?? undefined,
          userAgent: uaOff ? undefined : storeUa,
        },
      });
    } catch (e) {
      this.logger.warn(`audit write failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** HTTP-мутации под `{module}/admin` (успех и ошибка). */
  async logAdminHttpMutation(params: {
    method: string;
    path: string;
    outcome: 'success' | 'failure';
    httpStatus?: number;
    errorMessage?: string;
  }): Promise<void> {
    const apiPrefix = this.config.get<string>('API_PREFIX', 'api/v1');
    const parsed = parseAdminMutationPath(params.path, apiPrefix);
    if (!parsed) return;

    const m = params.method.toUpperCase();
    let action: AuditAction = AuditAction.UPDATE;
    if (m === 'POST') action = AuditAction.CREATE;
    else if (m === 'DELETE') action = AuditAction.DELETE;
    else if (m === 'PATCH' || m === 'PUT') action = AuditAction.UPDATE;

    const meta: Record<string, unknown> = {
      outcome: params.outcome,
      module: parsed.module,
    };
    if (parsed.operation) meta.operation = parsed.operation;
    if (params.outcome === 'failure') {
      if (params.httpStatus !== undefined) meta.httpStatus = params.httpStatus;
      if (params.errorMessage) meta.error = params.errorMessage.slice(0, 240);
    }

    const label = await this.enrichEntityLabel(parsed.entityType, parsed.entityId);
    if (label?.name) meta.entityName = label.name;
    if (label?.slug) meta.entitySlug = label.slug;

    await this.log({
      action,
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      httpMethod: m,
      path: params.path,
      metadata: meta as Prisma.InputJsonValue,
    });
  }

  private async enrichEntityLabel(
    entityType: string,
    entityId?: string,
  ): Promise<{ name?: string; slug?: string } | undefined> {
    if (!entityId) return undefined;
    try {
      switch (entityType) {
        case 'Brand': {
          const r = await this.prisma.brand.findUnique({
            where: { id: entityId },
            select: { name: true, slug: true },
          });
          return r ? { name: r.name, slug: r.slug } : undefined;
        }
        case 'Category': {
          const r = await this.prisma.category.findUnique({
            where: { id: entityId },
            select: { name: true, slug: true },
          });
          return r ? { name: r.name, slug: r.slug } : undefined;
        }
        case 'Product': {
          const r = await this.prisma.product.findUnique({
            where: { id: entityId },
            select: { name: true, slug: true },
          });
          return r ? { name: r.name, slug: r.slug } : undefined;
        }
        case 'Order': {
          const r = await this.prisma.order.findUnique({
            where: { id: entityId },
            select: { status: true },
          });
          return r ? { name: `Заказ·${r.status}`, slug: entityId.slice(-8) } : undefined;
        }
        case 'MediaObject': {
          const r = await this.prisma.mediaObject.findUnique({
            where: { id: entityId },
            select: { originalName: true, storageKey: true },
          });
          return r ? { name: r.originalName, slug: r.storageKey.slice(-48) } : undefined;
        }
        case 'MediaFolder': {
          const r = await this.prisma.mediaFolder.findUnique({
            where: { id: entityId },
            select: { name: true, pathKey: true },
          });
          return r ? { name: r.name, slug: r.pathKey } : undefined;
        }
        case 'BlogPost': {
          const r = await this.prisma.blogPost.findUnique({
            where: { id: entityId },
            select: { title: true, slug: true },
          });
          return r ? { name: r.title, slug: r.slug } : undefined;
        }
        case 'BlogCategory': {
          const r = await this.prisma.blogCategory.findUnique({
            where: { id: entityId },
            select: { name: true, slug: true },
          });
          return r ? { name: r.name, slug: r.slug } : undefined;
        }
        case 'Page': {
          const r = await this.prisma.page.findUnique({
            where: { id: entityId },
            select: { title: true, slug: true },
          });
          return r ? { name: r.title, slug: r.slug } : undefined;
        }
        case 'Designer': {
          const r = await this.prisma.designer.findUnique({
            where: { id: entityId },
            select: { displayName: true, slug: true },
          });
          return r ? { name: r.displayName, slug: r.slug } : undefined;
        }
        case 'Collection': {
          const r = await this.prisma.collection.findUnique({
            where: { id: entityId },
            select: { title: true, id: true },
          });
          return r ? { name: r.title, slug: r.id.slice(-8) } : undefined;
        }
        case 'Referral': {
          const r = await this.prisma.referral.findUnique({
            where: { id: entityId },
            select: { level: true },
          });
          return r ? { name: `Реферал·ур.${r.level}`, slug: entityId.slice(-8) } : undefined;
        }
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }

  /**
   * Полная очистка журнала при верном пароле из AUDIT_JOURNAL_PURGE_PASSWORD.
   * @returns deleted count, либо причина отказа (без исключений — решает контроллер).
   */
  async purgeAllWithPassword(plain: string): Promise<
    { ok: true; deleted: number } | { ok: false; reason: 'not_configured' | 'invalid_password' }
  > {
    const expected = this.resolveJournalPurgePassword();
    if (!expected) return { ok: false, reason: 'not_configured' };
    const ha = createHash('sha256').update(plain, 'utf8').digest();
    const hb = createHash('sha256').update(expected, 'utf8').digest();
    if (ha.length !== hb.length || !timingSafeEqual(ha, hb)) {
      return { ok: false, reason: 'invalid_password' };
    }
    const res = await this.prisma.auditLog.deleteMany({});
    this.logger.warn(`Audit journal purged entirely: ${res.count} row(s) removed`);
    return { ok: true, deleted: res.count };
  }

  async listForAdmin(page = 1, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count(),
    ]);
    return { items, total, page: Math.max(page, 1), limit: take };
  }
}
