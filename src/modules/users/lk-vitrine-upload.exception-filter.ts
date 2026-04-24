import { ArgumentsHost, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import type { Response, Request } from 'express';

/**
 * Multer (лимит fileSize) бросает PayloadTooLarge с текстом "File too large" —
 * подменяем на локализованные лимиты ЛК.
 */
@Catch(PayloadTooLargeException)
export class LkVitrineUploadExceptionFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const path = `${req.originalUrl || req.path || req.url || ''}`.split('?')[0];
    let message = 'Файл слишком большой';
    if (path.includes('/me/profile/avatar')) {
      message = 'Аватар не больше 2 МБ';
    } else if (path.includes('/me/profile/cover')) {
      message = 'Файл обложки не больше 5 МБ';
    } else if (path.includes('/me/profile/rich-media')) {
      message = 'Файл больше 100 МБ';
    }
    return res.status(413).type('application/json').json({ statusCode: 413, message });
  }
}
