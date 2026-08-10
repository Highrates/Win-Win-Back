/**
 * В dev допускаем fallback; в production пустой секрет — fail-fast при старте/первом использовании.
 */
export function resolveSecret(
  envName: string,
  value: string | undefined,
  devFallback = 'dev-secret',
): string {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production') {
    throw new Error(`${envName} must be set when NODE_ENV=production`);
  }
  return devFallback;
}

/** JWT и производные токены (registration, password reset, designer invite). */
export function assertProductionAuthSecrets(): void {
  if ((process.env.NODE_ENV || 'development') !== 'production') return;
  resolveSecret('JWT_SECRET', process.env.JWT_SECRET);
}
