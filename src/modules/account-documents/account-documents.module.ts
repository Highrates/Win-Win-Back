import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AccountDocumentsController } from './account-documents.controller';
import { AccountDocumentsService } from './account-documents.service';

@Module({
  imports: [PrismaModule, StorageModule, AuthModule],
  controllers: [AccountDocumentsController],
  providers: [AccountDocumentsService],
})
export class AccountDocumentsModule {}
