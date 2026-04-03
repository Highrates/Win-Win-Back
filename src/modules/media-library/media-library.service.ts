import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaLibraryCategory, Prisma } from '@prisma/client';
import imageSize from 'image-size';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';

const CYR_TO_LAT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function transliterateRu(input: string): string {
  return [...input.toLowerCase()].map((ch) => CYR_TO_LAT[ch] ?? ch).join('');
}

function slugifySegment(name: string): string {
  const raw = transliterateRu(name)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return raw || 'folder';
}

const CATEGORY_BG_FOLDER_PATH_KEY = 'category-backgrounds';

@Injectable()
export class MediaLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  private async getOrCreateCategoryBackgroundFolderId(): Promise<string> {
    const existing = await this.prisma.mediaFolder.findFirst({
      where: { pathKey: CATEGORY_BG_FOLDER_PATH_KEY },
    });
    if (existing) return existing.id;
    const row = await this.prisma.mediaFolder.create({
      data: {
        name: 'Фоны категорий',
        slugSegment: CATEGORY_BG_FOLDER_PATH_KEY,
        parentId: null,
        pathKey: CATEGORY_BG_FOLDER_PATH_KEY,
      },
    });
    return row.id;
  }

  /**
   * Загрузка фона категории через тот же слой, что и медиатека (ключ objects/…, запись MediaObject).
   */
  async ingestCategoryBackgroundImage(
    file: Express.Multer.File,
  ): Promise<{ url: string; mediaObjectId: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('Файл не передан');
    this.storage.assertImage({ size: file.size, mimetype: file.mimetype });
    const folderId = await this.getOrCreateCategoryBackgroundFolderId();
    const originalName = file.originalname || 'background.jpg';
    const ext = this.storage.libraryFileExtension(file.mimetype, originalName);
    const objectKey = `objects/${CATEGORY_BG_FOLDER_PATH_KEY}/${randomBytes(12).toString('hex')}${ext}`;
    await this.storage.uploadMediaLibraryObject(file.buffer, file.mimetype, objectKey, originalName);

    const category = MediaLibraryCategory.IMAGE;
    const dims = this.probeImageDims(file.buffer);

    const row = await this.prisma.mediaObject.create({
      data: {
        storageKey: objectKey,
        originalName,
        mimeType: file.mimetype,
        category,
        byteSize: file.size,
        width: dims.width ?? null,
        height: dims.height ?? null,
        folderId,
      },
    });
    return {
      url: this.storage.getPublicUrlForKey(row.storageKey),
      mediaObjectId: row.id,
    };
  }

  /**
   * Удалить файл и строку MediaObject, если ни одна категория не ссылается на этот id.
   */
  async deleteMediaObjectIfUnreferenced(id: string): Promise<void> {
    const refs = await this.prisma.category.count({ where: { backgroundMediaObjectId: id } });
    if (refs > 0) return;
    const row = await this.prisma.mediaObject.findUnique({ where: { id } });
    if (!row) return;
    await this.storage.removeObjectKey(row.storageKey);
    await this.prisma.mediaObject.delete({ where: { id } });
  }

  /**
   * Удалить объекты в бакете/локально под prefix, которых нет в MediaObject (медиатека).
   */
  async sweepOrphanObjectKeysUnderPrefix(
    prefix: string,
  ): Promise<{ scanned: number; deleted: number }> {
    const p = prefix.replace(/^\/+/, '');
    const listed = await this.storage.listObjectKeysWithPrefix(p);
    const inDb = new Set(
      (
        await this.prisma.mediaObject.findMany({
          select: { storageKey: true },
        })
      ).map((r) => r.storageKey),
    );
    let deleted = 0;
    for (const key of listed) {
      if (!inDb.has(key)) {
        await this.storage.removeObjectKey(key);
        deleted += 1;
      }
    }
    return { scanned: listed.length, deleted };
  }

  private classifyCategory(mimetype: string, originalName: string): MediaLibraryCategory {
    const imageOk = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const docOk = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/plain',
    ]);
    const videoOk = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
    if (imageOk.has(mimetype)) return MediaLibraryCategory.IMAGE;
    if (docOk.has(mimetype)) return MediaLibraryCategory.DOCUMENT;
    if (videoOk.has(mimetype)) return MediaLibraryCategory.VIDEO;
    if (mimetype === 'model/gltf-binary' || mimetype === 'model/gltf+json') {
      return MediaLibraryCategory.MODEL;
    }
    if (mimetype === 'application/octet-stream' && /\.(glb|gltf|obj|fbx|stl|usdz)$/i.test(originalName)) {
      return MediaLibraryCategory.MODEL;
    }
    return MediaLibraryCategory.OTHER;
  }

  private probeImageDims(buffer: Buffer): { width?: number; height?: number } {
    try {
      const r = imageSize(buffer);
      if (r.width && r.height) return { width: r.width, height: r.height };
    } catch {
      /* not a raster image */
    }
    return {};
  }

  async listFolders() {
    return this.prisma.mediaFolder.findMany({
      orderBy: [{ pathKey: 'asc' }],
      include: { _count: { select: { objects: true, children: true } } },
    });
  }

  async createFolder(name: string, parentId?: string | null) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Название папки не может быть пустым');

    let base = slugifySegment(trimmed);
    let parentPath = '';
    if (parentId) {
      const parent = await this.prisma.mediaFolder.findUnique({ where: { id: parentId } });
      if (!parent) throw new BadRequestException('Родительская папка не найдена');
      parentPath = parent.pathKey;
    }

    let slug = base;
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? slug : `${base}-${n}`;
      const pathKey = parentPath ? `${parentPath}/${candidate}` : candidate;
      const taken = await this.prisma.mediaFolder.findUnique({ where: { pathKey } });
      if (!taken) {
        return this.prisma.mediaFolder.create({
          data: {
            name: trimmed,
            slugSegment: candidate,
            parentId: parentId ?? null,
            pathKey,
          },
        });
      }
      n += 1;
      if (n > 200) throw new ConflictException('Не удалось подобрать имя папки');
    }
  }

  async deleteFolder(id: string) {
    const row = await this.prisma.mediaFolder.findUnique({
      where: { id },
      include: { _count: { select: { children: true, objects: true } } },
    });
    if (!row) throw new NotFoundException('Папка не найдена');
    if (row._count.children > 0) {
      throw new BadRequestException('Сначала удалите или перенесите вложенные папки');
    }
    if (row._count.objects > 0) {
      throw new BadRequestException('В папке есть объекты — перенесите или удалите их');
    }
    await this.prisma.mediaFolder.delete({ where: { id } });
    return { ok: true as const };
  }

  async listObjects(params: {
    q?: string;
    tab?: 'all' | 'images' | 'documents' | 'models' | 'videos';
    folderId?: string;
  }) {
    const where: Prisma.MediaObjectWhereInput = {};
    if (params.folderId) where.folderId = params.folderId;
    const q = params.q?.trim();
    if (q) {
      where.OR = [
        { originalName: { contains: q, mode: 'insensitive' } },
        { altText: { contains: q, mode: 'insensitive' } },
      ];
    }
    const tab = params.tab ?? 'all';
    if (tab === 'images') where.category = MediaLibraryCategory.IMAGE;
    else if (tab === 'documents') where.category = MediaLibraryCategory.DOCUMENT;
    else if (tab === 'models') where.category = MediaLibraryCategory.MODEL;
    else if (tab === 'videos') where.category = MediaLibraryCategory.VIDEO;

    const rows = await this.prisma.mediaObject.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { folder: { select: { id: true, name: true, pathKey: true } } },
      take: 200,
    });
    return rows.map((r) => ({
      ...r,
      publicUrl: this.storage.getPublicUrlForKey(r.storageKey),
    }));
  }

  async getObject(id: string) {
    const row = await this.prisma.mediaObject.findUnique({
      where: { id },
      include: { folder: { select: { id: true, name: true, pathKey: true } } },
    });
    if (!row) throw new NotFoundException('Объект не найден');
    return {
      ...row,
      publicUrl: this.storage.getPublicUrlForKey(row.storageKey),
    };
  }

  async updateObject(
    id: string,
    dto: { originalName?: string; altText?: string | null; folderId?: string | null },
  ) {
    const row = await this.prisma.mediaObject.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Объект не найден');

    if (dto.originalName !== undefined) {
      const t = dto.originalName.trim();
      if (!t) throw new BadRequestException('Имя файла не может быть пустым');
    }

    let nextKey = row.storageKey;
    if (dto.folderId !== undefined) {
      const newFolderId = dto.folderId;
      if (newFolderId !== row.folderId) {
        let pathPrefix = 'uncategorized';
        if (newFolderId) {
          const f = await this.prisma.mediaFolder.findUnique({ where: { id: newFolderId } });
          if (!f) throw new BadRequestException('Папка не найдена');
          pathPrefix = f.pathKey;
        }
        const ext = row.storageKey.match(/(\.[a-z0-9]+)$/i)?.[0] ?? '';
        const newKey = `objects/${pathPrefix}/${randomBytes(12).toString('hex')}${ext}`;
        await this.storage.copyObjectKey(row.storageKey, newKey);
        await this.storage.removeObjectKey(row.storageKey);
        nextKey = newKey;
      }
    }

    return this.prisma.mediaObject.update({
      where: { id },
      data: {
        ...(dto.originalName !== undefined
          ? { originalName: dto.originalName.trim() }
          : {}),
        ...(dto.altText !== undefined ? { altText: dto.altText?.trim() || null } : {}),
        ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}),
        ...(nextKey !== row.storageKey ? { storageKey: nextKey } : {}),
      },
      include: { folder: { select: { id: true, name: true, pathKey: true } } },
    }).then((r) => ({
      ...r,
      publicUrl: this.storage.getPublicUrlForKey(r.storageKey),
    }));
  }

  async uploadObject(file: Express.Multer.File, folderId?: string | null) {
    if (!file?.buffer?.length) throw new BadRequestException('Файл не передан');
    const originalName = file.originalname || 'file';
    let pathPrefix = 'uncategorized';
    if (folderId) {
      const f = await this.prisma.mediaFolder.findUnique({ where: { id: folderId } });
      if (!f) throw new BadRequestException('Папка не найдена');
      pathPrefix = f.pathKey;
    }
    const ext = this.storage.libraryFileExtension(file.mimetype, originalName);
    const objectKey = `objects/${pathPrefix}/${randomBytes(12).toString('hex')}${ext}`;
    await this.storage.uploadMediaLibraryObject(file.buffer, file.mimetype, objectKey, originalName);

    const category = this.classifyCategory(file.mimetype, originalName);
    const dims = category === MediaLibraryCategory.IMAGE ? this.probeImageDims(file.buffer) : {};

    return this.prisma.mediaObject.create({
      data: {
        storageKey: objectKey,
        originalName,
        mimeType: file.mimetype,
        category,
        byteSize: file.size,
        width: dims.width ?? null,
        height: dims.height ?? null,
        folderId: folderId ?? null,
      },
      include: { folder: { select: { id: true, name: true, pathKey: true } } },
    }).then((r) => ({
      ...r,
      publicUrl: this.storage.getPublicUrlForKey(r.storageKey),
    }));
  }

  async deleteObject(id: string) {
    const row = await this.prisma.mediaObject.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Объект не найден');
    const catRefs = await this.prisma.category.count({ where: { backgroundMediaObjectId: id } });
    if (catRefs > 0) {
      throw new BadRequestException(
        'Объект используется как фон категории — сначала смените фон в каталоге',
      );
    }
    await this.storage.removeObjectKey(row.storageKey);
    await this.prisma.mediaObject.delete({ where: { id } });
    return { ok: true as const };
  }
}
