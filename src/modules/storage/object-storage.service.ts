import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly s3Client: S3Client | null;
  private readonly s3Bucket: string | undefined;
  private readonly s3PublicBase: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.s3Bucket = this.config.get<string>('S3_BUCKET')?.trim() || undefined;
    const accessKey =
      this.config.get<string>('S3_ACCESS_KEY_ID')?.trim() ||
      this.config.get<string>('AWS_ACCESS_KEY_ID')?.trim();
    const secret =
      this.config.get<string>('S3_SECRET_ACCESS_KEY')?.trim() ||
      this.config.get<string>('AWS_SECRET_ACCESS_KEY')?.trim();
    this.s3PublicBase = this.config.get<string>('S3_PUBLIC_BASE_URL')?.replace(/\/+$/, '') || undefined;

    if (this.s3Bucket && accessKey && secret && this.s3PublicBase) {
      const endpoint = this.config.get<string>('S3_ENDPOINT')?.trim() || undefined;
      const forcePath =
        this.config.get<string>('S3_FORCE_PATH_STYLE') === '1' ||
        this.config.get<string>('S3_FORCE_PATH_STYLE') === 'true';
      this.s3Client = new S3Client({
        region: this.config.get<string>('S3_REGION')?.trim() || 'ru-central1',
        endpoint: endpoint || undefined,
        credentials: { accessKeyId: accessKey, secretAccessKey: secret },
        forcePathStyle: forcePath,
      });
    } else {
      this.s3Client = null;
      if (!this.isS3Ready()) {
        this.logger.log(
          'S3 не задан полностью — при NODE_ENV≠production загрузки пойдут в локальную папку (.data/local-uploads), см. LOCAL_UPLOADS_* в .env.example',
        );
      }
    }
  }

  isS3Ready(): boolean {
    return this.s3Client !== null && !!this.s3Bucket && !!this.s3PublicBase;
  }

  /** Локальные файлы: явно LOCAL_UPLOADS_ENABLED=1 или dev при отсутствии S3 */
  usesLocalDisk(): boolean {
    const v = (this.config.get<string>('LOCAL_UPLOADS_ENABLED') || '').toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes') return true;
    if (v === '0' || v === 'false' || v === 'no') return false;
    const env = this.config.get<string>('NODE_ENV') || 'development';
    if (env === 'production') return false;
    return !this.isS3Ready();
  }

  localUploadRoot(): string {
    return (
      this.config.get<string>('LOCAL_UPLOADS_DIR')?.trim() ||
      join(process.cwd(), '.data', 'local-uploads')
    );
  }

  /** Публичный origin API (для URL в БД), без завершающего / */
  localPublicBase(): string {
    const fromEnv = this.config.get<string>('LOCAL_UPLOADS_PUBLIC_URL')?.trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const port = this.config.get('PORT') ?? 3001;
    return `http://127.0.0.1:${port}`;
  }

  assertImage(file: { size: number; mimetype: string }): void {
    if (!ALLOWED.has(file.mimetype)) {
      throw new BadRequestException('Допустимы только JPEG, PNG, WebP или GIF');
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException('Файл больше 6 МБ');
    }
  }

  async uploadCategoryBackground(buffer: Buffer, mimetype: string): Promise<{ url: string; key: string }> {
    const ext = MIME_EXT[mimetype] ?? '.bin';
    const key = `categories/bg/${Date.now()}-${randomBytes(6).toString('base64url')}${ext}`;

    if (this.isS3Ready()) {
      await this.s3Client!.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket!,
          Key: key,
          Body: buffer,
          ContentType: mimetype,
        }),
      );
      const url = `${this.s3PublicBase}/${key.replace(/^\/+/, '')}`;
      return { url, key };
    }

    if (this.usesLocalDisk()) {
      const root = this.localUploadRoot();
      const fullPath = join(root, key);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, buffer);
      const url = `${this.localPublicBase()}/uploads/${key.replace(/^\/+/, '')}`;
      this.logger.debug(`Local upload: ${fullPath} → ${url}`);
      return { url, key };
    }

    throw new ServiceUnavailableException(
      'Хранилище не настроено. Укажите S3 (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL) или включите локальные файлы: LOCAL_UPLOADS_ENABLED=1 и LOCAL_UPLOADS_DIR, LOCAL_UPLOADS_PUBLIC_URL (на проде за reverse-proxy). В development без S3 локальная папка включается автоматически — убедитесь, что API отдаёт /uploads (см. main.ts).',
    );
  }
}
