import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { SourcingRequestsService } from './sourcing-requests.service';
import { UpdateSourcingRequestStatusDto } from './dto/update-sourcing-status.dto';
import { parseSourcingListLimit, parseSourcingListPage } from './sourcing-limits.constants';
import { OrderChatService } from '../order-chat/order-chat.service';

@Controller('sourcing-requests/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class SourcingRequestsAdminController {
  constructor(
    private readonly sourcing: SourcingRequestsService,
    private readonly orderChat: OrderChatService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('q') q?: string,
    @Query('userId') userId?: string,
    @Query('bucket') bucket?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.sourcing.findManyForAdmin(
      parseSourcingListPage(pageRaw),
      parseSourcingListLimit(limitRaw),
      q?.trim() || undefined,
      userId?.trim() || undefined,
      bucket?.trim() || undefined,
      user.sub,
      {
        from: from?.trim() || undefined,
        to: to?.trim() || undefined,
      },
    );
  }

  @Get('pending-review-count')
  pendingReviewCount() {
    return this.sourcing.countPendingReviewForAdmin();
  }

  @Get('dashboard-status-summary')
  dashboardStatusSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.sourcing.getDashboardStatusSummaryForAdmin({
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }

  @Get('chat-unread-summary')
  chatUnreadSummary(@CurrentUser() user: JwtPayload) {
    return this.orderChat.unreadSourcingCustomerChatSummaryForAdminBuckets(user.sub);
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const row = await this.sourcing.findOneForAdmin(id);
    if (!row) throw new NotFoundException();
    return row;
  }

  /** Same status → 200 без audit (идемпотентность). */
  @Patch(':id/status')
  patchStatus(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateSourcingRequestStatusDto,
  ) {
    return this.sourcing.updateStatus(id, dto.status, user.sub);
  }

  /** Удаление новой заявки (до начала работы). */
  @Delete(':id')
  @HttpCode(204)
  async deletePendingReview(@Param('id') id: string) {
    await this.sourcing.deletePendingReviewForAdmin(id);
  }
}
