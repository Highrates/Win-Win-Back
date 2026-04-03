import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { MediaLibraryService } from './media-library.service';
import { MediaLibraryAdminController } from './media-library-admin.controller';
import { MediaLibraryRetentionService } from './media-library-retention.service';

@Module({
  imports: [PrismaModule, StorageModule],
  providers: [MediaLibraryService, MediaLibraryRetentionService],
  controllers: [MediaLibraryAdminController],
  exports: [MediaLibraryService],
})
export class MediaLibraryModule {}
