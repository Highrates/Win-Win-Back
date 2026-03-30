import { Module } from '@nestjs/common';
import { PublicCollectionsService } from './public-collections.service';
import { PublicCollectionsController } from './public-collections.controller';

@Module({
  providers: [PublicCollectionsService],
  controllers: [PublicCollectionsController],
  exports: [PublicCollectionsService],
})
export class PublicCollectionsModule {}
