import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertPasswordPolicy,
  isPasswordPolicyOk,
  PASSWORD_POLICY_MESSAGE,
} from './password-policy';

describe('password-policy', () => {
  it('accepts letters + digits, length >= 8', () => {
    expect(isPasswordPolicyOk('Password1')).toBe(true);
    expect(isPasswordPolicyOk('пароль12')).toBe(true);
    expect(isPasswordPolicyOk('Ab1cdefg')).toBe(true);
  });

  it('rejects short / letters-only / digits-only', () => {
    expect(isPasswordPolicyOk('Pass1')).toBe(false);
    expect(isPasswordPolicyOk('password')).toBe(false);
    expect(isPasswordPolicyOk('12345678')).toBe(false);
  });

  it('assertPasswordPolicy throws BadRequestException', () => {
    expect(() => assertPasswordPolicy('short')).toThrow(BadRequestException);
    expect(() => assertPasswordPolicy('short')).toThrow(PASSWORD_POLICY_MESSAGE);
    expect(() => assertPasswordPolicy('Password1')).not.toThrow();
  });
});
