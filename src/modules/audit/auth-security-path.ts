/** Публичные auth-ручки, где важны audit LOGIN/REGISTER и алерты 401/429. */
export function isAuthSecurityPath(path: string): boolean {
  const p = path.toLowerCase();
  return (
    p.includes('/auth/login') ||
    p.includes('/auth/admin/login') ||
    p.includes('/auth/register/') ||
    p.includes('/auth/password-reset/')
  );
}
