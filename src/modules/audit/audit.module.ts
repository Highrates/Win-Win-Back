import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditAdminController } from './audit-admin.controller';
import { AuthSecurityMonitorService } from './auth-security-monitor.service';
import { AuthSecurityExceptionFilter } from './auth-security.exception-filter';

@Global()
@Module({
  controllers: [AuditAdminController],
  providers: [AuditService, AuthSecurityMonitorService, AuthSecurityExceptionFilter],
  exports: [AuditService, AuthSecurityExceptionFilter],
})
export class AuditModule {}
