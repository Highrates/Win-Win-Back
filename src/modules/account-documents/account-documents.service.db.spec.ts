/**
 * SQL ленты документов на настоящей БД. Каждый тест — в транзакции, которая откатывается.
 * Запуск: ACCOUNT_DOCS_DB_TEST=1 npx vitest run src/modules/account-documents (нужен DATABASE_URL с миграциями).
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { AccountDocumentsService, type AccountDocumentsFilter } from './account-documents.service';
import { documentSearchName, isNonMediaDocument } from './document-fields';

const RUN = process.env.ACCOUNT_DOCS_DB_TEST === '1';
const prisma = RUN ? new PrismaClient() : null;

class Rollback extends Error {}

const storage = {
  tryPublicUrlToKey: (url: string) => (url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null),
} as unknown as ObjectStorageService;

const T0 = Date.parse('2026-01-10T12:00:00.000Z');
const at = (hoursAgo: number) => new Date(T0 - hoursAgo * 3_600_000);

async function inRollback(fn: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  try {
    await prisma!.$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback();
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

type Seed = { userId: string; orderA: string; orderB: string; request: string };

async function seed(tx: Prisma.TransactionClient): Promise<Seed> {
  const user = await tx.user.create({ data: {} });
  const other = await tx.user.create({ data: {} });
  const orderA = await tx.order.create({ data: { userId: user.id, totalAmount: 1, status: 'PENDING_APPROVAL' } });
  const orderB = await tx.order.create({ data: { userId: user.id, totalAmount: 1, status: 'COMPLETED' } });
  const draft = await tx.order.create({ data: { userId: user.id, totalAmount: 1, status: 'DRAFT' } });
  const otherOrder = await tx.order.create({ data: { userId: other.id, totalAmount: 1, status: 'PENDING_APPROVAL' } });
  const request = await tx.sourcingRequest.create({ data: { userId: user.id, title: 'Подбор', createdAt: at(50) } });

  const chat = async (
    conversationId: string,
    ownerUserId: string,
    createdAt: Date,
    files: { name: string; url?: string; mime?: string; kind?: 'FILE' | 'IMAGE' }[],
    opts: { authorRole?: 'CUSTOMER' | 'STAFF'; deleted?: boolean } = {},
  ) =>
    tx.chatMessage.create({
      data: {
        conversationId,
        authorUserId: ownerUserId,
        authorRole: opts.authorRole ?? 'STAFF',
        createdAt,
        deletedAt: opts.deleted ? createdAt : null,
        attachments: {
          create: files.map((f) => ({
            fileUrl: f.url ?? `/uploads/objects/chat/${f.name}`,
            filename: f.name,
            mimeType: f.mime ?? null,
            kind: f.kind ?? 'FILE',
            ownerUserId,
            createdAt,
            isDocument: (f.kind ?? 'FILE') === 'FILE' && isNonMediaDocument(f.mime, f.name),
            searchName: documentSearchName(f.name),
          })),
        },
      },
    });

  const convA = await tx.chatConversation.create({ data: { kind: 'ORDER', orderId: orderA.id } });
  const convB = await tx.chatConversation.create({ data: { kind: 'ORDER', orderId: orderB.id } });
  const convS = await tx.chatConversation.create({ data: { kind: 'SOURCING', sourcingRequestId: request.id } });
  const convOther = await tx.chatConversation.create({ data: { kind: 'ORDER', orderId: otherOrder.id } });

  // Заказ A: 3 документа в чате + счёт; дубль счёта в чате позже, картинка, удалённое сообщение.
  await chat(convA.id, user.id, at(1), [{ name: 'Счёт на оплату.pdf', mime: 'application/pdf' }]);
  await chat(convA.id, user.id, at(2), [{ name: 'spec.xlsx' }, { name: 'photo.jpg', mime: 'image/jpeg' }], {
    authorRole: 'CUSTOMER',
  });
  await chat(convA.id, user.id, at(3), [{ name: 'deleted.pdf' }], { deleted: true });
  await chat(convA.id, user.id, at(4), [{ name: 'invoice-copy.pdf', url: '/uploads/objects/orders/invoice.pdf' }]);
  await chat(convA.id, user.id, at(5), [{ name: 'scan.png', kind: 'IMAGE' }]);
  await chat(convA.id, user.id, at(6), [{ name: 'счет-2.pdf' }]);
  await tx.orderDocument.create({
    data: { orderId: orderA.id, kind: 'invoice', url: '/uploads/objects/orders/invoice.pdf', uploadedAt: at(10) },
  });

  // Заказ B: один документ, внешняя ссылка; черновик — не показывается.
  await tx.orderDocument.create({
    data: { orderId: orderB.id, kind: 'contract', url: 'https://example.com/contract.docx', uploadedAt: at(20) },
  });
  await tx.orderDocument.create({ data: { orderId: draft.id, kind: 'act', url: '/uploads/objects/orders/draft.pdf' } });

  // Подбор: вложение заявки и тот же файл в чате (канонический — вложение заявки).
  await tx.sourcingRequestAttachment.create({
    data: {
      requestId: request.id,
      url: '/uploads/objects/sourcing-requests/r/attachments/brief.docx',
      filename: 'brief.docx',
      createdAt: at(45),
      isDocument: true,
      searchName: documentSearchName('brief.docx'),
    },
  });
  await chat(convS.id, user.id, at(30), [
    { name: 'brief-copy.docx', url: '/uploads/objects/sourcing-requests/r/attachments/brief.docx' },
    { name: 'КП.pdf' },
  ]);

  // Чужой документ.
  await chat(convOther.id, other.id, at(0), [{ name: 'foreign.pdf' }]);

  return { userId: user.id, orderA: orderA.id, orderB: orderB.id, request: request.id };
}

function service(tx: Prisma.TransactionClient) {
  return new AccountDocumentsService(tx as unknown as PrismaService, storage);
}

async function titles(tx: Prisma.TransactionClient, userId: string, filter: AccountDocumentsFilter, q?: string) {
  const page = await service(tx).listForCustomer(userId, { filter, q });
  return page.items.map((d) => d.title);
}

describe.skipIf(!RUN)('AccountDocumentsService (SQL)', () => {
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('merges sources, drops media / deleted / draft / foreign, dedupes by url', async () => {
    await inRollback(async (tx) => {
      const { userId, orderA, request } = await seed(tx);
      const page = await service(tx).listForCustomer(userId);
      expect(page.nextCursor).toBeNull();
      expect(page.items.map((d) => [d.id.split(':')[0], d.title])).toEqual([
        ['chat', 'Счёт на оплату.pdf'],
        ['chat', 'spec.xlsx'],
        ['chat', 'счет-2.pdf'],
        ['order-doc', 'Счёт'],
        ['order-doc', 'Договор'],
        ['chat', 'КП.pdf'],
        ['sourcing', 'brief.docx'],
      ]);
      const invoice = page.items.find((d) => d.source === 'ORDER_DOCUMENT' && d.sourceId === orderA);
      expect(invoice).toMatchObject({ ext: 'pdf', external: false, inline: true, uploadedBy: 'STAFF' });
      expect(page.items.find((d) => d.title === 'Договор')).toMatchObject({ external: true, inline: false });
      expect(page.items.find((d) => d.title === 'brief.docx')).toMatchObject({
        source: 'SOURCING_REQUEST',
        sourceId: request,
        sourceStatus: 'PENDING_REVIEW',
        createdAt: at(45).toISOString(),
        inline: false,
      });
      expect(invoice?.sourceStatus).toBe('PENDING_APPROVAL');
      expect(page.items.find((d) => d.title === 'Договор')?.sourceStatus).toBe('COMPLETED');
      expect(page.items.find((d) => d.title === 'КП.pdf')?.sourceStatus).toBe('PENDING_REVIEW');
      expect(page.items.find((d) => d.title === 'spec.xlsx')?.uploadedBy).toBe('CUSTOMER');
    });
  });

  it('paginates with full pages and no repeats', async () => {
    await inRollback(async (tx) => {
      const { userId } = await seed(tx);
      const all = (await service(tx).listForCustomer(userId)).items.map((d) => d.id);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await service(tx).listForCustomer(userId, { limit: 2, cursor });
        if (page.nextCursor) expect(page.items).toHaveLength(2);
        seen.push(...page.items.map((d) => d.id));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);
      expect(seen).toEqual(all);
    });
  });

  it('search folds case and ё/е both ways', async () => {
    await inRollback(async (tx) => {
      const { userId } = await seed(tx);
      const expected = ['Счёт на оплату.pdf', 'счет-2.pdf', 'Счёт'];
      expect(await titles(tx, userId, 'all', 'счет')).toEqual(expected);
      expect(await titles(tx, userId, 'all', 'СЧЁТ')).toEqual(expected);
      expect(await titles(tx, userId, 'all', 'кп')).toEqual(['КП.pdf']);
      expect(await titles(tx, userId, 'all', '100%')).toEqual([]);
    });
  });

  it('filters: mine / orders / sourcing', async () => {
    await inRollback(async (tx) => {
      const { userId } = await seed(tx);
      expect(await titles(tx, userId, 'mine')).toEqual(['spec.xlsx', 'brief.docx']);
      expect(await titles(tx, userId, 'orders')).toEqual([
        'Счёт на оплату.pdf',
        'spec.xlsx',
        'счет-2.pdf',
        'Счёт',
        'Договор',
      ]);
      expect(await titles(tx, userId, 'sourcing')).toEqual(['КП.pdf', 'brief.docx']);
    });
  });

  it('groups by order / request with totals, first items and per-group cursor', async () => {
    await inRollback(async (tx) => {
      const { userId, orderA, orderB, request } = await seed(tx);
      const svc = service(tx);
      const page = await svc.listGroupsForCustomer(userId, { itemsPerGroup: 2 });
      expect(page.nextCursor).toBeNull();
      expect(page.groups.map((g) => [g.key, g.total, g.items.map((d) => d.title)])).toEqual([
        [`order:${orderA}`, 4, ['Счёт на оплату.pdf', 'spec.xlsx']],
        [`order:${orderB}`, 1, ['Договор']],
        [`sourcing:${request}`, 2, ['КП.pdf', 'brief.docx']],
      ]);
      const [a, b, s] = page.groups;
      expect(a).toMatchObject({ source: 'ORDER', sourceId: orderA });
      expect(a.nextCursor).not.toBeNull();
      expect(b.nextCursor).toBeNull();
      expect(b.sourceStatus).toBe('COMPLETED');
      expect(s).toMatchObject({ source: 'SOURCING', nextCursor: null });

      const rest = await svc.listForCustomer(userId, { group: a.key, cursor: a.nextCursor });
      expect(rest.items.map((d) => d.title)).toEqual(['счет-2.pdf', 'Счёт']);
      expect(rest.nextCursor).toBeNull();

      const first = await svc.listGroupsForCustomer(userId, { limit: 2, itemsPerGroup: 1 });
      expect(first.groups.map((g) => g.key)).toEqual([`order:${orderA}`, `order:${orderB}`]);
      const second = await svc.listGroupsForCustomer(userId, { limit: 2, cursor: first.nextCursor });
      expect(second.groups.map((g) => g.key)).toEqual([`sourcing:${request}`]);
      expect(second.nextCursor).toBeNull();

      const searched = await svc.listGroupsForCustomer(userId, { q: 'счет' });
      expect(searched.groups.map((g) => [g.key, g.total])).toEqual([[`order:${orderA}`, 3]]);
    });
  });
});
