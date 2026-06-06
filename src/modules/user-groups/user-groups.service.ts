import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpsertUserGroupAdminDto } from './dto/user-group-admin.dto';

export type UserGroupAdminRow = {
  id: string;
  name: string;
  label: string;
  slug: string | null;
  sortOrder: number;
  referralProgramProfileId: string;
  designerBonusProfileId: string;
  pricingProfileId: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type UserGroupDetailAdminRow = UserGroupAdminRow & {
  referralProgramProfileName: string;
  designerBonusProfileName: string;
  pricingProfileName: string | null;
};

export type UserGroupMemberAdminRow = {
  id: string;
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  assignedAt: string;
};

export type UserGroupMembershipAdminPayload = {
  groupId: string | null;
  groupName: string | null;
  groupLabel: string | null;
};

function toRow(
  row: Prisma.UserGroupGetPayload<{ include: { _count: { select: { members: true } } } }>,
): UserGroupAdminRow {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    slug: row.slug,
    sortOrder: row.sortOrder,
    referralProgramProfileId: row.referralProgramProfileId,
    designerBonusProfileId: row.designerBonusProfileId,
    pricingProfileId: row.pricingProfileId,
    memberCount: row._count.members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class UserGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<UserGroupAdminRow[]> {
    const rows = await this.prisma.userGroup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { members: true } } },
    });
    return rows.map(toRow);
  }

  async getOne(id: string): Promise<UserGroupDetailAdminRow> {
    const row = await this.prisma.userGroup.findUnique({
      where: { id },
      include: {
        _count: { select: { members: true } },
        referralProgramProfile: { select: { name: true } },
        designerBonusProfile: { select: { name: true } },
        pricingProfile: { select: { name: true } },
      },
    });
    if (!row) throw new NotFoundException('Группа не найдена');
    const base = toRow(row);
    return {
      ...base,
      referralProgramProfileName: row.referralProgramProfile.name,
      designerBonusProfileName: row.designerBonusProfile.name,
      pricingProfileName: row.pricingProfile?.name ?? null,
    };
  }

  private async resolvePricingProfileId(
    raw: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (raw === undefined) return undefined;
    const id = raw === null || raw === '' ? null : raw.trim();
    if (id === null) return null;
    const profile = await this.prisma.pricingProfile.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!profile) throw new BadRequestException('Профиль ценообразования не найден');
    return id;
  }

  private async assertProfileIds(
    referralProgramProfileId: string,
    designerBonusProfileId: string,
  ): Promise<void> {
    const [ref, bonus] = await Promise.all([
      this.prisma.referralProgramProfile.findUnique({
        where: { id: referralProgramProfileId },
        select: { id: true },
      }),
      this.prisma.designerBonusProfile.findUnique({
        where: { id: designerBonusProfileId },
        select: { id: true },
      }),
    ]);
    if (!ref) throw new BadRequestException('Профиль реферальной программы не найден');
    if (!bonus) throw new BadRequestException('Профиль бонуса дизайнера не найден');
  }

  async create(dto: UpsertUserGroupAdminDto): Promise<UserGroupDetailAdminRow> {
    const referralId = dto.referralProgramProfileId;
    const bonusId = dto.designerBonusProfileId;
    if (!referralId || !bonusId) {
      throw new BadRequestException('Укажите профили рефералов и бонуса дизайнера');
    }
    await this.assertProfileIds(referralId, bonusId);

    const maxSort = await this.prisma.userGroup.aggregate({ _max: { sortOrder: true } });
    const sortOrder = dto.sortOrder ?? (maxSort._max.sortOrder ?? -1) + 1;
    const name = (dto.name ?? '').trim() || 'Новая группа';
    const label = (dto.label ?? '').trim() || name;
    const slug = dto.slug === null ? null : (dto.slug ?? '').trim() || null;

    const pricingProfileId = await this.resolvePricingProfileId(dto.pricingProfileId);

    const created = await this.prisma.userGroup.create({
      data: {
        name,
        label,
        slug,
        sortOrder,
        referralProgramProfileId: referralId,
        designerBonusProfileId: bonusId,
        ...(pricingProfileId !== undefined ? { pricingProfileId } : {}),
      },
    });
    return this.getOne(created.id);
  }

  async update(id: string, dto: UpsertUserGroupAdminDto): Promise<UserGroupDetailAdminRow> {
    const existing = await this.prisma.userGroup.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Группа не найдена');

    const referralId = dto.referralProgramProfileId ?? existing.referralProgramProfileId;
    const bonusId = dto.designerBonusProfileId ?? existing.designerBonusProfileId;
    if (dto.referralProgramProfileId || dto.designerBonusProfileId) {
      await this.assertProfileIds(referralId, bonusId);
    }
    const pricingProfileId = await this.resolvePricingProfileId(dto.pricingProfileId);

    await this.prisma.userGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() || existing.name } : {}),
        ...(dto.label !== undefined ? { label: dto.label.trim() || existing.label } : {}),
        ...(dto.slug !== undefined
          ? { slug: dto.slug === null ? null : (dto.slug ?? '').trim() || null }
          : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.referralProgramProfileId !== undefined
          ? { referralProgramProfileId: referralId }
          : {}),
        ...(dto.designerBonusProfileId !== undefined
          ? { designerBonusProfileId: bonusId }
          : {}),
        ...(pricingProfileId !== undefined ? { pricingProfileId } : {}),
      },
    });
    return this.getOne(id);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.userGroup.findUnique({
      where: { id },
      include: { _count: { select: { members: true } } },
    });
    if (!existing) throw new NotFoundException('Группа не найдена');
    if (existing._count.members > 0) {
      throw new BadRequestException('Сначала удалите всех участников группы');
    }
    await this.prisma.userGroup.delete({ where: { id } });
  }

  async listMembers(
    groupId: string,
    skip = 0,
    take = 50,
  ): Promise<{ items: UserGroupMemberAdminRow[]; total: number }> {
    const group = await this.prisma.userGroup.findUnique({ where: { id: groupId }, select: { id: true } });
    if (!group) throw new NotFoundException('Группа не найдена');

    const [items, total] = await Promise.all([
      this.prisma.userGroupMember.findMany({
        where: { groupId },
        orderBy: { assignedAt: 'desc' },
        skip,
        take,
        include: {
          user: {
            select: {
              email: true,
              profile: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.userGroupMember.count({ where: { groupId } }),
    ]);

    return {
      items: items.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.user.email,
        firstName: m.user.profile?.firstName ?? null,
        lastName: m.user.profile?.lastName ?? null,
        assignedAt: m.assignedAt.toISOString(),
      })),
      total,
    };
  }

  async addMember(groupId: string, userId: string, assignedByUserId?: string): Promise<void> {
    const [group, user] = await Promise.all([
      this.prisma.userGroup.findUnique({ where: { id: groupId }, select: { id: true } }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      }),
    ]);
    if (!group) throw new NotFoundException('Группа не найдена');
    if (!user) throw new NotFoundException('Пользователь не найден');

    const existing = await this.prisma.userGroupMember.findUnique({ where: { userId } });
    if (existing && existing.groupId !== groupId) {
      throw new BadRequestException('Пользователь уже состоит в другой группе');
    }
    if (existing) return;

    await this.prisma.userGroupMember.create({
      data: { userId, groupId, assignedByUserId: assignedByUserId ?? null },
    });
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    const row = await this.prisma.userGroupMember.findFirst({
      where: { groupId, userId },
    });
    if (!row) throw new NotFoundException('Участник не найден в этой группе');
    await this.prisma.userGroupMember.delete({ where: { id: row.id } });
  }

  async getMembershipForUser(userId: string): Promise<UserGroupMembershipAdminPayload> {
    const member = await this.prisma.userGroupMember.findUnique({
      where: { userId },
      include: { group: { select: { id: true, name: true, label: true } } },
    });
    if (!member) {
      return { groupId: null, groupName: null, groupLabel: null };
    }
    return {
      groupId: member.group.id,
      groupName: member.group.name,
      groupLabel: member.group.label,
    };
  }

  async setMembershipForUser(
    userId: string,
    groupId: string | null,
    assignedByUserId?: string,
  ): Promise<UserGroupMembershipAdminPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    if (user.role !== UserRole.USER && user.role !== UserRole.MODERATOR && user.role !== UserRole.ADMIN) {
      throw new BadRequestException('Нельзя назначить группу этому пользователю');
    }

    if (groupId === null) {
      await this.prisma.userGroupMember.deleteMany({ where: { userId } });
      return { groupId: null, groupName: null, groupLabel: null };
    }

    const group = await this.prisma.userGroup.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, label: true },
    });
    if (!group) throw new NotFoundException('Группа не найдена');

    await this.prisma.userGroupMember.upsert({
      where: { userId },
      create: { userId, groupId, assignedByUserId: assignedByUserId ?? null },
      update: { groupId, assignedByUserId: assignedByUserId ?? null, assignedAt: new Date() },
    });

    return {
      groupId: group.id,
      groupName: group.name,
      groupLabel: group.label,
    };
  }
}
