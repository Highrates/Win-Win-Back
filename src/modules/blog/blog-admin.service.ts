import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { extractMediaUrlsFromRichHtml } from './blog-html.util';
import {
  BulkIdsDto,
  BulkSetPublishedDto,
  CreateBlogCategoryAdminDto,
  CreateBlogPostAdminDto,
  ReorderBlogPostsDto,
  UpdateBlogCategoryAdminDto,
  UpdateBlogPostAdminDto,
} from './dto/blog-admin.dto';

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

function slugifyFromTitle(title: string, fallback: string): string {
  const raw = transliterateRu(title.trim())
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return raw || fallback;
}

@Injectable()
export class BlogAdminService {
  private readonly logger = new Logger(BlogAdminService.name);

  constructor(
    private prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async listCategoriesAdmin() {
    const rows = await this.prisma.blogCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { posts: true } } },
    });
    return rows.map(({ _count, ...r }) => ({
      ...r,
      postCount: _count.posts,
    }));
  }

  async createCategory(dto: CreateBlogCategoryAdminDto) {
    const base = dto.slug?.trim() || slugifyFromTitle(dto.name, 'category');
    const slug = await this.ensureUniqueCategorySlug(base);
    const maxSort = await this.prisma.blogCategory.aggregate({ _max: { sortOrder: true } });
    const sortOrder = dto.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1;
    return this.prisma.blogCategory.create({
      data: { name: dto.name.trim(), slug, sortOrder },
    });
  }

  async updateCategory(id: string, dto: UpdateBlogCategoryAdminDto) {
    const row = await this.prisma.blogCategory.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Категория не найдена');
    const data: Prisma.BlogCategoryUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.slug?.trim()) {
      data.slug = await this.ensureUniqueCategorySlug(dto.slug.trim(), id);
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    return this.prisma.blogCategory.update({ where: { id }, data });
  }

  async deleteCategory(id: string) {
    const row = await this.prisma.blogCategory.findUnique({
      where: { id },
      include: { _count: { select: { posts: true } } },
    });
    if (!row) throw new NotFoundException('Категория не найдена');
    if (row._count.posts > 0) {
      throw new BadRequestException('Нельзя удалить категорию со статьями');
    }
    await this.prisma.blogCategory.delete({ where: { id } });
    return { ok: true };
  }

  async listPostsAdmin(params: {
    q?: string;
    categoryId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(Math.max(1, params.limit ?? 20), 100);
    const q = params.q?.trim();
    const and: Prisma.BlogPostWhereInput[] = [];
    if (params.categoryId?.trim()) {
      and.push({ categoryId: params.categoryId.trim() });
    }
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { excerpt: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.BlogPostWhereInput = and.length ? { AND: and } : {};
    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: [
          { sortOrder: 'asc' },
          { publishedAt: 'desc' },
          { createdAt: 'desc' },
        ] as unknown as Prisma.BlogPostOrderByWithRelationInput[],
        skip: (page - 1) * limit,
        take: limit,
        include: { category: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getPostAdmin(id: string) {
    const row = await this.prisma.blogPost.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!row) throw new NotFoundException('Статья не найдена');
    return row;
  }

  async createPost(dto: CreateBlogPostAdminDto, authorId?: string | null) {
    const baseSlug = dto.slug?.trim() || slugifyFromTitle(dto.title, 'post');
    const slug = await this.ensureUniquePostSlug(baseSlug);
    const categoryId = this.normalizeCategoryId(dto.categoryId);
    if (categoryId) {
      const c = await this.prisma.blogCategory.findUnique({ where: { id: categoryId } });
      if (!c) throw new BadRequestException('Категория не найдена');
    }
    const publishedAt = this.parsePublishedAt(dto.publishedAt) ?? new Date();
    const isPublished = dto.isPublished ?? false;
    this.assertBlogCoverUrlAllowed(dto.coverUrl);
    this.assertBlogBodyMediaUrlsAllowed(dto.body);
    const maxSort = await this.prisma.blogPost.aggregate({ _max: { sortOrder: true } });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
    return this.prisma.blogPost.create({
      data: {
        title: dto.title.trim(),
        slug,
        categoryId,
        excerpt: dto.excerpt?.trim() || null,
        body: dto.body,
        isPublished,
        publishedAt,
        coverUrl: dto.coverUrl?.trim() || null,
        authorId: authorId ?? null,
        sortOrder,
      },
      include: { category: true },
    });
  }

  async updatePost(id: string, dto: UpdateBlogPostAdminDto) {
    const row = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Статья не найдена');
    let slug = row.slug;
    if (dto.slug?.trim()) {
      slug = await this.ensureUniquePostSlug(dto.slug.trim(), id);
    }
    let categoryId: string | null | undefined = undefined;
    if (dto.categoryId !== undefined) {
      categoryId = this.normalizeCategoryId(dto.categoryId);
      if (categoryId) {
        const c = await this.prisma.blogCategory.findUnique({ where: { id: categoryId } });
        if (!c) throw new BadRequestException('Категория не найдена');
      }
    }
    let publishedAt: Date | null | undefined = undefined;
    if (dto.publishedAt !== undefined) {
      if (dto.publishedAt === null || (typeof dto.publishedAt === 'string' && !dto.publishedAt.trim())) {
        publishedAt = null;
      } else {
        publishedAt = this.parsePublishedAt(String(dto.publishedAt));
      }
    }
    const resolvedNextCover =
      dto.coverUrl !== undefined ? (dto.coverUrl?.trim() ? dto.coverUrl.trim() : null) : row.coverUrl;
    const resolvedNextBody = dto.body != null ? dto.body : row.body;
    if (dto.coverUrl !== undefined) {
      this.assertBlogCoverUrlAllowed(dto.coverUrl === null ? null : dto.coverUrl);
    }
    if (dto.body != null) {
      this.assertBlogBodyMediaUrlsAllowed(dto.body);
    }
    const urlsToRemoveStorage = this.diffBlogPostStorageUrlsToRemove(
      { coverUrl: row.coverUrl, body: row.body },
      { coverUrl: resolvedNextCover, body: resolvedNextBody },
    );
    const updated = await this.prisma.blogPost.update({
      where: { id },
      data: {
        ...(dto.title != null ? { title: dto.title.trim() } : {}),
        slug,
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(dto.excerpt !== undefined ? { excerpt: dto.excerpt?.trim() || null } : {}),
        ...(dto.body != null ? { body: dto.body } : {}),
        ...(dto.isPublished !== undefined ? { isPublished: dto.isPublished } : {}),
        ...(publishedAt !== undefined ? { publishedAt } : {}),
        ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl?.trim() || null } : {}),
      },
      include: { category: true },
    });
    if (urlsToRemoveStorage.length) {
      this.scheduleBlogPostStorageCleanup(urlsToRemoveStorage);
    }
    return updated;
  }

  async deletePost(id: string) {
    const row = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Статья не найдена');
    const urls = this.collectStorageUrlsForBlogPost(row.coverUrl, row.body);
    await this.prisma.blogPost.delete({ where: { id } });
    if (urls.length) this.scheduleBlogPostStorageCleanup(urls);
    return { ok: true };
  }

  async bulkDeletePosts(dto: BulkIdsDto) {
    if (!dto.ids.length) return { deleted: [] as string[] };
    const rows = await this.prisma.blogPost.findMany({
      where: { id: { in: dto.ids } },
      select: { coverUrl: true, body: true },
    });
    const urlSet = new Set<string>();
    for (const r of rows) {
      for (const u of this.collectStorageUrlsForBlogPost(r.coverUrl, r.body)) {
        urlSet.add(u);
      }
    }
    await this.prisma.blogPost.deleteMany({ where: { id: { in: dto.ids } } });
    if (urlSet.size) this.scheduleBlogPostStorageCleanup([...urlSet]);
    return { deleted: dto.ids };
  }

  async bulkSetPublished(dto: BulkSetPublishedDto) {
    if (!dto.ids.length) return { updated: 0 };
    const res = await this.prisma.blogPost.updateMany({
      where: { id: { in: dto.ids } },
      data: { isPublished: dto.isPublished },
    });
    return { updated: res.count };
  }

  async reorderPosts(dto: ReorderBlogPostsDto) {
    const orderedIds = dto.orderedIds;
    const unique = new Set(orderedIds);
    if (unique.size !== orderedIds.length) {
      throw new BadRequestException('В порядке не должно быть дубликатов id');
    }
    const total = await this.prisma.blogPost.count();
    if (orderedIds.length !== total) {
      throw new BadRequestException('Порядок должен включать все статьи блога');
    }
    const found = await this.prisma.blogPost.findMany({
      where: { id: { in: orderedIds } },
      select: { id: true },
    });
    if (found.length !== total) {
      throw new BadRequestException('Неизвестный id статьи');
    }
    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.blogPost.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
    return { ok: true as const };
  }

  private assertBlogCoverUrlAllowed(url: string | null | undefined): void {
    if (url == null) return;
    const t = String(url).trim();
    if (!t) return;
    this.objectStorage.assertProductImageUrlAllowed(t);
  }

  private assertBlogBodyMediaUrlsAllowed(html: string): void {
    for (const u of extractMediaUrlsFromRichHtml(html)) {
      this.objectStorage.assertProductImageUrlAllowed(u);
    }
  }

  private collectStorageUrlsForBlogPost(coverUrl: string | null, body: string): string[] {
    const out: string[] = [];
    const c = coverUrl?.trim();
    if (c) out.push(c);
    out.push(...extractMediaUrlsFromRichHtml(body));
    return out;
  }

  private diffBlogPostStorageUrlsToRemove(
    prev: { coverUrl: string | null; body: string },
    next: { coverUrl: string | null; body: string },
  ): string[] {
    const out: string[] = [];
    const prevCover = prev.coverUrl?.trim() ?? '';
    const nextCover = next.coverUrl?.trim() ?? '';
    if (prevCover && prevCover !== nextCover) out.push(prevCover);
    const prevM = new Set(extractMediaUrlsFromRichHtml(prev.body));
    const nextM = new Set(extractMediaUrlsFromRichHtml(next.body));
    for (const u of prevM) {
      if (!nextM.has(u)) out.push(u);
    }
    return out;
  }

  private scheduleBlogPostStorageCleanup(urls: string[]): void {
    if (!urls.length) return;
    void this.objectStorage
      .deleteStorageObjectsForRemovedUrls(urls)
      .catch((e) =>
        this.logger.warn(
          `Очистка S3 после статьи блога: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  }

  private normalizeCategoryId(raw: string | null | undefined): string | null {
    if (raw == null || raw === '') return null;
    const t = String(raw).trim();
    return t || null;
  }

  private parsePublishedAt(raw: string | null | undefined): Date | null {
    if (raw == null || String(raw).trim() === '') return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Некорректная дата');
    return d;
  }

  private async ensureUniqueCategorySlug(base: string, excludeId?: string): Promise<string> {
    let slug = base;
    let n = 0;
    while (true) {
      const clash = await this.prisma.blogCategory.findFirst({
        where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      });
      if (!clash) return slug;
      n += 1;
      slug = `${base}-${n}`;
    }
  }

  private async ensureUniquePostSlug(base: string, excludeId?: string): Promise<string> {
    let slug = base;
    let n = 0;
    while (true) {
      const clash = await this.prisma.blogPost.findFirst({
        where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      });
      if (!clash) return slug;
      n += 1;
      slug = `${base}-${n}`;
    }
  }
}
