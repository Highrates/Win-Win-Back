import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EMAIL_NOTIFICATION_REVISIONS_KEEP } from '@win-win/admin-sections';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEmailNotificationEventDef } from './email-notification-events';
import { EmailNotificationsService } from './email-notifications.service';

const ctx = { siteUrl: 'https://wupapa.test' };
const def = getEmailNotificationEventDef('order_chat_reply');

function row(overrides: Record<string, unknown> = {}) {
  return {
    eventKey: def.key,
    enabled: true,
    subject: null,
    title: null,
    body: null,
    lastSendPath: null,
    lastSendAt: null,
    lastErrorPath: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    lastEditedByUserId: null,
    lastEditedByEmail: null,
    lastEditedAt: null,
    ...overrides,
  };
}

describe('EmailNotificationsService', () => {
  const tx = {
    emailNotificationTemplateRevision: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    emailNotificationTemplate: { upsert: vi.fn() },
  };
  const prisma = {
    emailNotificationTemplate: { findMany: vi.fn(), findUnique: vi.fn() },
    emailNotificationTemplateRevision: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    $executeRaw: vi.fn(),
  };
  const audit = { log: vi.fn() };
  const config = { get: vi.fn() };
  const staffAccess = { resolveOrderNotifyRecipients: vi.fn() };
  let svc: EmailNotificationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.emailNotificationTemplate.findUnique.mockResolvedValue(null);
    prisma.emailNotificationTemplate.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({ email: 'admin@test' });
    tx.emailNotificationTemplateRevision.findMany.mockResolvedValue([]);
    staffAccess.resolveOrderNotifyRecipients.mockResolvedValue({ emails: ['ops@test'], source: 'env' });
    config.get.mockReturnValue('ops@test');
    svc = new EmailNotificationsService(prisma as never, audit as never, config as never, staffAccess as never);
  });

  describe('list / get', () => {
    it('uses code defaults when there is no row and marks edited text as customized', async () => {
      prisma.emailNotificationTemplate.findMany.mockResolvedValue([row({ subject: 'Своя тема' })]);
      const items = await svc.list();
      const edited = items.find((i) => i.eventKey === def.key)!;
      const untouched = items.find((i) => i.eventKey === 'partner_approved')!;
      expect(edited.isCustomized).toBe(true);
      expect(untouched).toMatchObject({ isCustomized: false, enabled: true, lastSendPath: null });
    });

    it('shows real recipients for staff notifications only', async () => {
      const items = await svc.list();
      expect(items.find((i) => i.eventKey === 'staff_order_submitted')!.recipients).toEqual({
        emails: ['ops@test'],
        source: 'env',
      });
      expect(items.find((i) => i.eventKey === def.key)!.recipients).toBeNull();
      expect(staffAccess.resolveOrderNotifyRecipients).toHaveBeenCalledWith('ops@test');
      expect(staffAccess.resolveOrderNotifyRecipients).toHaveBeenCalledTimes(1);
    });

    it('returns stored overrides and code defaults side by side', async () => {
      prisma.emailNotificationTemplate.findUnique.mockResolvedValue(row({ title: 'Свой заголовок' }));
      const detail = await svc.get(def.key);
      expect(detail).toMatchObject({
        subject: def.defaultSubject,
        title: 'Свой заголовок',
        defaultTitle: def.defaultTitle,
        recipients: null,
      });
      expect(staffAccess.resolveOrderNotifyRecipients).not.toHaveBeenCalled();
    });

    it('rejects unknown events', async () => {
      await expect(svc.get('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('stores only admin edits: text equal to the default is saved as NULL', async () => {
      await svc.update(def.key, { subject: 'Своя тема', title: `  ${def.defaultTitle}  ` }, 'u1');
      const upsert = tx.emailNotificationTemplate.upsert.mock.calls[0][0];
      expect(upsert.update).toMatchObject({
        subject: 'Своя тема',
        title: null,
        body: null,
        enabled: true,
        lastEditedByUserId: 'u1',
        lastEditedByEmail: 'admin@test',
      });
    });

    it('snapshots the replaced version with resolved text', async () => {
      prisma.emailNotificationTemplate.findUnique.mockResolvedValue(row({ body: 'Старое\n\n{{cta.button}}' }));
      await svc.update(def.key, { subject: 'Новая тема' }, 'u1');
      expect(tx.emailNotificationTemplateRevision.create).toHaveBeenCalledWith({
        data: {
          eventKey: def.key,
          subject: def.defaultSubject,
          title: def.defaultTitle,
          body: 'Старое\n\n{{cta.button}}',
          enabled: true,
          actorUserId: 'u1',
          actorEmail: 'admin@test',
        },
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: { changed: ['subject'], enabled: true } }));
    });

    it('deletes revisions beyond the kept limit', async () => {
      tx.emailNotificationTemplateRevision.findMany.mockResolvedValue([{ id: 'r-old-1' }, { id: 'r-old-2' }]);
      await svc.update(def.key, { subject: 'Новая тема' }, 'u1');
      expect(tx.emailNotificationTemplateRevision.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { eventKey: def.key }, skip: EMAIL_NOTIFICATION_REVISIONS_KEEP }),
      );
      expect(tx.emailNotificationTemplateRevision.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['r-old-1', 'r-old-2'] } },
      });
    });

    it('toggles sending without validating text', async () => {
      prisma.emailNotificationTemplate.findUnique.mockResolvedValue(row({ body: 'битый {{nope}}' }));
      await svc.update(def.key, { enabled: false }, 'u1');
      expect(tx.emailNotificationTemplate.upsert.mock.calls[0][0].update).toMatchObject({ enabled: false });
    });

    it('rejects blank text and a body without the button', async () => {
      await expect(svc.update(def.key, { subject: '   ' }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.update(def.key, { body: 'Без кнопки' }, 'u1')).rejects.toThrow(/нет кнопки/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('is a no-op when nothing changed', async () => {
      await svc.update(def.key, { subject: def.defaultSubject }, 'u1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('build', () => {
    const vars = def.sample(ctx.siteUrl);

    it('returns null for a disabled notification', async () => {
      prisma.emailNotificationTemplate.findUnique.mockResolvedValue(row({ enabled: false }));
      expect(await svc.build(def.key, vars, ctx)).toBeNull();
    });

    it('renders code defaults when there is no row and overrides otherwise', async () => {
      const byDefault = await svc.build(def.key, vars, ctx);
      expect(byDefault?.subject).toBe('Новое сообщение по заказу c7d2…91af — Wupapa');

      prisma.emailNotificationTemplate.findUnique.mockResolvedValue(row({ subject: 'Заказ {{order.id}}' }));
      expect((await svc.build(def.key, vars, ctx))?.subject).toBe('Заказ c7d2…91af');
    });

    it('reads the row on every send (no in-process cache)', async () => {
      await svc.build(def.key, vars, ctx);
      await svc.build(def.key, vars, ctx);
      expect(prisma.emailNotificationTemplate.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('recordSendPath', () => {
    const sql = (call: number) => (prisma.$executeRaw.mock.calls[call][0] as TemplateStringsArray).join('?');

    it('keeps failures in lastError* and leaves them untouched on success', async () => {
      await svc.recordSendPath(def.key, 'failed', 'SMTP timeout');
      expect(sql(0)).toContain('"lastErrorMessage"');
      expect(prisma.$executeRaw.mock.calls[0]).toContain('SMTP timeout');

      await svc.recordSendPath(def.key, 'rendered_db');
      expect(sql(1)).not.toContain('lastError');
    });

    it('never throws: a DB outage must not break sending', async () => {
      prisma.$executeRaw.mockRejectedValue(new Error('db down'));
      await expect(svc.recordSendPath(def.key, 'rendered_db')).resolves.toBeUndefined();
    });
  });
});
