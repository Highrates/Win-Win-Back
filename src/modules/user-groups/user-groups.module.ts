import { Module } from '@nestjs/common';
import { UserGroupProfileResolverModule } from '../user-group-profiles/user-group-profile-resolver.module';
import { OrderProgramSnapshotService } from './order-program-snapshot.service';
import { UserGroupsAdminController } from './user-groups-admin.controller';
import { UserGroupsService } from './user-groups.service';

@Module({
  imports: [UserGroupProfileResolverModule],
  controllers: [UserGroupsAdminController],
  providers: [UserGroupsService, OrderProgramSnapshotService],
  exports: [UserGroupsService, OrderProgramSnapshotService],
})
export class UserGroupsModule {}
