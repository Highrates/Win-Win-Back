import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  SOURCING_FILE_MAX_BYTES,
  SOURCING_MAX_FILES,
} from './sourcing-limits.constants';

const MB = 1024 * 1024;

/** Тексты Multer/busboy (англ.) → понятные пользователю заявки. */
const MULTER_MESSAGES: Record<string, string> = {
  'File too large': `Файл больше ${Math.floor(SOURCING_FILE_MAX_BYTES / MB)} МБ`,
  'Too many files': `Не больше ${SOURCING_MAX_FILES} файлов на заявку`,
  'Too many parts': 'Слишком много файлов и полей в заявке',
  'Too many fields': 'Слишком много полей в заявке',
  'Field value too long': 'Слишком длинное описание заявки',
  'Field name too long': 'Некорректные данные заявки',
  'Field name missing': 'Некорректные данные заявки',
  'Unexpected field': 'Некорректные данные заявки',
  'Multipart: Boundary not found': 'Не удалось прочитать файлы заявки. Попробуйте отправить ещё раз.',
  'Multipart: Malformed part header': 'Не удалось прочитать файлы заявки. Попробуйте отправить ещё раз.',
  'Multipart: Unexpected end of form': 'Загрузка прервалась. Проверьте соединение и отправьте ещё раз.',
  'Multipart: Unexpected end of file': 'Загрузка прервалась. Проверьте соединение и отправьте ещё раз.',
};

function exceptionMessage(exception: HttpException): string | null {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown })?.message;
  return typeof message === 'string' ? message : null;
}

@Catch(PayloadTooLargeException, BadRequestException)
export class SourcingUploadExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const raw = exceptionMessage(exception);
    const localized = raw ? MULTER_MESSAGES[raw] : undefined;
    const body = exception.getResponse();
    if (localized || typeof body === 'string') {
      return res
        .status(status)
        .type('application/json')
        .json({ statusCode: status, message: localized ?? raw });
    }
    return res.status(status).type('application/json').json(body);
  }
}
