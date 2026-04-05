import {
  HttpException,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { adminMutationPathMatches } from './admin-mutation-path';

/** Загрузки логируются отдельно (UPLOAD в контроллерах). */
const SKIP_PATH_SUBSTRINGS = [
  '/upload-image',
  '/upload-brand-image',
  '/upload-rich-media',
  '/media/upload',
];

function httpStatusFromError(err: unknown): number {
  if (err instanceof HttpException) return err.getStatus();
  return 500;
}

function messageFromError(err: unknown): string {
  if (err instanceof HttpException) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

@Injectable()
export class AuditHttpInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<Request>();
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    const pathOnly = (req.originalUrl || req.url || '').split('?')[0];
    const apiPrefix = this.config.get<string>('API_PREFIX', 'api/v1');

    if (!adminMutationPathMatches(pathOnly, apiPrefix)) {
      return next.handle();
    }
    if (SKIP_PATH_SUBSTRINGS.some((s) => pathOnly.includes(s))) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        void this.audit.logAdminHttpMutation({
          method,
          path: pathOnly,
          outcome: 'success',
        });
      }),
      catchError((err: unknown) => {
        void this.audit.logAdminHttpMutation({
          method,
          path: pathOnly,
          outcome: 'failure',
          httpStatus: httpStatusFromError(err),
          errorMessage: messageFromError(err),
        });
        return throwError(() => err);
      }),
    );
  }
}
