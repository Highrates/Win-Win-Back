import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SearchPublicController } from './search.public.controller';
import { SearchPublicService } from './search.public.service';

@Module({
  imports: [PrismaModule],
  controllers: [SearchPublicController],
  providers: [SearchPublicService],
})
export class SearchModule {}
