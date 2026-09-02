import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetUserGroupMembershipAdminDto } from '../user-groups/dto/user-group-admin.dto';
import { UserGroupsService } from '../user-groups/user-groups.service';
import { UsersService } from './users.service';

/** Список покупателей (роль USER) для админки. */
@Controller('users/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class UsersAdminController {
  constructor(
    private readonly users: UsersService,
    private readonly userGroups: UserGroupsService,
  ) {}

  @Get('partner-applications/pending-count')
  partnerApplicationsPendingCount() {
    return this.users.countPendingPartnerApplicationsForAdmin();
  }

  @Get('signup-summary')
  signupSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.users.getDashboardSignupSummaryForAdmin({
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }

  @Get('partners-summary')
  partnersSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.users.getDashboardPartnersSummaryForAdmin({
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }

  @Get('partner-applications')
  listPartnerApplications(
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(20), ParseIntPipe) take: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.users.listPartnerApplicationsForAdmin({
      skip,
      take,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }

  @Post('partner-applications/:id/approve')
  approveWinWin(@Param('id') id: string) {
    return this.users.approveWinWinPartnerByAdmin(id);
  }

  @Post('partner-applications/:id/reject')
  rejectWinWin(@Param('id') id: string) {
    return this.users.rejectWinWinPartnerByAdmin(id);
  }

  @Get(':id/referral-structure')
  winWinReferralStructure(@Param('id') id: string) {
    return this.users.getWinWinReferralStructureForAdmin(id);
  }

  /** Найти приглашающего партнёра по публичному реф. коду. */
  @Get('by-winwin-referral-code/resolve')
  async resolveByWinWinReferralCode(@Query('code') code?: string) {
    const raw = (code ?? '').trim();
    if (raw.length < 3) return { userId: null as null };
    const hit = await this.users.findActivePartnerByWinWinPublicReferralCodeForAdmin(raw);
    return { userId: hit?.userId ?? null };
  }

  /** Кто пригласил пользователя (родитель в структуре). */
  @Get(':id/winwin-inviter')
  winWinInviter(@Param('id') id: string) {
    return this.users.getWinWinReferralInviterForAdmin(id);
  }

  @Get()
  list(
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take: number,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const t = Math.min(Math.max(take, 1), 100);
    return this.users.listRetailUsers({
      skip: Math.max(skip, 0),
      take: t,
      q,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }

  @Get(':id/group')
  userGroup(@Param('id') id: string) {
    return this.userGroups.getMembershipForUser(id);
  }

  @Put(':id/group')
  setUserGroup(
    @Param('id') id: string,
    @Body() dto: SetUserGroupMembershipAdminDto,
    @CurrentUser('sub') adminUserId: string,
  ) {
    const groupId = dto.groupId === undefined ? null : dto.groupId;
    return this.userGroups.setMembershipForUser(id, groupId, adminUserId);
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.users.findRetailUserByIdForAdmin(id);
  }

  @Delete(':id')
  @HttpCode(204)
  deleteRetail(@CurrentUser('sub') actorUserId: string, @Param('id') id: string) {
    return this.users.deleteRetailUserForAdmin(actorUserId, id);
  }
}
