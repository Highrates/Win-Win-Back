import { BadRequestException, Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { EmailTestSendResult } from '@win-win/admin-sections';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { MailService } from '../auth/mail.service';
import { PreviewEmailNotificationDto, UpdateEmailNotificationDto } from './dto/email-notifications-admin.dto';
import { EmailNotificationsService } from './email-notifications.service';

/** Тест уходит на свой же email, но SMTP-квота общая — ограничиваем на сотрудника (счётчик в БД, общий для реплик). */
export const TEST_SEND_LIMIT = { max: 5, windowMs: 10 * 60_000 } as const;
const TEST_SEND_TOO_MANY = 'Слишком много тестовых писем. Можно отправить 5 писем за 10 минут — попробуйте позже.';

@Controller('settings/admin/email-notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class EmailNotificationsAdminController {
  constructor(
    private readonly notifications: EmailNotificationsService,
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  @Get()
  list() {
    return this.notifications.list();
  }

  @Get(':eventKey')
  get(@Param('eventKey') eventKey: string) {
    return this.notifications.get(eventKey);
  }

  @Get(':eventKey/revisions')
  revisions(@Param('eventKey') eventKey: string) {
    return this.notifications.listRevisions(eventKey);
  }

  @Put(':eventKey')
  update(
    @CurrentUser('sub') actorUserId: string,
    @Param('eventKey') eventKey: string,
    @Body() dto: UpdateEmailNotificationDto,
  ) {
    return this.notifications.update(eventKey, dto, actorUserId);
  }

  @Post(':eventKey/preview')
  preview(@Param('eventKey') eventKey: string, @Body() dto: PreviewEmailNotificationDto) {
    return this.notifications.preview(eventKey, this.mail.mailContext(), dto);
  }

  /** Демо-письмо на email текущего сотрудника; выключенное уведомление тоже отправляется. */
  @Post(':eventKey/test-send')
  async testSend(
    @CurrentUser('sub') actorUserId: string,
    @Param('eventKey') eventKey: string,
    @Body() dto: PreviewEmailNotificationDto,
  ): Promise<EmailTestSendResult> {
    const user = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { email: true } });
    const to = user?.email?.trim();
    if (!to) throw new BadRequestException('У вашей учётной записи не указан email');
    const content = await this.notifications.preview(eventKey, this.mail.mailContext(), dto);
    await this.rateLimit.consumeSlot(
      `email-test:${actorUserId}`,
      TEST_SEND_LIMIT.max,
      TEST_SEND_LIMIT.windowMs,
      TEST_SEND_TOO_MANY,
    );
    await this.mail.sendTest(to, content);
    return { ok: true, to };
  }
}
