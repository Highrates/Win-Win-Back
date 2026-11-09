import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SourcingUploadExceptionFilter } from './sourcing-upload.exception-filter';

function runFilter(exception: BadRequestException | PayloadTooLargeException) {
  const json = vi.fn();
  const res = { status: vi.fn(() => res), type: vi.fn(() => res), json };
  const host = { switchToHttp: () => ({ getResponse: () => res }) };
  new SourcingUploadExceptionFilter().catch(exception, host as never);
  return { res, body: json.mock.calls[0]?.[0] };
}

describe('SourcingUploadExceptionFilter', () => {
  it('переводит лимит размера Multer', () => {
    const { res, body } = runFilter(new PayloadTooLargeException('File too large'));
    expect(res.status).toHaveBeenCalledWith(413);
    expect(body).toEqual({ statusCode: 413, message: 'Файл больше 15 МБ' });
  });

  it('переводит лимит количества файлов', () => {
    const { body } = runFilter(new BadRequestException('Too many files'));
    expect(body.message).toBe('Не больше 50 файлов на заявку');
  });

  it('прочие ошибки валидации отдаёт как есть', () => {
    const { body } = runFilter(new BadRequestException(['Товар 1: проверьте адрес ссылки']));
    expect(body.message).toEqual(['Товар 1: проверьте адрес ссылки']);
  });
});
