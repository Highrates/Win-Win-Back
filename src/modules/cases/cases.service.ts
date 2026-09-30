import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaLibraryService } from '../media-library/media-library.service';
import { sanitizeProfileAboutHtml } from '../blog/blog-html.util';
import { AuditService } from '../audit/audit.service';
import { ProductSearchIndexService } from '../../meilisearch/product-search-index.service';
import { StaffAccessService } from '../staff/staff-access.service';

function parseStringArray(v: unknown, max: number): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, max);
}

/** URL в img / video / source внутри descriptionHtml (S3, не data:). */
function extractMediaSrcUrlsFromHtml(html: string | null | undefined): string[] {
  if (!html?.trim()) return [];
  const out = new Set<string>();
  for (const re of [
    /<img\b[^>]*?\bsrc=["']([^"']+)["']/gi,
    /<video\b[^>]*?\bsrc=["']([^"']+)["']/gi,
    /<source\b[^>]*?\bsrc=["']([^"']+)["']/gi,
  ]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const u = m[1]?.trim();
      if (u && (u.startsWith('http://') || u.startsWith('https://')) && !u.startsWith('data:')) {
        out.add(u);
      }
    }
  }
  return [...out];
}

function coverUrlsFromDb(raw: unknown): string[] {
  return parseStringArray(raw, 2);
}

