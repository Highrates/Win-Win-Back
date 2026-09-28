import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ORDER_DOCUMENT_LABELS, orderDocumentFilename, orderDocumentTitle } from '../orders/order-document-labels';
import { ObjectStorageService } from '../storage/object-storage.service';
import { fileExtension, filenameFromUrl, isInlineStoredFile } from '../storage/stored-file';
import { foldSearch } from './document-fields';

export { isNonMediaDocument } from './document-fields';

export type AccountDocumentSource =
  | 'ORDER_CHAT'
  | 'ORDER_DOCUMENT'
  | 'SOURCING_CHAT'
  | 'SOURCING_REQUEST';

export type AccountDocumentOut = {
  /** Непрозрачный id для скачивания: `chat:…`, `sourcing:…`, `order-doc:…`. */
  id: string;
  title: string;
  mimeType: string | null;
  /** Расширение файла в нижнем регистре без точки (pdf, xlsx…), если известно. */
  ext: string | null;
  /** Файл вне нашего хранилища: скачивание ведёт редиректом на внешний адрес. */
  external: boolean;
  /** Откроется в браузере (PDF, текст); иначе скачается — как `Content-Disposition` в GET /files/:ref. */
  inline: boolean;
  createdAt: string;
  source: AccountDocumentSource;
  /** id заказа или заявки на подбор. */
  sourceId: string;
  /** Текущий статус заказа / заявки — по нему ЛК выбирает вкладку для deep-link. */
  sourceStatus: string | null;
  /** Для чатов: кто прислал файл. */
  uploadedBy: 'CUSTOMER' | 'STAFF' | null;
};

export type AccountDocumentsFilter = 'all' | 'orders' | 'sourcing' | 'mine';

export type AccountDocumentsQuery = {
  limit?: number;
  cursor?: string | null;
  filter?: AccountDocumentsFilter;
  q?: string | null;
  /** Только документы одной группы (`order:<id>` / `sourcing:<id>`) — догрузка группы в виде «По заказам». */
  group?: string | null;
};

export type AccountDocumentsPage = {
  items: AccountDocumentOut[];
  /** Курсор следующей страницы; null — больше нет. */
  nextCursor: string | null;
};

export type AccountDocumentGroupOut = {
  /** `order:<id>` / `sourcing:<id>`. */
  key: string;
  source: 'ORDER' | 'SOURCING';
  sourceId: string;
  sourceStatus: string | null;
  /** Сколько документов в группе всего (с учётом фильтра и поиска). */
  total: number;
  latestAt: string;
  /** Первые документы группы (дата ↓). */
  items: AccountDocumentOut[];
  /** Курсор для остальных документов группы (список с `group=key`); null — показаны все. */
  nextCursor: string | null;
};

export type AccountDocumentGroupsQuery = {
  limit?: number;
  itemsPerGroup?: number;
  cursor?: string | null;
  filter?: AccountDocumentsFilter;
  q?: string | null;
};

export type AccountDocumentGroupsPage = {
  groups: AccountDocumentGroupOut[];
  nextCursor: string | null;
};

export const ACCOUNT_DOCUMENTS_DEFAULT_LIMIT = 50;
export const ACCOUNT_DOCUMENTS_MAX_LIMIT = 100;
export const ACCOUNT_DOCUMENT_GROUPS_DEFAULT_LIMIT = 20;
export const ACCOUNT_DOCUMENT_GROUPS_MAX_LIMIT = 50;
export const ACCOUNT_DOCUMENT_GROUP_ITEMS_DEFAULT = 5;
export const ACCOUNT_DOCUMENT_GROUP_ITEMS_MAX = 20;

const GROUP_KEY = /^(order|sourcing):[A-Za-z0-9_-]{1,64}$/;

const CYR_UPPER = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
const CYR_LOWER = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';

/** `foldSearch` в SQL: кириллица в нижний регистр явно (lower() зависит от LC_CTYPE), ё → е. */
function foldSql(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`translate(lower(translate(${expr}, ${CYR_UPPER}::text, ${CYR_LOWER}::text)), 'ё', 'е')`;
}

