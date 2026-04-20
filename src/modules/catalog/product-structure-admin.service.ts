import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UpdateProductElementsDto,
  UpdateProductModificationsDto,
  UpsertProductElementDto,
  UpsertProductModificationDto,
} from './dto/catalog-admin.dto';
import { slugifyVariantLabel } from './slug-transliteration';

@Injectable()
export class ProductStructureAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async updateModifications(productId: string, dto: UpdateProductModificationsDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Товар не найден');

    this.assertUniqueNames(dto.modifications);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.productModification.findMany({
        where: { productId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((m) => m.id));
      const keptIds = new Set<string>();

      for (let i = 0; i < dto.modifications.length; i++) {
        const m = dto.modifications[i]!;
        const name = m.name.trim();
        if (!name) throw new BadRequestException('Название модификации обязательно');
        const slug = await this.ensureUniqueModificationSlug(
          tx,
          productId,
          m.modificationSlug?.trim() || slugifyVariantLabel(name) || 'm',
          m.id ?? null,
        );

        if (m.id && existingIds.has(m.id)) {
          await tx.productModification.update({
            where: { id: m.id },
            data: { name, modificationSlug: slug, sortOrder: i },
          });
          keptIds.add(m.id);
        } else {
          const created = await tx.productModification.create({
            data: { productId, name, modificationSlug: slug, sortOrder: i },
          });
          keptIds.add(created.id);
        }
      }

      const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
      for (const id of toDelete) {
        const refs = await tx.productVariant.count({ where: { modificationId: id } });
        if (refs > 0) {
          throw new BadRequestException(
            'Модификация используется вариантами — удалите варианты или переназначьте модификацию',
          );
        }
      }
      if (toDelete.length) {
        await tx.productModification.deleteMany({ where: { id: { in: toDelete } } });
      }
    });

    return this.listModifications(productId);
  }

  async updateElements(productId: string, dto: UpdateProductElementsDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { brandId: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    this.assertUniqueNames(dto.elements);

    const allAvailabilityIds = [
      ...new Set(
        dto.elements.flatMap((e) => e.availabilities.map((a) => a.brandMaterialColorId)),
      ),
    ];
    if (allAvailabilityIds.length) {
      const colors = await this.prisma.brandMaterialColor.findMany({
        where: { id: { in: allAvailabilityIds } },
        select: { id: true, brandMaterial: { select: { brandId: true } } },
      });
      if (colors.length !== allAvailabilityIds.length) {
        throw new BadRequestException('Один из «материал-цветов» не найден');
      }
      if (product.brandId) {
        const foreign = colors.find((c) => c.brandMaterial.brandId !== product.brandId);
        if (foreign) {
          throw new BadRequestException(
            'Можно добавлять «материал-цвета» только из бренда этого товара',
          );
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.productElement.findMany({
        where: { productId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((e) => e.id));
      const keptIds = new Set<string>();

      for (let i = 0; i < dto.elements.length; i++) {
        const el = dto.elements[i]!;
        const name = el.name.trim();
        if (!name) throw new BadRequestException('Название элемента обязательно');

        let elementId: string;
        if (el.id && existingIds.has(el.id)) {
          await tx.productElement.update({
            where: { id: el.id },
            data: { name, sortOrder: i },
          });
          elementId = el.id;
        } else {
          const created = await tx.productElement.create({
            data: { productId, name, sortOrder: i },
          });
          elementId = created.id;
        }
        keptIds.add(elementId);

        await this.syncElementAvailabilities(tx, elementId, el.availabilities);
      }

      const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
      for (const id of toDelete) {
        const used = await tx.productVariantElementSelection.count({
          where: { productElementId: id },
        });
        if (used > 0) {
          throw new BadRequestException(
            'Элемент используется вариантами — пересоберите варианты перед удалением',
          );
        }
      }
      if (toDelete.length) {
        await tx.productElementMaterialColor.deleteMany({
          where: { productElementId: { in: toDelete } },
        });
        await tx.productElement.deleteMany({ where: { id: { in: toDelete } } });
      }
    });

    return this.listElements(productId);
  }

  private async syncElementAvailabilities(
    tx: Prisma.TransactionClient,
    elementId: string,
    items: UpsertProductElementDto['availabilities'],
  ) {
    const want = new Map<string, number>();
    items.forEach((a, i) => want.set(a.brandMaterialColorId, a.sortOrder ?? i));

    const existing = await tx.productElementMaterialColor.findMany({
      where: { productElementId: elementId },
      select: { brandMaterialColorId: true },
    });
    const existingColors = new Set(existing.map((r) => r.brandMaterialColorId));

    const toRemove: string[] = [];
    for (const colorId of existingColors) {
      if (!want.has(colorId)) toRemove.push(colorId);
    }
    if (toRemove.length) {
      const used = await tx.productVariantElementSelection.count({
        where: { productElementId: elementId, brandMaterialColorId: { in: toRemove } },
      });
      if (used > 0) {
        throw new BadRequestException(
          '«Материал-цвет» используется вариантом — сначала поменяйте варианты',
        );
      }
      await tx.productElementMaterialColor.deleteMany({
        where: { productElementId: elementId, brandMaterialColorId: { in: toRemove } },
      });
    }

    for (const [colorId, sort] of want) {
      if (existingColors.has(colorId)) {
        await tx.productElementMaterialColor.update({
          where: {
            productElementId_brandMaterialColorId: {
              productElementId: elementId,
              brandMaterialColorId: colorId,
            },
          },
          data: { sortOrder: sort },
        });
      } else {
        await tx.productElementMaterialColor.create({
          data: { productElementId: elementId, brandMaterialColorId: colorId, sortOrder: sort },
        });
      }
    }
  }

  private async ensureUniqueModificationSlug(
    tx: Prisma.TransactionClient,
    productId: string,
    desired: string,
    selfId: string | null,
  ): Promise<string> {
    const base = slugifyVariantLabel(desired).slice(0, 80) || 'm';
    let n = 0;
    for (;;) {
      const candidate = n === 0 ? base : `${base}-${n}`;
      const taken = await tx.productModification.findFirst({
        where: { productId, modificationSlug: candidate, NOT: selfId ? { id: selfId } : undefined },
      });
      if (!taken) return candidate;
      n += 1;
    }
  }

  private async listModifications(productId: string) {
    const rows = await this.prisma.productModification.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        modificationSlug: true,
        sortOrder: true,
        _count: { select: { variants: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      modificationSlug: r.modificationSlug,
      sortOrder: r.sortOrder,
      variantsCount: r._count.variants,
    }));
  }

  async listElements(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Товар не найден');
    const rows = await this.prisma.productElement.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      include: {
        availabilities: {
          orderBy: { sortOrder: 'asc' },
          include: {
            brandMaterialColor: {
              select: {
                id: true,
                name: true,
                imageUrl: true,
                brandMaterial: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sortOrder,
      availabilities: r.availabilities.map((a) => ({
        brandMaterialColorId: a.brandMaterialColorId,
        materialId: a.brandMaterialColor.brandMaterial.id,
        materialName: a.brandMaterialColor.brandMaterial.name,
        colorName: a.brandMaterialColor.name,
        imageUrl: a.brandMaterialColor.imageUrl,
        sortOrder: a.sortOrder,
      })),
    }));
  }

  private assertUniqueNames(
    items: (UpsertProductModificationDto | UpsertProductElementDto)[],
  ): void {
    const seen = new Set<string>();
    for (const it of items) {
      const key = it.name.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) {
        throw new ConflictException(`Дубль наименования «${it.name}»`);
      }
      seen.add(key);
    }
  }
}
