import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailNotificationsAdminController, TEST_SEND_LIMIT } from './email-notifications-admin.controller';

describe('EmailNotificationsAdminController.testSend', () => {
  const content = { subject: 'S', text: 'T', html: 'H' };
  const notifications = { preview: vi.fn() };
  const mail = { mailContext: vi.fn(() => ({ siteUrl: 'https://wupapa.test' })), sendTest: vi.fn() };
  const prisma = { user: { findUnique: vi.fn() } };
  const rateLimit = { consumeSlot: vi.fn() };
  let controller: EmailNotificationsAdminController;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ email: ' me@test ' });
    notifications.preview.mockResolvedValue(content);
    controller = new EmailNotificationsAdminController(
      notifications as never,
      mail as never,
      prisma as never,
      rateLimit as never,
    );
  });

  it('sends the preview to the current staff email within the per-user limit', async () => {
    await expect(controller.testSend('u1', 'order_chat_reply', { sampleVariant: 'sparse' })).resolves.toEqual({
      ok: true,
      to: 'me@test',
    });
    expect(rateLimit.consumeSlot).toHaveBeenCalledWith(
      'email-test:u1',
      TEST_SEND_LIMIT.max,
      TEST_SEND_LIMIT.windowMs,
      expect.stringContaining('Слишком много тестовых писем'),
    );
    expect(mail.sendTest).toHaveBeenCalledWith('me@test', content);
  });

  it('does not send once the limit is exhausted', async () => {
    rateLimit.consumeSlot.mockRejectedValue(new HttpException('limit', HttpStatus.TOO_MANY_REQUESTS));
    await expect(controller.testSend('u1', 'order_chat_reply', {})).rejects.toMatchObject({ status: 429 });
    expect(mail.sendTest).not.toHaveBeenCalled();
  });

  it('does not spend the limit on an invalid template or a missing email', async () => {
    notifications.preview.mockRejectedValue(new BadRequestException('Сообщение: заполните поле'));
    await expect(controller.testSend('u1', 'order_chat_reply', { body: ' ' })).rejects.toBeInstanceOf(BadRequestException);

    prisma.user.findUnique.mockResolvedValue({ email: null });
    await expect(controller.testSend('u1', 'order_chat_reply', {})).rejects.toThrow('не указан email');
    expect(rateLimit.consumeSlot).not.toHaveBeenCalled();
  });
});
