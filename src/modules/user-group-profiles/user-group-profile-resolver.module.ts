import { Module } from '@nestjs/common';
import { ProgramConfigSyncService } from './program-config-sync.service';
import { UserGroupProfileResolverService } from './user-group-profile-resolver.service';

@Module({
  providers: [UserGroupProfileResolverService, ProgramConfigSyncService],
  exports: [UserGroupProfileResolverService, ProgramConfigSyncService],
})
export class UserGroupProfileResolverModule {}
