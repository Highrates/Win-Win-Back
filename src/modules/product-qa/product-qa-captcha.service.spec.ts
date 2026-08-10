import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductQaCaptchaService } from './product-qa-captcha.service';

describe('ProductQaCaptchaService', () => {
  function build(secret?: string) {
    const config = {
      get: vi.fn((key: string) =>
        key === 'PRODUCT_QA_TURNSTILE_SECRET_KEY' ? secret : undefined,
      ),
    };
    return new ProductQaCaptchaService(config as unknown as ConfigService);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('skips validation when secret is unset', async () => {
    const svc = build(undefined);
    expect(svc.isRequiredForUserPosts()).toBe(false);
    await expect(svc.assertValidUserToken(undefined)).resolves.toBeUndefined();
  });

  it('requires token when secret is set', async () => {
    const svc = build('test-secret');
    expect(svc.isRequiredForUserPosts()).toBe(true);
    await expect(svc.assertValidUserToken(undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.assertValidUserToken('')).rejects.toThrow(/робот/);
  });

  it('accepts valid turnstile response', async () => {
    const svc = build('test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ success: true }),
      })),
    );
    await expect(svc.assertValidUserToken('valid-token')).resolves.toBeUndefined();
  });

  it('rejects failed turnstile response', async () => {
    const svc = build('test-secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({ success: false }),
      })),
    );
    await expect(svc.assertValidUserToken('bad-token')).rejects.toThrow(/Captcha/);
  });
});
