import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { AccountDocumentsService } from './account-documents.service';
import { documentSearchName, foldSearch, isNonMediaDocument } from './document-fields';

describe('document fields', () => {
  it('treats images, video and audio as media', () => {
    expect(isNonMediaDocument('image/png', 'a.png')).toBe(false);
    expect(isNonMediaDocument('video/mp4', 'a.bin')).toBe(false);
    expect(isNonMediaDocument(null, 'photo.JPG')).toBe(false);
    expect(isNonMediaDocument('application/octet-stream', 'clip.mov')).toBe(false);
  });

  it('keeps documents', () => {
    expect(isNonMediaDocument('application/pdf', 'kp.pdf')).toBe(true);
    expect(isNonMediaDocument(null, 'spec.xlsx')).toBe(true);
    expect(isNonMediaDocument('application/msword', 'contract.doc')).toBe(true);
  });

  it('folds case and ё for search', () => {
    expect(documentSearchName('  Счёт на ОПЛАТУ.pdf ')).toBe('счет на оплату.pdf');
    expect(foldSearch('СЧЁТ')).toBe(foldSearch('счет'));
  });
});

type RawRow = Record<string, unknown>;

function docRow(over: RawRow = {}): RawRow {
  return {
    id: 'chat:a1',
    url: '/uploads/objects/chat/a1.pdf',
    title: 'Счёт.pdf',
    mimeType: 'application/pdf',
    at: new Date('2026-03-01T10:00:00.000Z'),
    source: 'ORDER_CHAT',
    sourceId: 'o1',
    sourceStatus: 'PAID',
    uploadedBy: 'STAFF',
    kind: null,
    groupKey: 'order:o1',
    ...over,
  };
}

function setup(rows: RawRow[]) {
  const queryRaw = vi.fn(async (..._args: unknown[]) => rows);
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const storage = {
    tryPublicUrlToKey: (url: string) => (url.startsWith('/uploads/') ? url.slice(9) : null),
  } as unknown as ObjectStorageService;
  return { service: new AccountDocumentsService(prisma, storage), queryRaw };
}

function sqlOf(queryRaw: ReturnType<typeof setup>['queryRaw']): Prisma.Sql {
  const [strings, ...values] = queryRaw.mock.calls[0]! as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(strings, ...values);
}

describe('AccountDocumentsService.listForCustomer', () => {
  it('maps rows in one query and hides urls', async () => {
    const { service, queryRaw } = setup([
      docRow(),
      docRow({
        id: 'order-doc:d1',
        url: 'https://example.com/contract.docx',
        title: null,
        mimeType: null,
        source: 'ORDER_DOCUMENT',
        uploadedBy: 'STAFF',
        kind: 'contract',
      }),
    ]);
    const page = await service.listForCustomer('u1');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual([
      {
        id: 'chat:a1',
        title: 'Счёт.pdf',
        mimeType: 'application/pdf',
        ext: 'pdf',
        external: false,
        inline: true,
        createdAt: '2026-03-01T10:00:00.000Z',
        source: 'ORDER_CHAT',
        sourceId: 'o1',
        sourceStatus: 'PAID',
        uploadedBy: 'STAFF',
      },
      expect.objectContaining({ id: 'order-doc:d1', title: 'Договор', ext: 'docx', external: true, inline: false }),
    ]);
    expect(JSON.stringify(page)).not.toContain('url');
  });

  it('returns a cursor when there is one more row than the limit', async () => {
    const { service } = setup([docRow({ id: 'chat:a2' }), docRow({ id: 'chat:a1' })]);
    const page = await service.listForCustomer('u1', { limit: 1 });
    expect(page.items.map((d) => d.id)).toEqual(['chat:a2']);
    const cursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'));
    expect(cursor).toEqual({ t: '2026-03-01T10:00:00.000Z', id: 'chat:a2' });
  });

  it('passes the folded search pattern with LIKE wildcards escaped', async () => {
    const { service, queryRaw } = setup([]);
    await service.listForCustomer('u1', { q: '  СЧЁТ 100%_ ' });
    expect(sqlOf(queryRaw).values).toContain('%счет 100\\%\\_%');
  });

  it('rejects bad cursors and group keys before querying', async () => {
    const { service, queryRaw } = setup([]);
    await expect(service.listForCustomer('u1', { cursor: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listForCustomer('u1', { group: 'order:1;drop' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('AccountDocumentsService.listGroupsForCustomer', () => {
  const groupRow = (key: string, pos: number, total: number, doc?: RawRow): RawRow => ({
    pageGroupKey: key,
    latestAt: new Date('2026-03-01T10:00:00.000Z'),
    total,
    groupPos: pos,
    ...(doc ?? { id: null }),
  });

  it('builds groups with per-group and page cursors', async () => {
    const { service, queryRaw } = setup([
      groupRow('order:o1', 1, 3, docRow({ id: 'chat:a2' })),
      groupRow('order:o1', 1, 3, docRow({ id: 'chat:a1' })),
      groupRow('sourcing:s1', 2, 1, docRow({ id: 'sourcing:x', source: 'SOURCING_REQUEST', sourceId: 's1' })),
      groupRow('order:o9', 3, 4),
    ]);
    const page = await service.listGroupsForCustomer('u1', { limit: 2, itemsPerGroup: 2 });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(page.groups.map((g) => [g.key, g.source, g.sourceId, g.total, g.items.map((d) => d.id)])).toEqual([
      ['order:o1', 'ORDER', 'o1', 3, ['chat:a2', 'chat:a1']],
      ['sourcing:s1', 'SOURCING', 's1', 1, ['sourcing:x']],
    ]);
    expect(page.groups[0]!.sourceStatus).toBe('PAID');
    expect(page.groups[0]!.nextCursor).not.toBeNull();
    expect(page.groups[1]!.nextCursor).toBeNull();
    const cursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'));
    expect(cursor).toEqual({ t: '2026-03-01T10:00:00.000Z', k: 'sourcing:s1' });
  });

  it('rejects a document cursor in place of a group cursor', async () => {
    const { service } = setup([]);
    const docCursor = Buffer.from(JSON.stringify({ t: '2026-03-01T10:00:00.000Z', id: 'chat:a1' })).toString(
      'base64url',
    );
    await expect(service.listGroupsForCustomer('u1', { cursor: docCursor })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
