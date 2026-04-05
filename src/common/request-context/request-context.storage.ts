import { AsyncLocalStorage } from 'async_hooks';

export interface CurrentUserContext {
  sub: string;
  email?: string;
  role: string;
}

export interface RequestContextStore {
  ip: string | null;
  userAgent: string | null;
  currentUser?: CurrentUserContext;
}

export const requestContextAls = new AsyncLocalStorage<RequestContextStore>();

export function getRequestContextStore(): RequestContextStore | undefined {
  return requestContextAls.getStore();
}
