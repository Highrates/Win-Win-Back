import { JwtService } from '@nestjs/jwt';

/** `sub` из Bearer JWT без ошибки, если токена нет или он невалиден. */
export function userIdFromBearerHeader(
  jwt: JwtService,
  authorization?: string,
): string | undefined {
  const raw = authorization?.trim();
  if (!raw?.toLowerCase().startsWith('bearer ')) return undefined;
  const token = raw.slice(7).trim();
  if (!token) return undefined;
  try {
    const payload = jwt.verify<{ sub?: string }>(token);
    const sub = payload.sub;
    return typeof sub === 'string' && sub.trim() ? sub.trim() : undefined;
  } catch {
    return undefined;
  }
}
