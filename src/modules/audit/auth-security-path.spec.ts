import { describe, expect, it } from 'vitest';
import { isAuthSecurityPath } from './auth-security-path';

describe('isAuthSecurityPath', () => {
  it('matches login and register routes', () => {
    expect(isAuthSecurityPath('/api/v1/auth/login')).toBe(true);
    expect(isAuthSecurityPath('/api/v1/auth/admin/login')).toBe(true);
    expect(isAuthSecurityPath('/api/v1/auth/register/email/start')).toBe(true);
    expect(isAuthSecurityPath('/api/v1/auth/password-reset/request')).toBe(true);
  });

  it('ignores unrelated API paths', () => {
    expect(isAuthSecurityPath('/api/v1/catalog/products')).toBe(false);
    expect(isAuthSecurityPath('/api/v1/auth/me')).toBe(false);
  });
});
