import { describe, expect, it } from 'vitest';
import { assertProductionAuthSecrets, resolveSecret } from './resolve-secret';

describe('resolveSecret', () => {
  it('returns trimmed value when set', () => {
    expect(resolveSecret('JWT_SECRET', '  my-secret  ')).toBe('my-secret');
  });

  it('returns dev fallback in non-production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      expect(resolveSecret('JWT_SECRET', undefined)).toBe('dev-secret');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('throws in production when empty', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => resolveSecret('JWT_SECRET', undefined)).toThrow(
        'JWT_SECRET must be set when NODE_ENV=production',
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('assertProductionAuthSecrets', () => {
  it('no-op in development', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      expect(() => assertProductionAuthSecrets()).not.toThrow();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
