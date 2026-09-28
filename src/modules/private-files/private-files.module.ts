import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { StaffModule } from '../staff/staff.module';
import { StorageModule } from '../storage/storage.module';
import { PrivateFilesController } from './private-files.controller';
import { PrivateFilesService } from './private-files.service';

@Module({
  imports: [PrismaModule, StorageModule, StaffModule, AuthModule],
  controllers: [PrivateFilesController],
  providers: [PrivateFilesService],
})
export class PrivateFilesModule {}
