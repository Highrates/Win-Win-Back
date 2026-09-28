import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { MailService } from './mail.service';

const params = {
  recipients: ['ops@test', 'mod@test'],
  orderDisplayId: 'c7d2…91af',
  orderId: 'o1',
  adminOrderUrl: 'https://wupapa.test/admin/orders/o1',
};

describe('MailService notifications', () => {
  const config = { get: vi.fn((key: string, fallback?: unknown) => (key === 'FRONTEND_PUBLIC_URL' ? 'https://wupapa.test' : fallback)) };
  const notifications = { build: vi.fn(), recordSendPath: vi.fn() };
  type Deliver = (to: unknown, content: unknown) => Promise<number>;
  const proto = MailService.prototype as unknown as { deliver: Deliver };
  let mail: MailService;
  let deliver: MockInstance<Deliver>;

  beforeEach(() => {
    vi.clearAllMocks();
    deliver = vi.spyOn(proto, 'deliver').mockResolvedValue(2);
    mail = new MailService(config as never, notifications as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the template from the admin and records rendered_db', async () => {
    const content = { subject: 'S', text: 'T', html: '<p>H</p>' };
    notifications.build.mockResolvedValue(content);
    await mail.sendOrderSubmittedPendingApprovalStaff(params);
    expect(notifications.build).toHaveBeenCalledWith(
      'staff_order_submitted',
      { 'order.id': 'c7d2…91af', 'order.status': 'На согласовании', 'admin.url': params.adminOrderUrl },
      expect.objectContaining({ siteUrl: 'https://wupapa.test' }),
    );
    expect(deliver).toHaveBeenCalledWith(params.recipients, content);
    expect(notifications.recordSendPath).toHaveBeenCalledWith('staff_order_submitted', 'rendered_db', undefined);
  });

  it('does not send a disabled notification', async () => {
    notifications.build.mockResolvedValue(null);
    await mail.sendOrderSubmittedPendingApprovalStaff(params);
    expect(deliver).not.toHaveBeenCalled();
    expect(notifications.recordSendPath).toHaveBeenCalledWith('staff_order_submitted', 'skipped_disabled');
  });

  it('falls back to registry defaults when the template cannot be loaded, keeping the reason', async () => {
    notifications.build.mockRejectedValue(new Error("Can't reach database server"));
    await mail.sendOrderSubmittedPendingApprovalStaff(params);
    const content = deliver.mock.calls[0][1] as { subject: string; html: string };
    expect(content.subject).toBe('Новая заявка на заказ c7d2…91af — Wupapa');
    expect(content.html).toContain('Открыть заказ</a>');
    expect(notifications.recordSendPath).toHaveBeenCalledWith(
      'staff_order_submitted',
      'rendered_legacy',
      "Can't reach database server",
    );
  });

  it('records an SMTP failure with its message and rethrows', async () => {
    notifications.build.mockResolvedValue({ subject: 'S', text: 'T', html: 'H' });
    deliver.mockRejectedValue(new Error('SMTP timeout'));
    await expect(mail.sendOrderSubmittedPendingApprovalStaff(params)).rejects.toThrow('SMTP timeout');
    expect(notifications.recordSendPath).toHaveBeenCalledWith('staff_order_submitted', 'failed', 'SMTP timeout');
  });

  it('skips everything when there are no recipients', async () => {
    await mail.sendOrderSubmittedPendingApprovalStaff({ ...params, recipients: [' '] });
    expect(notifications.build).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('marks test emails in the subject', async () => {
    await mail.sendTest('me@test', { subject: 'Тема', text: 'T', html: 'H' });
    expect(deliver).toHaveBeenCalledWith('me@test', { subject: '[тест] Тема', text: 'T', html: 'H' });
  });
});
