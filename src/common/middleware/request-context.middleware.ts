import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestContextAls, type RequestContextStore } from '../request-context/request-context.storage';

function clientIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0]?.trim() || null;
  }
  if (Array.isArray(xff) && xff[0]) {
    return String(xff[0]).split(',')[0]?.trim() || null;
  }
  const raw = req.socket?.remoteAddress;
  return raw ?? null;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const ua = req.headers['user-agent'];
    const store: RequestContextStore = {
      ip: clientIp(req),
      // Длинный UA в каждой строке аудита сильно раздувает таблицу — хватает префикса для классификации.
      userAgent: typeof ua === 'string' ? ua.slice(0, 160) : null,
    };
    requestContextAls.run(store, () => next());
  }
}
