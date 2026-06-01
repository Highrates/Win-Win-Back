import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { AuditAction } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuditService } from './audit.service';
import { isAuthSecurityPath } from './auth-security-path';

@Catch(ThrottlerException)
export class AuthSecurityExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuthSecurityExceptionFilter.name);

  constructor(private readonly audit: AuditService) {}

  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const path = `${req.originalUrl || req.path || req.url || ''}`.split('?')[0];

    if (isAuthSecurityPath(path)) {
      void this.audit.logAuthSecurityEvent({
        action: AuditAction.AUTH_RATE_LIMITED,
        path,
        httpMethod: req.method?.toUpperCase() ?? 'POST',
        metadata: { httpStatus: 429 },
      }).catch((e) => {
        this.logger.warn(
          `auth rate-limit audit failed: ${e instanceof Error ? e.message : e}`,
        );
      });
    }

    const status = exception.getStatus();
    const body = exception.getResponse();
    if (typeof body === 'object' && body !== null) {
      return res.status(status).json(body);
    }
    return res.status(status).json({
      statusCode: status,
      message: typeof body === 'string' ? body : 'Too Many Requests',
    });
  }
}
