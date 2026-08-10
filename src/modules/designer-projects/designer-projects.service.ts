import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { priceToNumber } from '../../meilisearch/product-search-doc';
import { StaffAccessService } from '../staff/staff-access.service';
import type {
  CreateDesignerProjectDto,
  DesignerProjectLineInputDto,
  DesignerProjectRoomInputDto,
  UpdateDesignerProjectDto,
} from './dto/designer-projects.dto';

/** Совпадает с фронтом `lib/designerProjects/defaultRoom.ts` — одно служебное помещение на проект. */
export const DEFAULT_DESIGNER_ROOM_KEY = '__winwin_default_room__';

function decimalQty(n: number): Prisma.Decimal {
  return new Prisma.Decimal(String(n));
}

/** Склейка строк с одинаковым SKU (помещения убраны из UX — склейка глобальна по проекту). */
export function mergeDesignerProjectLines(lines: DesignerProjectLineInputDto[]): DesignerProjectLineInputDto[] {
  type Acc = DesignerProjectLineInputDto & { __ord: number };
  const map = new Map<string, Acc>();
  let ord = 0;
  for (const line of lines) {
    const vid = line.productVariantId?.trim() || '';
    const mergeKey = vid ? `v:${vid}` : `p:${line.productId}`;
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const prev = map.get(mergeKey);
    if (prev) {
      prev.quantity = Number(prev.quantity) + qty;
    } else {
      map.set(mergeKey, {
        ...line,
        quantity: qty,
        __ord: line.sortOrder ?? ord++,
      } as Acc);
    }
  }
  return [...map.values()]
    .sort((a, b) => a.__ord - b.__ord)
    .map((row) => {
      const { __ord, ...rest } = row;
      return rest;
    });
}

