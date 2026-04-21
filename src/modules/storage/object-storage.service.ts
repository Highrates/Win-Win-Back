import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';
import { copyFile, mkdir, readdir, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Rich text editor: те же типы, отдельный префикс в бакете */
const RICH_IMAGE_MAX = 6 * 1024 * 1024;
const RICH_VIDEO_MAX = 100 * 1024 * 1024;
const RICH_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const LIBRARY_MAX_BYTES = 100 * 1024 * 1024;
const LIBRARY_DOC = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain',
]);
const MODEL_3D_EXT = /\.(glb|gltf|obj|fbx|stl|usdz)$/i;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'text/plain': '.txt',
  'model/gltf-binary': '.glb',
  'model/gltf+json': '.gltf',
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

  /**
   * В монорепо Nest иногда запускают из `backend/`, иногда из корня.
   * Чтобы ссылки из БД не ломались между перезапусками, по умолчанию используем
   * ЕДИНЫЙ каталог `<repo-root>/backend/.data/local-uploads`.
   */
  private repoRootDir(): string {
    const cwd = process.cwd().replace(/\/+$/, '');
    return cwd.endsWith('/backend') ? join(cwd, '..') : cwd;
  }

  private backendRootDir(): string {
    const cwd = process.cwd().replace(/\/+$/, '');
    return cwd.endsWith('/backend') ? cwd : join(this.repoRootDir(), 'backend');
  }

  localUploadRoot(): string {
    return (
      this.config.get<string>('LOCAL_UPLOADS_DIR')?.trim() ||
      join(this.backendRootDir(), '.data', 'local-uploads')
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

  /**
   * Медиатека админки: изображения, документы, 3D (по MIME или расширению), видео как в rich-upload.
   */
  assertLibraryFile(file: { size: number; mimetype: string; originalname?: string }): void {
    if (file.size > LIBRARY_MAX_BYTES) {
      throw new BadRequestException('Файл больше 100 МБ');
    }
    const m = file.mimetype;
    if (ALLOWED.has(m)) return;
    if (LIBRARY_DOC.has(m)) return;
    if (RICH_VIDEO_TYPES.has(m)) return;
    if (m === 'model/gltf-binary' || m === 'model/gltf+json') return;
    const name = file.originalname ?? '';
    if (m === 'application/octet-stream' && MODEL_3D_EXT.test(name)) return;
    throw new BadRequestException(
      'Недопустимый тип файла. Разрешены: изображения (JPEG/PNG/WebP/GIF), PDF и офисные документы, MP4/WebM/MOV, GLB/GLTF/OBJ/FBX/STL и др.',
    );
  }

  libraryFileExtension(mimetype: string, originalName: string): string {
    if (MIME_EXT[mimetype]) return MIME_EXT[mimetype];
    const match = originalName.match(/(\.[a-z0-9]{1,8})$/i);
    return match ? match[1].toLowerCase() : '.bin';
  }

  getPublicUrlForKey(key: string): string {
    const k = key.replace(/^\/+/, '');
    if (this.isS3Ready()) {
      return `${this.s3PublicBase}/${k}`;
    }
    return `${this.localPublicBase()}/uploads/${k}`;
  }

  /**
   * Обратное к getPublicUrlForKey: извлечь ключ объекта из публичного URL нашего хранилища.
   */
  tryPublicUrlToKey(url: string): string | null {
    const u = url.trim();
    if (!u) return null;
    const s3Base = this.s3PublicBase?.replace(/\/+$/, '');
    if (this.isS3Ready() && s3Base && u.startsWith(`${s3Base}/`)) {
      return decodeURIComponent(u.slice(s3Base.length + 1));
    }
    const localBase = this.localPublicBase().replace(/\/+$/, '');
    const uploadsPrefix = `${localBase}/uploads/`;
    if (u.startsWith(uploadsPrefix)) {
      return decodeURIComponent(u.slice(uploadsPrefix.length));
    }
    return null;
  }

  /** Список ключей с префиксом (S3 ListObjectsV2 или обход локальной папки). */
  async listObjectKeysWithPrefix(prefix: string): Promise<string[]> {
    const normalized = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
    if (this.isS3Ready()) {
      const keys: string[] = [];
      let ContinuationToken: string | undefined;
      do {
        const out = await this.s3Client!.send(
          new ListObjectsV2Command({
            Bucket: this.s3Bucket!,
            Prefix: normalized,
            ContinuationToken,
          }),
        );
        for (const c of out.Contents ?? []) {
          if (c.Key && !c.Key.endsWith('/')) keys.push(c.Key);
        }
        ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return keys;
    }
    if (this.usesLocalDisk()) {
      const baseDir = join(this.localUploadRoot(), normalized);
      const keys: string[] = [];
      const walk = async (dir: string, relWithinPrefix: string): Promise<void> => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const ent of entries) {
          const p = join(dir, ent.name);
          const r = relWithinPrefix ? `${relWithinPrefix}/${ent.name}` : ent.name;
          if (ent.isDirectory()) await walk(p, r);
          else keys.push(`${normalized}/${r}`.replace(/\/+/g, '/'));
        }
      };
      await walk(baseDir, '');
      return keys;
    }
    return [];
  }

  async removeObjectKey(key: string): Promise<void> {
    const k = key.replace(/^\/+/, '');
    if (this.isS3Ready()) {
      await this.s3Client!.send(
        new DeleteObjectCommand({ Bucket: this.s3Bucket!, Key: k }),
      );
      return;
    }
    if (this.usesLocalDisk()) {
      const full = join(this.localUploadRoot(), k);
      try {
        await unlink(full);
      } catch {
        /* ignore */
      }
      return;
    }
    throw new ServiceUnavailableException('Хранилище не настроено');
  }

  async copyObjectKey(fromKey: string, toKey: string): Promise<void> {
    const from = fromKey.replace(/^\/+/, '');
    const to = toKey.replace(/^\/+/, '');
    if (this.isS3Ready()) {
      await this.s3Client!.send(
        new CopyObjectCommand({
          Bucket: this.s3Bucket!,
          Key: to,
          CopySource: `${this.s3Bucket}/${from}`,
        }),
      );
      return;
    }
    if (this.usesLocalDisk()) {
      const root = this.localUploadRoot();
      const src = join(root, from);
      const dest = join(root, to);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      return;
    }
    throw new ServiceUnavailableException('Хранилище не настроено');
  }

  async uploadMediaLibraryObject(
    buffer: Buffer,
    mimetype: string,
    objectKey: string,
    originalName: string,
  ): Promise<{ url: string; key: string }> {
    this.assertLibraryFile({
      size: buffer.length,
      mimetype,
      originalname: originalName,
    });
    const k = objectKey.replace(/^\/+/, '');
    if (!k.startsWith('objects/')) {
      throw new BadRequestException('Ключ объекта должен начинаться с objects/');
    }
    return this.putBuffer(k, buffer, mimetype);
  }

  assertRichMedia(file: { size: number; mimetype: string }, type: 'image' | 'video'): void {
    if (type === 'image') {
      if (!ALLOWED.has(file.mimetype)) {
        throw new BadRequestException('Изображение: только JPEG, PNG, WebP или GIF');
      }
      if (file.size > RICH_IMAGE_MAX) {
        throw new BadRequestException('Изображение не больше 6 МБ');
      }
      return;
    }
    if (!RICH_VIDEO_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Видео: только MP4, WebM или QuickTime (MOV)');
    }
    if (file.size > RICH_VIDEO_MAX) {
      throw new BadRequestException('Видео не больше 100 МБ');
    }
  }

  private async putBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<{ url: string; key: string }> {
    if (this.isS3Ready()) {
      await this.s3Client!.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket!,
          Key: key,
          Body: buffer,
          ContentType: contentType,
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

  /** Медиа для RichBlock (админка): публичные URL в HTML. */
  async uploadRichMedia(
    buffer: Buffer,
    mimetype: string,
    type: 'image' | 'video',
  ): Promise<{ url: string; key: string }> {
    this.assertRichMedia({ size: buffer.length, mimetype }, type);
    const ext = MIME_EXT[mimetype] ?? (type === 'video' ? '.mp4' : '.bin');
    const folder = type === 'image' ? 'rich/img' : 'rich/video';
    const key = `${folder}/${Date.now()}-${randomBytes(6).toString('base64url')}${ext}`;
    return this.putBuffer(key, buffer, mimetype);
  }

  async uploadBrandImage(
    buffer: Buffer,
    mimetype: string,
    kind: 'cover' | 'background' | 'gallery',
  ): Promise<{ url: string; key: string }> {
    const ext = MIME_EXT[mimetype] ?? '.bin';
    const folder =
      kind === 'cover' ? 'brands/cover' : kind === 'background' ? 'brands/bg' : 'brands/gallery';
    const key = `${folder}/${Date.now()}-${randomBytes(6).toString('base64url')}${ext}`;
    return this.putBuffer(key, buffer, mimetype);
  }

  /**
   * Галерея / цвета товара: только наш публичный URL (S3 или /uploads) или хост из PRODUCT_IMAGE_URL_HOST_WHITELIST.
   */
  assertProductImageUrlAllowed(url: string): void {
    const u = url.trim();
    if (!u) {
      throw new BadRequestException('Пустой URL изображения');
    }
    if (this.tryPublicUrlToKey(u)) {
      return;
    }
    let host: string;
    try {
      host = new URL(u).hostname.toLowerCase();
    } catch {
      throw new BadRequestException('Некорректный URL изображения');
    }
    const raw = this.config.get<string>('PRODUCT_IMAGE_URL_HOST_WHITELIST')?.trim();
    const allowed = (raw ? raw.split(/[,;\s]+/) : [])
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length === 0) {
      throw new BadRequestException(
        'URL изображения должен указывать на ваше хранилище (S3_PUBLIC_BASE_URL или локальные /uploads). Для сторонних CDN задайте PRODUCT_IMAGE_URL_HOST_WHITELIST.',
      );
    }
    if (allowed.includes(host)) {
      return;
    }
    throw new BadRequestException(
      `Домен изображения не разрешён (${host}). Добавьте его в PRODUCT_IMAGE_URL_HOST_WHITELIST или выберите файл из медиатеки.`,
    );
  }

  private isMediathekStorageDeleteOnProductImageRemovalEnabled(): boolean {
    const v = this.config.get<string>('PRODUCT_DELETE_MEDIATHEK_STORAGE_KEYS')?.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }

  /**
   * Удаление объектов в bucket по публичным URL (товар, блог и др.).
   * Ключи objects/… по умолчанию не трогаем (медиатека, общие ссылки), см. PRODUCT_DELETE_MEDIATHEK_STORAGE_KEYS.
   */
  async deleteStorageObjectsForRemovedUrls(urls: string[]): Promise<void> {
    const keys = new Set<string>();
    for (const url of urls) {
      const k = this.tryPublicUrlToKey(url.trim());
      if (k) keys.add(k);
    }
    const allowObjects = this.isMediathekStorageDeleteOnProductImageRemovalEnabled();
    for (const key of keys) {
      if (key.startsWith('objects/') && !allowObjects) {
        continue;
      }
      try {
        await this.removeObjectKey(key);
      } catch (e) {
        this.logger.warn(
          `Не удалось удалить объект ${key}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}
