import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { diskStorage } from 'multer';
import {
  SOURCING_FILE_MAX_BYTES,
  SOURCING_MAX_FILES,
  SOURCING_UPLOAD_TOTAL_MAX_BYTES,
} from './sourcing-limits.constants';

const UPLOAD_TMP_DIR = join(tmpdir(), 'winwin-sourcing-uploads');

export function sourcingUploadMulterOptions() {
  mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  return {
    storage: diskStorage({
      destination: UPLOAD_TMP_DIR,
      filename: (_req: Express.Request, file: Express.Multer.File, cb) => {
        const safe = (file.originalname || 'file').replace(/[^\w.\-()+ ]/g, '_').slice(0, 120);
        cb(null, `${randomBytes(16).toString('hex')}-${safe}`);
      },
    }),
    limits: {
      fileSize: SOURCING_FILE_MAX_BYTES,
      files: SOURCING_MAX_FILES,
    },
  };
}

export function assertSourcingUploadTotalSize(files: Express.Multer.File[]): void {
  let total = 0;
  for (const file of files) {
    total += file.size ?? 0;
    if (total > SOURCING_UPLOAD_TOTAL_MAX_BYTES) {
      throw new BadRequestException(
        `Суммарный размер файлов не больше ${Math.floor(SOURCING_UPLOAD_TOTAL_MAX_BYTES / (1024 * 1024))} МБ`,
      );
    }
  }
}

export async function cleanupSourcingTempUploads(files: Express.Multer.File[]): Promise<void> {
  await Promise.allSettled(
    files.map((file) => (file.path ? unlink(file.path).catch(() => undefined) : Promise.resolve())),
  );
}
