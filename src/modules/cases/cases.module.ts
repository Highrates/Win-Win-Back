import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MediaLibraryModule } from '../media-library/media-library.module';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

@Module({
  imports: [PrismaModule, MediaLibraryModule],
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}

