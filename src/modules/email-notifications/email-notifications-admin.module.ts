import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailNotificationsAdminController } from './email-notifications-admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [EmailNotificationsAdminController],
})
export class EmailNotificationsAdminModule {}
