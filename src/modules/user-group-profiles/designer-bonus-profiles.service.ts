import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type DesignerBonusProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpsertDesignerBonusProfileAdminDto } from './dto/designer-bonus-profile-admin.dto';
import {
  designerBonusMirrorInputsChanged,
  designerBonusMirrorInputsFromProfile,
} from './designer-bonus-profile.util';
import { ProgramConfigSyncService } from './program-config-sync.service';

export type DesignerBonusProfileAdminRow = {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  designerOwnCatalogBonusPercent: number;
  designerOwnMinimumCatalogSiteTotalRub: number;
  createdAt: string;
  updatedAt: string;
};

function toRow(row: DesignerBonusProfile): DesignerBonusProfileAdminRow {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
    designerOwnCatalogBonusPercent: row.designerOwnCatalogBonusPercent.toNumber(),
    designerOwnMinimumCatalogSiteTotalRub: row.designerOwnMinimumCatalogSiteTotalRub,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class DesignerBonusProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configSync: ProgramConfigSyncService,
  ) {}

  async list(): Promise<DesignerBonusProfileAdminRow[]> {
    const rows = await this.prisma.designerBonusProfile.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toRow);
  }

  private async resolveCreateRates(dto: UpsertDesignerBonusProfileAdminDto): Promise<{
    designerOwnCatalogBonusPercent: number;
    designerOwnMinimumCatalogSiteTotalRub: number;
  }> {
    if (
      dto.designerOwnCatalogBonusPercent !== undefined ||
      dto.designerOwnMinimumCatalogSiteTotalRub !== undefined
    ) {
      return {
        designerOwnCatalogBonusPercent: dto.designerOwnCatalogBonusPercent ?? 0,
        designerOwnMinimumCatalogSiteTotalRub: dto.designerOwnMinimumCatalogSiteTotalRub ?? 0,
      };
    }
    const primary = await this.prisma.designerBonusProfile.findFirst({ where: { isDefault: true } });
    if (primary) {
      return {
        designerOwnCatalogBonusPercent: primary.designerOwnCatalogBonusPercent.toNumber(),
        designerOwnMinimumCatalogSiteTotalRub: primary.designerOwnMinimumCatalogSiteTotalRub,
      };
    }
    return { designerOwnCatalogBonusPercent: 0, designerOwnMinimumCatalogSiteTotalRub: 0 };
  }

  async create(dto: UpsertDesignerBonusProfileAdminDto): Promise<DesignerBonusProfileAdminRow> {
    const name = (dto.name ?? '').trim() || 'Новый профиль';
    const maxSort = await this.prisma.designerBonusProfile.aggregate({ _max: { sortOrder: true } });
    const sortOrder = dto.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1;
    const rates = await this.resolveCreateRates(dto);
    const pct = rates.designerOwnCatalogBonusPercent;
    const minRub = rates.designerOwnMinimumCatalogSiteTotalRub;
    const created = await this.prisma.designerBonusProfile.create({
      data: {
        name,
        sortOrder,
        isDefault: false,
        designerOwnCatalogBonusPercent: new Prisma.Decimal(pct),
        designerOwnMinimumCatalogSiteTotalRub: minRub,
      },
    });
    return toRow(created);
  }

  private async setPrimaryProfile(id: string): Promise<void> {
    const existing = await this.prisma.designerBonusProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Профиль не найден');
    await this.prisma.$transaction([
      this.prisma.designerBonusProfile.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.designerBonusProfile.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
  }

  async update(id: string, dto: UpsertDesignerBonusProfileAdminDto): Promise<DesignerBonusProfileAdminRow> {
    const existing = await this.prisma.designerBonusProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Профиль не найден');

    const previousPrimary = await this.prisma.designerBonusProfile.findFirst({
      where: { isDefault: true },
    });

    if (dto.setAsPrimary) {
      await this.setPrimaryProfile(id);
    }

    const pct =
      dto.designerOwnCatalogBonusPercent !== undefined
        ? dto.designerOwnCatalogBonusPercent
        : existing.designerOwnCatalogBonusPercent.toNumber();
    const minRub =
      dto.designerOwnMinimumCatalogSiteTotalRub !== undefined
        ? dto.designerOwnMinimumCatalogSiteTotalRub
        : existing.designerOwnMinimumCatalogSiteTotalRub;

    const updated = await this.prisma.designerBonusProfile.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() || existing.name } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.designerOwnCatalogBonusPercent !== undefined
          ? { designerOwnCatalogBonusPercent: new Prisma.Decimal(pct) }
          : {}),
        ...(dto.designerOwnMinimumCatalogSiteTotalRub !== undefined
          ? { designerOwnMinimumCatalogSiteTotalRub: minRub }
          : {}),
      },
    });

    if (updated.isDefault) {
      const beforeSource =
        dto.setAsPrimary && previousPrimary && previousPrimary.id !== updated.id
          ? previousPrimary
          : existing;
      const beforeInputs = designerBonusMirrorInputsFromProfile(beforeSource);
      const afterInputs = designerBonusMirrorInputsFromProfile(updated);
      if (designerBonusMirrorInputsChanged(beforeInputs, afterInputs)) {
        await this.configSync.mirrorDesignerBonus(afterInputs);
      }
    }

    return toRow(updated);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.designerBonusProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Профиль не найден');
    if (existing.isDefault) {
      throw new BadRequestException('Нельзя удалить основной профиль');
    }
    await this.prisma.designerBonusProfile.delete({ where: { id } });
  }
}