@Injectable()
export class DesignerProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffAccess: StaffAccessService,
  ) {}

  async listMine(userId: string) {
    const rows = await this.prisma.designerProject.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        address: true,
        updatedAt: true,
        _count: { select: { lines: true, rooms: true } },
      },
    });
    const ids = rows.map((r) => r.id);
    const totals = ids.length ? await this.computeTotalsForProjects(ids) : new Map<string, number>();
    return {
      projects: rows.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        updatedAt: r.updatedAt.toISOString(),
        lineCount: r._count.lines,
        roomCount: r._count.rooms,
        totalRub: totals.get(r.id) ?? null,
      })),
    };
  }

  /** Пересчёт суммы по актуальным ценам каталога (как на GET одного проекта). */
  private async computeTotalsForProjects(projectIds: string[]): Promise<Map<string, number>> {
    const lines = await this.prisma.designerProjectLine.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        projectId: true,
        productId: true,
        productVariantId: true,
        quantity: true,
      },
    });
    const enriched = await this.attachUnitPrices(lines);
    const map = new Map<string, number>();
    for (const l of enriched) {
      const unit = l.priceRubPerUnit;
      if (unit == null || !Number.isFinite(unit)) continue;
      const q = priceToNumber(l.quantity as Prisma.Decimal);
      const prev = map.get(l.projectId) ?? 0;
      map.set(l.projectId, prev + unit * q);
    }
    return map;
  }

  private async attachUnitPrices(
    lines: {
      projectId: string;
      productId: string;
      productVariantId: string | null;
      quantity: Prisma.Decimal;
    }[],
  ): Promise<
    {
      projectId: string;
      productId: string;
      productVariantId: string | null;
      quantity: Prisma.Decimal;
      priceRubPerUnit: number | null;
    }[]
  > {
    const variantIds = [...new Set(lines.map((l) => l.productVariantId).filter((x): x is string => !!x))];
    const productIdsForDefault = [
      ...new Set(lines.filter((l) => !l.productVariantId).map((l) => l.productId)),
    ];

    const [variants, products] = await Promise.all([
      variantIds.length
        ? this.prisma.productVariant.findMany({
            where: { id: { in: variantIds }, isActive: true },
            select: { id: true, productId: true, price: true },
          })
        : [],
      productIdsForDefault.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIdsForDefault }, isActive: true },
            select: {
              id: true,
              variants: {
                where: { isActive: true },
                orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
                take: 1,
                select: { id: true, price: true },
              },
            },
          })
        : [],
    ]);

    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const defaultPriceByProduct = new Map(
      products.map((p) => {
        const v = p.variants[0];
        return [p.id, v ? priceToNumber(v.price) : null] as const;
      }),
    );

    return lines.map((l) => {
      let unit: number | null = null;
      if (l.productVariantId) {
        const v = variantMap.get(l.productVariantId);
        unit = v && v.productId === l.productId ? priceToNumber(v.price) : null;
      } else {
        unit = defaultPriceByProduct.get(l.productId) ?? null;
      }
      return { ...l, priceRubPerUnit: unit };
    });
  }

  async getMine(userId: string, projectId: string) {
    const project = await this.prisma.designerProject.findFirst({
      where: { id: projectId, userId },
      include: {
        rooms: { orderBy: { sortOrder: 'asc' } },
        lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!project) throw new NotFoundException();
    return this.formatProjectResponse(project);
  }

  private async formatProjectResponse(
    project: Prisma.DesignerProjectGetPayload<{
      include: { rooms: true; lines: true };
    }>,
  ) {
    const linesRaw = project.lines.map((l) => ({
      projectId: l.projectId,
      id: l.id,
      roomId: l.roomId,
      productId: l.productId,
      productVariantId: l.productVariantId,
      quantity: l.quantity,
      unit: l.unit,
      snapshot: l.snapshot,
      sortOrder: l.sortOrder,
    }));

    const priceInputs = project.lines.map((l) => ({
      projectId: l.projectId,
      productId: l.productId,
      productVariantId: l.productVariantId,
      quantity: l.quantity,
    }));
    const priced = await this.attachUnitPrices(priceInputs);

    const productIds = [...new Set(project.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        slug: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
        images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
      },
    });
    const productMeta = new Map(products.map((p) => [p.id, p]));

    const pricedByLineId = new Map<string, number | null>();
    for (let i = 0; i < project.lines.length; i++) {
      pricedByLineId.set(project.lines[i]!.id, priced[i]!.priceRubPerUnit);
    }

    let totalRub = 0;
    const linesOut = project.lines.map((l) => {
      const unit = pricedByLineId.get(l.id) ?? null;
      const q = priceToNumber(l.quantity as Prisma.Decimal);
      const lineTotal = unit != null && Number.isFinite(unit) ? unit * q : null;
      if (lineTotal != null) totalRub += lineTotal;
      const snap = (l.snapshot ?? {}) as Record<string, unknown>;
      const pm = productMeta.get(l.productId);
      return {
        id: l.id,
        roomId: l.roomId,
        productId: l.productId,
        productSlug: pm?.slug ?? '',
        productVariantId: l.productVariantId,
        quantity: q,
        unit: l.unit,
        snapshot: snap,
        priceRubPerUnit: unit,
        lineTotalRub: lineTotal,
        resolvedImageUrl: typeof snap.imageUrl === 'string' ? snap.imageUrl : pm?.images[0]?.url ?? null,
        categoryId: pm?.categoryId ?? null,
        categoryLabel: pm?.category?.name?.trim() ? pm.category.name.trim() : null,
      };
    });

    return {
      id: project.id,
      name: project.name,
      address: project.address,
      updatedAt: project.updatedAt.toISOString(),
      totalRub: Number(totalRub.toFixed(2)),
      rooms: [],
      lines: linesOut,
    };
  }

  async createMine(userId: string, dto: CreateDesignerProjectDto) {
    const mergedLines = mergeDesignerProjectLines(dto.lines ?? []);
    await this.validateLinesProducts(mergedLines);

    const project = await this.prisma.$transaction(async (tx) => {
      const p = await tx.designerProject.create({
        data: {
          userId,
          name: dto.name.trim(),
          address: dto.address?.trim() || null,
        },
      });
      await this.replaceRoomsAndLines(tx, p.id, dto.rooms ?? [], mergedLines);
      return tx.designerProject.findFirstOrThrow({
        where: { id: p.id },
        include: {
          rooms: { orderBy: { sortOrder: 'asc' } },
          lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        },
      });
    });

    return this.formatProjectResponse(project);
  }

  async updateMine(userId: string, projectId: string, dto: UpdateDesignerProjectDto) {
    const existing = await this.prisma.designerProject.findFirst({
      where: { id: projectId, userId },
      select: {
        id: true,
        lines: { select: { productId: true, productVariantId: true } },
      },
    });
    if (!existing) throw new NotFoundException();

    const mergedLines = mergeDesignerProjectLines(dto.lines ?? []);
    // Уже лежащие в проекте позиции можно оставить/частично удалить даже если товар
    // скрыли в каталоге (isActive=false). Иначе PUT «удалить строку» падает на
    // соседних недоступных SKU и мёртвые позиции нельзя убрать из ЛК.
    await this.validateLinesProducts(mergedLines, {
      allowInactiveProductIds: new Set(existing.lines.map((l) => l.productId)),
      allowInactiveVariantIds: new Set(
        existing.lines.map((l) => l.productVariantId).filter((id): id is string => Boolean(id)),
      ),
    });

    const project = await this.prisma.$transaction(async (tx) => {
      await tx.designerProject.update({
        where: { id: projectId },
        data: {
          name: dto.name.trim(),
          address: dto.address?.trim() || null,
        },
      });
      await tx.designerProjectLine.deleteMany({ where: { projectId } });
      await tx.designerProjectRoom.deleteMany({ where: { projectId } });
      await this.replaceRoomsAndLines(tx, projectId, dto.rooms ?? [], mergedLines);
      return tx.designerProject.findFirstOrThrow({
        where: { id: projectId },
        include: {
          rooms: { orderBy: { sortOrder: 'asc' } },
          lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        },
      });
    });

    return this.formatProjectResponse(project);
  }

  async deleteMine(userId: string, projectId: string) {
    const r = await this.prisma.designerProject.deleteMany({
      where: { id: projectId, userId },
    });
    if (r.count === 0) throw new NotFoundException();
    return { ok: true };
  }

  private async validateLinesProducts(
    lines: DesignerProjectLineInputDto[],
    opts?: {
      allowInactiveProductIds?: ReadonlySet<string>;
      allowInactiveVariantIds?: ReadonlySet<string>;
    },
  ) {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, isActive: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    for (const productId of productIds) {
      const product = productById.get(productId);
      if (!product) {
        throw new BadRequestException('Один или несколько товаров не найдены или отключены');
      }
      if (!product.isActive && !opts?.allowInactiveProductIds?.has(productId)) {
        throw new BadRequestException('Один или несколько товаров не найдены или отключены');
      }
    }

    const variantChecks = lines.filter((l) => l.productVariantId?.trim());
    const variantIds = [...new Set(variantChecks.map((l) => l.productVariantId!))];
    if (variantIds.length) {
      const variants = await this.prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, productId: true, isActive: true },
      });
      const vm = new Map(variants.map((v) => [v.id, v]));
      for (const l of variantChecks) {
        const vid = l.productVariantId!;
        const v = vm.get(vid);
        if (!v || v.productId !== l.productId) {
          throw new BadRequestException('Несогласованный вариант SKU для товара');
        }
        if (!v.isActive && !opts?.allowInactiveVariantIds?.has(vid)) {
          throw new BadRequestException('Несогласованный вариант SKU для товара');
        }
      }
    }
  }

  private async replaceRoomsAndLines(
    tx: Prisma.TransactionClient,
    projectId: string,
    rooms: DesignerProjectRoomInputDto[],
    lines: DesignerProjectLineInputDto[],
  ) {
    let effRooms = rooms?.length ? [...rooms] : [];
    let effLines = lines ?? [];
    if (!effRooms.length) {
      effRooms = [
        {
          key: DEFAULT_DESIGNER_ROOM_KEY,
          label: 'Проект',
          roomType: '—',
          sortOrder: 0,
        },
      ];
      effLines = effLines.map((l) => ({ ...l, roomKey: DEFAULT_DESIGNER_ROOM_KEY }));
    }

    const roomKeys = [...new Set(effRooms.map((r) => r.key.trim()))];
    if (roomKeys.length !== effRooms.length) throw new BadRequestException('Дублируются ключи помещений');

    const keyToId = new Map<string, string>();
    let sort = 0;
    for (const r of effRooms) {
      const row = await tx.designerProjectRoom.create({
        data: {
          projectId,
          label: r.label.trim(),
          roomType: r.roomType.trim(),
          sortOrder: r.sortOrder ?? sort++,
        },
      });
      keyToId.set(r.key.trim(), row.id);
    }

    let lineSort = 0;
    for (const l of effLines) {
      const roomId = keyToId.get(l.roomKey.trim());
      if (!roomId) throw new BadRequestException(`Неизвестное помещение: ${l.roomKey}`);

      await tx.designerProjectLine.create({
        data: {
          projectId,
          roomId,
          productId: l.productId,
          productVariantId: l.productVariantId?.trim() || null,
          quantity: decimalQty(l.quantity),
          unit: (l.unit?.trim() || 'шт').slice(0, 32),
          snapshot: (l.snapshot ?? undefined) as Prisma.InputJsonValue | undefined,
          sortOrder: l.sortOrder ?? lineSort++,
        },
      });
    }
  }

  // --- Admin ---

  async listForAdmin(
    adminUserId: string,
    role: UserRole,
    opts: { page: number; limit: number; q?: string; userId?: string },
  ) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'clients');
    const take = Math.min(Math.max(opts.limit, 1), 100);
    const skip = Math.max(opts.page - 1, 0) * take;

    const where: Prisma.DesignerProjectWhereInput = {};
    if (opts.userId?.trim()) where.userId = opts.userId.trim();
    const q = opts.q?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.designerProject.count({ where }),
      this.prisma.designerProject.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          userId: true,
          name: true,
          address: true,
          updatedAt: true,
          user: { select: { email: true } },
          _count: { select: { lines: true, rooms: true } },
        },
      }),
    ]);

    const ids = rows.map((r) => r.id);
    const totals = ids.length ? await this.computeTotalsForProjects(ids) : new Map<string, number>();

    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userEmail: r.user.email,
        name: r.name,
        address: r.address,
        updatedAt: r.updatedAt.toISOString(),
        lineCount: r._count.lines,
        roomCount: r._count.rooms,
        totalRub: totals.get(r.id) ?? null,
      })),
    };
  }

  async getForAdmin(adminUserId: string, role: UserRole, projectId: string) {
    await this.staffAccess.assertStaffCanAccessSection(adminUserId, role, 'clients');
    const project = await this.prisma.designerProject.findFirst({
      where: { id: projectId },
      include: {
        user: { select: { id: true, email: true } },
        rooms: { orderBy: { sortOrder: 'asc' } },
        lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!project) throw new NotFoundException();
    const formatted = await this.formatProjectResponse(project);
    return {
      ...formatted,
      userId: project.userId,
      userEmail: project.user.email,
    };
  }
}
