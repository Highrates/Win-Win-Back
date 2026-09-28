import { Global, Module } from '@nestjs/common';
import { EmailNotificationsService } from './email-notifications.service';

/** Глобальный, чтобы `MailService` (AuthModule) получал шаблоны без циклического импорта. */
@Global()
@Module({
  providers: [EmailNotificationsService],
  exports: [EmailNotificationsService],
})
export class EmailNotificationsModule {}