function likeContains(needle: string): string {
  return `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function clampInt(raw: number | undefined, def: number, max: number): number {
  return Math.min(Math.max(Math.trunc(raw ?? def) || def, 1), max);
}

type DocCursor = { t: Date; id: string };
type GroupCursor = { t: Date; k: string };

function encodeCursor(value: { t: string; id?: string; k?: string }): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursorJson(raw: string): { t: Date; id?: unknown; k?: unknown } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>;
    const t = typeof parsed.t === 'string' ? new Date(parsed.t) : null;
    if (!t || Number.isNaN(t.getTime())) throw new Error('bad cursor');
    return { t, id: parsed.id, k: parsed.k };
  } catch {
    throw new BadRequestException('Некорректный курсор');
  }
}

function decodeDocCursor(raw: string | null | undefined): DocCursor | null {
  if (!raw) return null;
  const { t, id } = decodeCursorJson(raw);
  if (typeof id !== 'string' || !id.includes(':')) throw new BadRequestException('Некорректный курсор');
  return { t, id };
}

function decodeGroupCursor(raw: string | null | undefined): GroupCursor | null {
  if (!raw) return null;
  const { t, k } = decodeCursorJson(raw);
  if (typeof k !== 'string' || !GROUP_KEY.test(k)) throw new BadRequestException('Некорректный курсор');
  return { t, k };
}

/** Строка `visible` из SQL: URL и служебные поля наружу не отдаются. */
type DocRow = {
  id: string;
  url: string;
  title: string | null;
  mimeType: string | null;
  at: Date;
  source: AccountDocumentSource;
  sourceId: string;
  sourceStatus: string | null;
  uploadedBy: 'CUSTOMER' | 'STAFF' | null;
  kind: string | null;
  groupKey: string;
};

type GroupRow = Partial<DocRow> & {
  pageGroupKey: string;
  latestAt: Date;
  total: number;
  groupPos: number;
};

@Injectable()
export class AccountDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  /** Лента документов (дата ↓, id ↓) — один запрос, дубли по URL отсечены до LIMIT. */
  async listForCustomer(userId: string, query: AccountDocumentsQuery = {}): Promise<AccountDocumentsPage> {
    const limit = clampInt(query.limit, ACCOUNT_DOCUMENTS_DEFAULT_LIMIT, ACCOUNT_DOCUMENTS_MAX_LIMIT);
    const cursor = decodeDocCursor(query.cursor);
    const group = query.group?.trim() || null;
    if (group && !GROUP_KEY.test(group)) throw new BadRequestException('Некорректная группа');

    const rows = await this.prisma.$queryRaw<DocRow[]>`
      ${this.visibleCte(userId, query.filter ?? 'all', query.q)}
      SELECT * FROM visible
      WHERE TRUE
        ${group ? Prisma.sql`AND "groupKey" = ${group}` : Prisma.empty}
        ${cursor ? Prisma.sql`AND ("at" < ${cursor.t.toISOString()}::timestamp OR ("at" = ${cursor.t.toISOString()}::timestamp AND "id" COLLATE "C" < ${cursor.id}))` : Prisma.empty}
      ORDER BY "at" DESC, "id" COLLATE "C" DESC
      LIMIT ${limit + 1}
    `;

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.toOut(r)),
      nextCursor: rows.length > limit && last ? encodeCursor({ t: last.at.toISOString(), id: last.id }) : null,
    };
  }

  /**
   * Вид «По заказам»: группы (заказ / заявка) по самому свежему документу, в каждой — первые документы и total.
   * Один запрос; остальные документы группы — `listForCustomer` с `group`.
   */
  async listGroupsForCustomer(
    userId: string,
    query: AccountDocumentGroupsQuery = {},
  ): Promise<AccountDocumentGroupsPage> {
    const limit = clampInt(query.limit, ACCOUNT_DOCUMENT_GROUPS_DEFAULT_LIMIT, ACCOUNT_DOCUMENT_GROUPS_MAX_LIMIT);
    const perGroup = clampInt(query.itemsPerGroup, ACCOUNT_DOCUMENT_GROUP_ITEMS_DEFAULT, ACCOUNT_DOCUMENT_GROUP_ITEMS_MAX);
    const cursor = decodeGroupCursor(query.cursor);

    const rows = await this.prisma.$queryRaw<GroupRow[]>`
      ${this.visibleCte(userId, query.filter ?? 'all', query.q)},
      groups AS (
        SELECT "groupKey", max("at") AS "latestAt", count(*)::int AS "total"
        FROM visible
        GROUP BY "groupKey"
      ),
      page AS (
        SELECT g.*, (row_number() OVER (ORDER BY "latestAt" DESC, "groupKey" COLLATE "C" DESC))::int AS "groupPos"
        FROM groups g
        WHERE TRUE
          ${cursor ? Prisma.sql`AND ("latestAt" < ${cursor.t.toISOString()}::timestamp OR ("latestAt" = ${cursor.t.toISOString()}::timestamp AND "groupKey" COLLATE "C" < ${cursor.k}))` : Prisma.empty}
        ORDER BY "latestAt" DESC, "groupKey" COLLATE "C" DESC
        LIMIT ${limit + 1}
      ),
      ranked AS (
        SELECT v.*, (row_number() OVER (PARTITION BY v."groupKey" ORDER BY v."at" DESC, v."id" COLLATE "C" DESC))::int AS "itemPos"
        FROM visible v
        JOIN page p ON p."groupKey" = v."groupKey" AND p."groupPos" <= ${limit}
      )
      SELECT p."groupKey" AS "pageGroupKey", p."latestAt", p."total", p."groupPos", r.*
      FROM page p
      LEFT JOIN ranked r ON r."groupKey" = p."groupKey" AND r."itemPos" <= ${perGroup}
      ORDER BY p."groupPos", r."itemPos"
    `;

    const groups: AccountDocumentGroupOut[] = [];
    let hasMore = false;
    for (const row of rows) {
      if (row.groupPos > limit) {
        hasMore = true;
        continue;
      }
      let group = groups[groups.length - 1];
      if (!group || group.key !== row.pageGroupKey) {
        const sep = row.pageGroupKey.indexOf(':');
        group = {
          key: row.pageGroupKey,
          source: row.pageGroupKey.slice(0, sep) === 'order' ? 'ORDER' : 'SOURCING',
          sourceId: row.pageGroupKey.slice(sep + 1),
          sourceStatus: row.sourceStatus ?? null,
          total: row.total,
          latestAt: row.latestAt.toISOString(),
          items: [],
          nextCursor: null,
        };
        groups.push(group);
      }
      if (row.id) group.items.push(this.toOut(row as DocRow));
    }
    for (const group of groups) {
      const last = group.items[group.items.length - 1];
      if (last && group.total > group.items.length) {
        group.nextCursor = encodeCursor({ t: last.createdAt, id: last.id });
      }
    }

    const lastGroup = groups[groups.length - 1];
    return {
      groups,
      nextCursor: hasMore && lastGroup ? encodeCursor({ t: lastGroup.latestAt, k: lastGroup.key }) : null,
    };
  }

  /**
   * CTE `visible`: документы покупателя из трёх источников в рамках фильтра и поиска,
   * по одному экземпляру на URL (документ заказа → вложение заявки → чат, затем самый ранний).
   * Дубли отсекаются по всей выборке, поэтому страницы полные и дубль не всплывает на соседней.
   */
  private visibleCte(userId: string, filter: AccountDocumentsFilter, rawQ: string | null | undefined): Prisma.Sql {
    const q = foldSearch(rawQ?.trim().slice(0, 100) ?? '');
    const pattern = q ? likeContains(q) : null;
    const chatKinds = [
      ...(filter === 'all' || filter === 'orders' || filter === 'mine' ? ['ORDER'] : []),
      ...(filter === 'all' || filter === 'sourcing' || filter === 'mine' ? ['SOURCING'] : []),
    ];
    const wantSourcingRequest = filter === 'all' || filter === 'sourcing' || filter === 'mine';
    const wantOrderDocs = filter === 'all' || filter === 'orders';

    const parts: Prisma.Sql[] = [];
    if (chatKinds.length) {
      parts.push(Prisma.sql`
        SELECT 'chat:' || a."id" AS "id", btrim(a."fileUrl") AS "url", a."filename" AS "title",
          a."mimeType" AS "mimeType", a."createdAt" AS "at",
          CASE WHEN c."kind" = 'ORDER' THEN 'ORDER_CHAT' ELSE 'SOURCING_CHAT' END AS "source",
          COALESCE(c."orderId", c."sourcingRequestId") AS "sourceId",
          COALESCE(o."status"::text, sr."status"::text) AS "sourceStatus",
          m."authorRole"::text AS "uploadedBy", NULL::text AS "kind", 2 AS "prio"
        FROM "ChatAttachment" a
        JOIN "ChatMessage" m ON m."id" = a."messageId"
        JOIN "ChatConversation" c ON c."id" = m."conversationId"
        LEFT JOIN "Order" o ON o."id" = c."orderId"
        LEFT JOIN "SourcingRequest" sr ON sr."id" = c."sourcingRequestId"
        WHERE a."ownerUserId" = ${userId}
          AND a."isDocument"
          AND btrim(a."fileUrl") <> ''
          AND m."deletedAt" IS NULL
          AND (c."retentionPurgesAt" IS NULL OR c."retentionPurgesAt" > now())
          AND c."kind"::text IN (${Prisma.join(chatKinds)})
          AND COALESCE(c."orderId", c."sourcingRequestId") IS NOT NULL
          ${filter === 'mine' ? Prisma.sql`AND m."authorRole" = 'CUSTOMER'` : Prisma.empty}
          ${pattern ? Prisma.sql`AND a."searchName" LIKE ${pattern}` : Prisma.empty}
      `);
    }
    if (wantSourcingRequest) {
      parts.push(Prisma.sql`
        SELECT 'sourcing:' || s."id", btrim(s."url"), s."filename", s."mimeType", s."createdAt",
          'SOURCING_REQUEST', s."requestId", r."status"::text, 'CUSTOMER', NULL::text, 1
        FROM "SourcingRequestAttachment" s
        JOIN "SourcingRequest" r ON r."id" = s."requestId"
        WHERE r."userId" = ${userId}
          AND s."isDocument"
          AND btrim(s."url") <> ''
          ${pattern ? Prisma.sql`AND s."searchName" LIKE ${pattern}` : Prisma.empty}
      `);
    }
    if (wantOrderDocs) {
      parts.push(Prisma.sql`
        SELECT 'order-doc:' || d."id", btrim(d."url"), NULL::text, NULL::text, d."uploadedAt",
          'ORDER_DOCUMENT', d."orderId", o."status"::text, 'STAFF', d."kind", 0
        FROM "OrderDocument" d
        JOIN "Order" o ON o."id" = d."orderId"
        WHERE o."userId" = ${userId}
          AND o."status" <> 'DRAFT'
          AND btrim(d."url") <> ''
          ${pattern ? Prisma.sql`AND (${this.orderDocumentSearchSql(q, pattern)})` : Prisma.empty}
      `);
    }

    return Prisma.sql`
      WITH docs AS (${Prisma.join(parts, ' UNION ALL ')}),
      visible AS (
        SELECT ranked.*,
          CASE WHEN ranked."source" IN ('ORDER_CHAT', 'ORDER_DOCUMENT') THEN 'order:' ELSE 'sourcing:' END
            || ranked."sourceId" AS "groupKey"
        FROM (
          SELECT docs.*, row_number() OVER (PARTITION BY "url" ORDER BY "prio", "at", "id" COLLATE "C") AS "dupRank"
          FROM docs
        ) ranked
        WHERE ranked."dupRank" = 1
      )`;
  }

  /** Поиск по документам заказа: по подписи вида («счет» → invoice), ключу вида или имени файла в URL. */
  private orderDocumentSearchSql(needle: string, pattern: string): Prisma.Sql {
    const kinds = Object.entries(ORDER_DOCUMENT_LABELS)
      .filter(([, label]) => foldSearch(label).includes(needle))
      .map(([kind]) => kind);
    return Prisma.join(
      [
        ...(kinds.length ? [Prisma.sql`d."kind" IN (${Prisma.join(kinds)})`] : []),
        Prisma.sql`${foldSql(Prisma.sql`d."kind"`)} LIKE ${pattern}`,
        Prisma.sql`${foldSql(Prisma.sql`d."url"`)} LIKE ${pattern}`,
      ],
      ' OR ',
    );
  }

  private toOut(r: DocRow): AccountDocumentOut {
    const isOrderDoc = r.source === 'ORDER_DOCUMENT';
    const title = isOrderDoc ? orderDocumentTitle(r.kind ?? '', r.url) : (r.title ?? '');
    const downloadName = isOrderDoc ? orderDocumentFilename(r.kind ?? '', r.url) : title;
    return {
      id: r.id,
      title,
      mimeType: r.mimeType,
      ext: fileExtension(isOrderDoc ? filenameFromUrl(r.url) : title),
      external: this.storage.tryPublicUrlToKey(r.url) == null,
      inline: isInlineStoredFile(r.mimeType, downloadName),
      createdAt: r.at.toISOString(),
      source: r.source,
      sourceId: r.sourceId,
      sourceStatus: r.sourceStatus,
      uploadedBy: r.uploadedBy,
    };
  }
}
