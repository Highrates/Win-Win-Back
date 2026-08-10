import { ProductQaAuthorRole, UserRole } from '@prisma/client';

/** JWT role → ProductQaAuthorRole (USER | STAFF). */
export function productQaAuthorRoleFromJwt(role: string): ProductQaAuthorRole {
  return role === UserRole.ADMIN || role === UserRole.MODERATOR
    ? ProductQaAuthorRole.STAFF
    : ProductQaAuthorRole.USER;
}
