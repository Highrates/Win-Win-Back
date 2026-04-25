import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';

/** Список покупателей (роль USER) для админки. */
@Controller('users/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class UsersAdminController {
  constructor(private readonly users: UsersService) {}

  @Get('partner-applications/pending-count')
  partnerApplicationsPendingCount() {
    return this.users.countPendingPartnerApplicationsForAdmin();
  }

  @Get('partner-applications')
  listPartnerApplications(
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(20), ParseIntPipe) take: number,
  ) {
    return this.users.listPartnerApplicationsForAdmin({ skip, take });
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
  ) {
    const t = Math.min(Math.max(take, 1), 100);
    return this.users.listRetailUsers({ skip: Math.max(skip, 0), take: t, q });
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.users.findRetailUserByIdForAdmin(id);
  }
}
