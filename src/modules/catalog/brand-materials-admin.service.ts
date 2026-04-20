import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  UpdateBrandMaterialsAdminDto,
  UpsertBrandMaterialDto,
} from './dto/catalog-admin.dto';

/**
 * Материалы и их цвета на уровне бренда (библиотека).
 * Конкретные «материал-цвет» привязываются к элементам товара из этой библиотеки.
 */
@Injectable()
export class BrandMaterialsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async listForBrand(brandId: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Бренд не найден');
    const rows = await this.prisma.brandMaterial.findMany({
      where: { brandId },
      orderBy: { sortOrder: 'asc' },
      include: { colors: { orderBy: { sortOrder: 'asc' } } },
    });
    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      sortOrder: m.sortOrder,
      colors: m.colors.map((c) => ({
        id: c.id,
        name: c.name,
        imageUrl: c.imageUrl,
        sortOrder: c.sortOrder,
      })),
    }));
  }

  /** Пересобирает материалы и цвета бренда по списку — id сохраняется, новые создаются, отсутствующие удаляются. */
  async replace(brandId: string, dto: UpdateBrandMaterialsAdminDto) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new NotFoundException('Бренд не найден');

    this.assertUnique(dto.materials);

    for (const m of dto.materials) {
      for (const c of m.colors) {
        if (c.imageUrl?.trim()) {
          this.objectStorage.assertProductImageUrlAllowed(c.imageUrl.trim());
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const existingMaterials = await tx.brandMaterial.findMany({
        where: { brandId },
        include: { colors: { select: { id: true } } },
      });
      const existingMatById = new Map(existingMaterials.map((m) => [m.id, m]));

      const keptMaterialIds = new Set<string>();
      const keptColorIdsByMaterial = new Map<string, Set<string>>();

      for (let mi = 0; mi < dto.materials.length; mi++) {
        const m = dto.materials[mi]!;
        const nameTrim = m.name.trim();
        if (!nameTrim) throw new BadRequestException('Название материала обязательно');

        let materialId: string;
        if (m.id && existingMatById.has(m.id)) {
          await tx.brandMaterial.update({
            where: { id: m.id },
            data: { name: nameTrim, sortOrder: mi },
          });
          materialId = m.id;
        } else {
          const created = await tx.brandMaterial.create({
            data: { brandId, name: nameTrim, sortOrder: mi },
          });
          materialId = created.id;
        }
        keptMaterialIds.add(materialId);
        const existingColorIds = new Set(
          (existingMatById.get(materialId)?.colors ?? []).map((c) => c.id),
        );

        const keptColors = new Set<string>();
        for (let ci = 0; ci < m.colors.length; ci++) {
          const c = m.colors[ci]!;
          const cName = c.name.trim();
          if (!cName) throw new BadRequestException('Название цвета обязательно');
          const imageUrl = c.imageUrl?.trim() || null;

          if (c.id && existingColorIds.has(c.id)) {
            await tx.brandMaterialColor.update({
              where: { id: c.id },
              data: { name: cName, imageUrl, sortOrder: ci },
            });
            keptColors.add(c.id);
          } else {
            const created = await tx.brandMaterialColor.create({
              data: { brandMaterialId: materialId, name: cName, imageUrl, sortOrder: ci },
            });
            keptColors.add(created.id);
          }
        }
        keptColorIdsByMaterial.set(materialId, keptColors);

        const toDeleteColors = [...existingColorIds].filter((id) => !keptColors.has(id));
        if (toDeleteColors.length) {
          await this.deleteColorsSafely(tx, toDeleteColors);
        }
      }

      const toDeleteMaterials = existingMaterials
        .filter((m) => !keptMaterialIds.has(m.id))
        .map((m) => m.id);
      if (toDeleteMaterials.length) {
        const colors = await tx.brandMaterialColor.findMany({
          where: { brandMaterialId: { in: toDeleteMaterials } },
          select: { id: true },
        });
        await this.deleteColorsSafely(
          tx,
          colors.map((c) => c.id),
        );
        await tx.brandMaterial.deleteMany({ where: { id: { in: toDeleteMaterials } } });
      }
    });

    return this.listForBrand(brandId);
  }

  private async deleteColorsSafely(tx: Prisma.TransactionClient, colorIds: string[]): Promise<void> {
    if (!colorIds.length) return;
    const used = await tx.productVariantElementSelection.count({
      where: { brandMaterialColorId: { in: colorIds } },
    });
    if (used > 0) {
      throw new BadRequestException(
        'Цвет используется в варианте товара — сначала удалите или пересоберите варианты',
      );
    }
    await tx.productElementMaterialColor.deleteMany({
      where: { brandMaterialColorId: { in: colorIds } },
    });
    await tx.brandMaterialColor.deleteMany({ where: { id: { in: colorIds } } });
  }

  private assertUnique(materials: UpsertBrandMaterialDto[]): void {
    const namesM = new Set<string>();
    for (const m of materials) {
      const k = m.name.trim().toLowerCase();
      if (!k) continue;
      if (namesM.has(k)) throw new BadRequestException(`Дубль материала «${m.name}»`);
      namesM.add(k);
      const names = new Set<string>();
      for (const c of m.colors) {
        const ck = c.name.trim().toLowerCase();
        if (!ck) continue;
        if (names.has(ck)) {
          throw new BadRequestException(`Дубль цвета «${c.name}» в материале «${m.name}»`);
        }
        names.add(ck);
      }
    }
  }
}