function referencedUrlsFromCase(row: {
  coverImageUrls: Prisma.JsonValue;
  descriptionHtml: string | null;
}): string[] {
  return [...coverUrlsFromDb(row.coverImageUrls), ...extractMediaSrcUrlsFromHtml(row.descriptionHtml)];
}

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaLibraryService,
    private readonly audit: AuditService,
    private readonly productSearchIndex: ProductSearchIndexService,
    private readonly staffAccess: StaffAccessService,
  ) {}

  private async filterExistingProductIds(ids: string[]): Promise<string[]> {
    const uq = [...new Set(ids.map((x) => x.trim()).filter(Boolean))].slice(0, 80);
    if (!uq.length) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: uq }, isActive: true },
      select: { id: true },
    });
    const ok = new Set(rows.map((r) => r.id));
    return uq.filter((id) => ok.has(id));
  }

  /** Синхронизирует `CaseProduct` и `Product.casesLinkedCount` с массивом id из кейса. */
  private async syncCaseProductLinks(caseId: string, desiredRaw: string[]): Promise<void> {
    const validNew = await this.filterExistingProductIds(desiredRaw);
    const newSet = new Set(validNew);

    const existingRows = await this.prisma.caseProduct.findMany({
      where: { caseId },
      select: { productId: true },
    });
    const oldSet = new Set(existingRows.map((r) => r.productId));

    const toRemove = [...oldSet].filter((id) => !newSet.has(id));
    const toAdd = [...newSet].filter((id) => !oldSet.has(id));
    if (!toRemove.length && !toAdd.length) return;

    const affected = [...new Set([...toRemove, ...toAdd])];

    await this.prisma.$transaction(async (tx) => {
      for (const pid of toRemove) {
        await tx.caseProduct.delete({
          where: { caseId_productId: { caseId, productId: pid } },
        });
        await tx.product.update({
          where: { id: pid },
          data: { casesLinkedCount: { decrement: 1 } },
        });
      }
      for (const pid of toAdd) {
        await tx.caseProduct.create({ data: { caseId, productId: pid } });
        await tx.product.update({
          where: { id: pid },
          data: { casesLinkedCount: { increment: 1 } },
        });
      }
    });

    for (const pid of affected) {
      await this.productSearchIndex.syncProduct(pid);
    }
  }

  private parseProductIdsFromCaseJson(raw: Prisma.JsonValue | null | undefined): string[] {
    return parseStringArray(raw, 80);
  }

  /** Перед удалением кейса снимаем связи и уменьшаем счётчики товаров. */
  private async detachCaseProductsBeforeDelete(caseId: string): Promise<void> {
    const links = await this.prisma.caseProduct.findMany({
      where: { caseId },
      select: { productId: true },
    });
    const pids = [...new Set(links.map((l) => l.productId))];
    if (!pids.length) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.caseProduct.deleteMany({ where: { caseId } });
      for (const pid of pids) {
        await tx.product.update({
          where: { id: pid },
          data: { casesLinkedCount: { decrement: 1 } },
        });
      }
    });

    for (const pid of pids) {
      await this.productSearchIndex.syncProduct(pid);
    }
  }

  private async assertPartnerDesigner(userId: string): Promise<void> {
    const p = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { winWinPartnerApproved: true },
    });
    if (!p?.winWinPartnerApproved) {
      throw new ForbiddenException('Доступно только партнёрам Wupapa');
    }
  }

  async listMyCases(userId: string, opts?: { q?: string }) {
    await this.assertPartnerDesigner(userId);
    const q = opts?.q?.trim() ?? '';
    return this.prisma.case.findMany({
      where: {
        userId,
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { shortDescription: { contains: q, mode: 'insensitive' } },
                { location: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyCase(userId: string, id: string) {
    await this.assertPartnerDesigner(userId);
    const row = await this.prisma.case.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Кейс не найден');
    return row;
  }

  async createMyCase(
    userId: string,
    dto: {
      title: string;
      shortDescription?: string | null;
      location?: string | null;
      year?: number | null;
      budget?: string | null;
      descriptionHtml?: string | null;
      coverLayout?: '4:3' | '16:9' | '9:16' | null;
      coverImageUrls?: string[] | null;
      roomTypes?: string[] | null;
      productIds?: string[] | null;
    },
  ) {
    await this.assertPartnerDesigner(userId);

    const title = dto.title.trim();
    if (!title) throw new BadRequestException('Введите название кейса');

    const descriptionHtml =
      dto.descriptionHtml == null || String(dto.descriptionHtml).trim() === ''
        ? null
        : sanitizeProfileAboutHtml(dto.descriptionHtml);

    const coverLayout = dto.coverLayout ?? null;
    const coverImageUrls = dto.coverImageUrls ? dto.coverImageUrls.map((x) => x.trim()).filter(Boolean) : null;
    const roomTypes = dto.roomTypes ? dto.roomTypes.map((x) => x.trim()).filter(Boolean) : null;
    const productIds = dto.productIds ? parseStringArray(dto.productIds, 80) : null;

    const created = await this.prisma.case.create({
      data: {
        userId,
        title,
        shortDescription: dto.shortDescription?.trim() || null,
        location: dto.location?.trim() || null,
        year: dto.year ?? null,
        budget: dto.budget?.trim() || null,
        descriptionHtml,
        coverLayout,
        coverImageUrls: coverImageUrls == null ? Prisma.JsonNull : coverImageUrls,
        roomTypes: roomTypes == null ? Prisma.JsonNull : roomTypes,
        productIds: productIds == null ? Prisma.JsonNull : productIds,
        isPublished: true,
      },
    });
    await this.syncCaseProductLinks(created.id, productIds ?? []);
    return created;
  }

  async updateMyCase(
    userId: string,
    id: string,
    dto: {
      title?: string;
      shortDescription?: string | null;
      location?: string | null;
      year?: number | null;
      budget?: string | null;
      descriptionHtml?: string | null;
      coverLayout?: '4:3' | '16:9' | '9:16' | null;
      coverImageUrls?: string[] | null;
      roomTypes?: string[] | null;
      productIds?: string[] | null;
    },
  ) {
    await this.assertPartnerDesigner(userId);

    const before = await this.prisma.case.findFirst({
      where: { id, userId },
      select: { id: true, coverImageUrls: true, descriptionHtml: true },
    });
    if (!before) throw new NotFoundException('Кейс не найден');
    const beforeUrls = referencedUrlsFromCase(before);

    const patch: Prisma.CaseUpdateInput = {};
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) throw new BadRequestException('Введите название кейса');
      patch.title = t;
    }
    if (dto.shortDescription !== undefined) patch.shortDescription = dto.shortDescription?.trim() || null;
    if (dto.location !== undefined) patch.location = dto.location?.trim() || null;
    if (dto.year !== undefined) patch.year = dto.year ?? null;
    if (dto.budget !== undefined) patch.budget = dto.budget?.trim() || null;
    if (dto.coverLayout !== undefined) patch.coverLayout = dto.coverLayout ?? null;
    if (dto.coverImageUrls !== undefined) {
      const list = dto.coverImageUrls ? dto.coverImageUrls.map((x) => x.trim()).filter(Boolean) : null;
      patch.coverImageUrls = list == null ? Prisma.JsonNull : list;
    }
    if (dto.roomTypes !== undefined) {
      const list = dto.roomTypes ? dto.roomTypes.map((x) => x.trim()).filter(Boolean) : null;
      patch.roomTypes = list == null ? Prisma.JsonNull : list;
    }
    if (dto.productIds !== undefined) {
      const list = dto.productIds ? parseStringArray(dto.productIds, 80) : null;
      patch.productIds = list == null ? Prisma.JsonNull : list;
    }
    if (dto.descriptionHtml !== undefined) {
      patch.descriptionHtml =
        dto.descriptionHtml == null || String(dto.descriptionHtml).trim() === ''
          ? null
          : sanitizeProfileAboutHtml(dto.descriptionHtml);
    }

    const updated = await this.prisma.case.update({ where: { id }, data: patch });
    await this.syncCaseProductLinks(id, this.parseProductIdsFromCaseJson(updated.productIds));

    const afterUrls = referencedUrlsFromCase(updated);

    // best-effort: почистить медиа, которые больше не используются ни в кейсе, ни где-либо ещё.
    const afterSet = new Set(afterUrls);
    for (const u of beforeUrls) {
      if (!afterSet.has(u)) {
        this.media.tryDeleteObjectByPublicUrlIfUnreferenced(u).catch(() => undefined);
      }
    }

    return updated;
  }

  async deleteMyCase(userId: string, id: string) {
    await this.assertPartnerDesigner(userId);
    const row = await this.prisma.case.findFirst({
      where: { id, userId },
      select: { id: true, coverImageUrls: true, descriptionHtml: true },
    });
    if (!row) throw new NotFoundException('Кейс не найден');
    const urls = referencedUrlsFromCase(row);
    await this.detachCaseProductsBeforeDelete(id);
    await this.prisma.case.delete({ where: { id } });
    for (const u of urls) {
      this.media.tryDeleteObjectByPublicUrlIfUnreferenced(u).catch(() => undefined);
    }
    return { ok: true as const };
  }

  async bulkDeleteMyCases(userId: string, idsRaw: string[]) {
    await this.assertPartnerDesigner(userId);
    const ids = [...new Set(idsRaw.map((x) => x.trim()).filter(Boolean))].slice(0, 100);
    if (!ids.length) throw new BadRequestException('Укажите кейсы для удаления');

    const rows = await this.prisma.case.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, coverImageUrls: true, descriptionHtml: true },
    });
    if (!rows.length) return { ok: true as const, deleted: 0 };

    const urls: string[] = [];
    for (const row of rows) {
      urls.push(...referencedUrlsFromCase(row));
      await this.detachCaseProductsBeforeDelete(row.id);
    }
    await this.prisma.case.deleteMany({
      where: { userId, id: { in: rows.map((r) => r.id) } },
    });
    for (const u of [...new Set(urls)]) {
      this.media.tryDeleteObjectByPublicUrlIfUnreferenced(u).catch(() => undefined);
    }
    return { ok: true as const, deleted: rows.length };
  }

  private async uploadToUserFolder(userId: string, file: Express.Multer.File) {
    const prof = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { firstName: true, lastName: true },
    });
    const folderId = await this.media.ensureUserProfileFolderId(userId, {
      firstName: prof?.firstName,
      lastName: prof?.lastName,
    });
    const row = await this.media.uploadObject(file, folderId);
    return { publicUrl: row.publicUrl, mediaObjectId: row.id };
  }

  async uploadMyCaseMedia(
    userId: string,
    file: Express.Multer.File,
    kind: 'cover' | 'rich' = 'rich',
  ) {
    await this.assertPartnerDesigner(userId);
    if (kind === 'cover') {
      this.media.assertLkVitrineImage(file, 'cover');
    } else {
      this.media.assertLkProfileRichFile(file);
    }
    return this.uploadToUserFolder(userId, file);
  }

  async updateCaseLikesAdminBoostForAdmin(
    adminUserId: string,
    role: UserRole,
    id: string,
    likesAdminBoost: number,
  ) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'clients');
    const n = Math.floor(Number(likesAdminBoost));
    const boost = Number.isFinite(n) ? Math.max(0, Math.min(10_000_000, n)) : 0;
    const row = await this.prisma.case.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!row) throw new NotFoundException('Кейс не найден');
    const updated = await this.prisma.case.update({
      where: { id },
      data: { likesAdminBoost: boost },
    });
    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'Case',
      entityId: id,
      path: `/api/v1/cases/admin/${encodeURIComponent(id)}/likes-boost`,
      httpMethod: 'PATCH',
      actorUserId: adminUserId,
      metadata: { ownerUserId: row.userId, likesAdminBoost: boost },
    });
    return updated;
  }

  async getCaseForAdmin(adminUserId: string, role: UserRole, id: string) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'clients');
    const row = await this.prisma.case.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Кейс не найден');
    await this.audit.log({
      action: AuditAction.READ,
      entityType: 'Case',
      entityId: row.id,
      path: `/api/v1/cases/admin/${encodeURIComponent(id)}`,
      httpMethod: 'GET',
      actorUserId: adminUserId,
      metadata: { ownerUserId: row.userId },
    });
    return row;
  }

  async listCasesByUserForAdmin(adminUserId: string, role: UserRole, targetUserId: string) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'clients');
    const rows = await this.prisma.case.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: 'desc' },
    });
    await this.audit.log({
      action: AuditAction.READ,
      entityType: 'Case',
      path: `/api/v1/cases/admin/users/${encodeURIComponent(targetUserId)}`,
      httpMethod: 'GET',
      actorUserId: adminUserId,
      metadata: { targetUserId, caseCount: rows.length },
    });
    return rows;
  }

  async deleteCaseForAdmin(adminUserId: string, role: UserRole, id: string) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'clients');
    const row = await this.prisma.case.findUnique({
      where: { id },
      select: { id: true, userId: true, coverImageUrls: true, descriptionHtml: true },
    });
    if (!row) throw new NotFoundException('Кейс не найден');
    const urls = referencedUrlsFromCase(row);
    await this.detachCaseProductsBeforeDelete(id);
    await this.prisma.case.delete({ where: { id } });
    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: 'Case',
      entityId: id,
      path: `/api/v1/cases/admin/${encodeURIComponent(id)}`,
      httpMethod: 'DELETE',
      actorUserId: adminUserId,
      metadata: { ownerUserId: row.userId },
    });
    for (const u of urls) {
      this.media.tryDeleteObjectByPublicUrlIfUnreferenced(u).catch(() => undefined);
    }
    return { ok: true as const };
  }

  private caseBodyFromDto(dto: {
    title?: string;
    shortDescription?: string | null;
    location?: string | null;
    year?: number | null;
    budget?: string | null;
    descriptionHtml?: string | null;
    coverLayout?: '4:3' | '16:9' | '9:16' | null;
    coverImageUrls?: string[] | null;
    roomTypes?: string[] | null;
    productIds?: string[] | null;
    isPublished?: boolean | null;
  }): {
    title?: string;
    shortDescription?: string | null;
    location?: string | null;
    year?: number | null;
    budget?: string | null;
    descriptionHtml?: string | null;
    coverLayout?: string | null;
    coverImageUrls?: string[] | null;
    roomTypes?: string[] | null;
    productIds?: string[] | null;
    isPublished?: boolean;
  } {
    const out: {
      title?: string;
      shortDescription?: string | null;
      location?: string | null;
      year?: number | null;
      budget?: string | null;
      descriptionHtml?: string | null;
      coverLayout?: string | null;
      coverImageUrls?: string[] | null;
      roomTypes?: string[] | null;
      productIds?: string[] | null;
      isPublished?: boolean;
    } = {};
    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) throw new BadRequestException('Введите название проекта');
      out.title = t;
    }
    if (dto.shortDescription !== undefined) out.shortDescription = dto.shortDescription?.trim() || null;
    if (dto.location !== undefined) out.location = dto.location?.trim() || null;
    if (dto.year !== undefined) out.year = dto.year ?? null;
    if (dto.budget !== undefined) out.budget = dto.budget?.trim() || null;
    if (dto.coverLayout !== undefined) out.coverLayout = dto.coverLayout ?? null;
    if (dto.coverImageUrls !== undefined) {
      out.coverImageUrls = dto.coverImageUrls
        ? dto.coverImageUrls.map((x) => x.trim()).filter(Boolean)
        : null;
    }
    if (dto.roomTypes !== undefined) {
      out.roomTypes = dto.roomTypes ? dto.roomTypes.map((x) => x.trim()).filter(Boolean) : null;
    }
    if (dto.productIds !== undefined) {
      out.productIds = dto.productIds ? parseStringArray(dto.productIds, 80) : null;
    }
    if (dto.descriptionHtml !== undefined) {
      out.descriptionHtml =
        dto.descriptionHtml == null || String(dto.descriptionHtml).trim() === ''
          ? null
          : sanitizeProfileAboutHtml(dto.descriptionHtml);
    }
    if (dto.isPublished !== undefined && dto.isPublished !== null) {
      out.isPublished = Boolean(dto.isPublished);
    }
    return out;
  }

  private async assertBrandExists(brandId: string): Promise<void> {
    const row = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!row) throw new NotFoundException('Бренд не найден');
  }

  async listBrandCasesForAdmin(adminUserId: string, role: UserRole, brandId: string) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'brands');
    await this.assertBrandExists(brandId);
    return this.prisma.case.findMany({
      where: { brandId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBrandCaseForAdmin(adminUserId: string, role: UserRole, brandId: string, caseId: string) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'brands');
    const row = await this.prisma.case.findFirst({ where: { id: caseId, brandId } });
    if (!row) throw new NotFoundException('Проект не найден');
    return row;
  }

  async createBrandCaseForAdmin(
    adminUserId: string,
    role: UserRole,
    brandId: string,
    dto: {
      title: string;
      shortDescription?: string | null;
      location?: string | null;
      year?: number | null;
      budget?: string | null;
      descriptionHtml?: string | null;
      coverLayout?: '4:3' | '16:9' | '9:16' | null;
      coverImageUrls?: string[] | null;
      roomTypes?: string[] | null;
      productIds?: string[] | null;
      isPublished?: boolean | null;
    },
  ) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'brands');
    await this.assertBrandExists(brandId);
    const body = this.caseBodyFromDto({ ...dto, title: dto.title });
    if (!body.title) throw new BadRequestException('Введите название проекта');

    const created = await this.prisma.case.create({
      data: {
        brandId,
        userId: null,
        title: body.title,
        shortDescription: body.shortDescription ?? null,
        location: body.location ?? null,
        year: body.year ?? null,
        budget: body.budget ?? null,
        descriptionHtml: body.descriptionHtml ?? null,
        coverLayout: body.coverLayout ?? '9:16',
        coverImageUrls:
          body.coverImageUrls == null ? Prisma.JsonNull : body.coverImageUrls,
        roomTypes: body.roomTypes == null ? Prisma.JsonNull : body.roomTypes,
        productIds: body.productIds == null ? Prisma.JsonNull : body.productIds,
        isPublished: body.isPublished ?? true,
      },
    });
    await this.syncCaseProductLinks(created.id, body.productIds ?? []);
    await this.audit.log({
      action: AuditAction.CREATE,
      entityType: 'Case',
      entityId: created.id,
      path: `/api/v1/cases/admin/brands/${encodeURIComponent(brandId)}/cases`,
      httpMethod: 'POST',
      actorUserId: adminUserId,
      metadata: { brandId },
    });
    return created;
  }

  async updateBrandCaseForAdmin(
    adminUserId: string,
    role: UserRole,
    brandId: string,
    caseId: string,
    dto: {
      title?: string;
      shortDescription?: string | null;
      location?: string | null;
      year?: number | null;
      budget?: string | null;
      descriptionHtml?: string | null;
      coverLayout?: '4:3' | '16:9' | '9:16' | null;
      coverImageUrls?: string[] | null;
      roomTypes?: string[] | null;
      productIds?: string[] | null;
      isPublished?: boolean | null;
    },
  ) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'brands');
    const before = await this.prisma.case.findFirst({
      where: { id: caseId, brandId },
      select: { id: true, coverImageUrls: true, descriptionHtml: true },
    });
    if (!before) throw new NotFoundException('Проект не найден');
    const beforeUrls = referencedUrlsFromCase(before);
    const body = this.caseBodyFromDto(dto);
    const patch: Prisma.CaseUpdateInput = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.shortDescription !== undefined) patch.shortDescription = body.shortDescription;
    if (body.location !== undefined) patch.location = body.location;
    if (body.year !== undefined) patch.year = body.year;
    if (body.budget !== undefined) patch.budget = body.budget;
    if (body.coverLayout !== undefined) patch.coverLayout = body.coverLayout;
    if (body.coverImageUrls !== undefined) {
      patch.coverImageUrls = body.coverImageUrls == null ? Prisma.JsonNull : body.coverImageUrls;
    }
    if (body.roomTypes !== undefined) {
      patch.roomTypes = body.roomTypes == null ? Prisma.JsonNull : body.roomTypes;
    }
    if (body.productIds !== undefined) {
      patch.productIds = body.productIds == null ? Prisma.JsonNull : body.productIds;
    }
    if (body.descriptionHtml !== undefined) patch.descriptionHtml = body.descriptionHtml;
    if (body.isPublished !== undefined) patch.isPublished = body.isPublished;

    const updated = await this.prisma.case.update({ where: { id: caseId }, data: patch });
    if (body.productIds !== undefined) {
      await this.syncCaseProductLinks(caseId, body.productIds ?? []);
    } else {
      await this.syncCaseProductLinks(caseId, this.parseProductIdsFromCaseJson(updated.productIds));
    }

    const afterUrls = referencedUrlsFromCase(updated);
    const afterSet = new Set(afterUrls);
    for (const u of beforeUrls) {
      if (!afterSet.has(u)) {
        this.media.tryDeleteObjectByPublicUrlIfUnreferenced(u).catch(() => undefined);
      }
    }
    return updated;
  }

  async deleteBrandCaseForAdmin(
    adminUserId: string,
    role: UserRole,
    brandId: string,
    caseId: string,
  ) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'brands');
    const row = await this.prisma.case.findFirst({
      where: { id: caseId, brandId },
      select: { id: true, coverImageUrls: true, descriptionHtml: true },
    });
    if (!row) throw new NotFoundException('Проект не найден');
    const urls = referencedUrlsFromCase(row);
    await this.detachCaseProductsBeforeDelete(caseId);
    await this.prisma.case.delete({ where: { id: caseId } });
    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: 'Case',
      entityId: caseId,
      path: `/api/v1/cases/admin/brands/${encodeURIComponent(brandId)}/cases/${encodeURIComponent(caseId)}`,
      httpMethod: 'DELETE',
      actorUserId: adminUserId,
      metadata: { brandId },
    });
    for (const u of urls) {
      this.media.tryDeleteObjectByPublicUrlIfUnreferenced(u).catch(() => undefined);
    }
    return { ok: true as const };
  }
}

