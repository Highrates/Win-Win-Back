import { Global, Module, forwardRef } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { StaffAdminController } from './staff-admin.controller';
import { StaffSelfController } from './staff-self.controller';
import { StaffAccessService } from './staff-access.service';
import { StaffAdminService } from './staff-admin.service';

@Global()
@Module({
  imports: [AuditModule, forwardRef(() => AuthModule), UsersModule],
  controllers: [StaffSelfController, StaffAdminController],
  providers: [StaffAccessService, StaffAdminService, RolesGuard],
  exports: [StaffAccessService, StaffAdminService, RolesGuard],
})
export class StaffModule {}
