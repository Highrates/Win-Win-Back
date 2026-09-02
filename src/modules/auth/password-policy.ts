import { BadRequestException } from '@nestjs/common';
import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/** Не менее 8 символов, хотя бы одна буква и одна цифра. */
export const PASSWORD_POLICY_MESSAGE =
  'Пароль — не менее 8 символов, должен содержать буквы и цифры';

const PASSWORD_POLICY_RE = /^(?=.*[A-Za-zА-Яа-яЁё])(?=.*\d).{8,200}$/s;

export function isPasswordPolicyOk(password: string): boolean {
  return PASSWORD_POLICY_RE.test(password);
}

/** Enforce в UsersService и других местах смены пароля. */
export function assertPasswordPolicy(password: string): void {
  if (!isPasswordPolicyOk(password ?? '')) {
    throw new BadRequestException(PASSWORD_POLICY_MESSAGE);
  }
}

@ValidatorConstraint({ name: 'passwordPolicy', async: false })
export class PasswordPolicyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && isPasswordPolicyOk(value);
  }

  defaultMessage(): string {
    return PASSWORD_POLICY_MESSAGE;
  }
}

export function IsPasswordPolicy(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: PasswordPolicyConstraint,
    });
  };
}
