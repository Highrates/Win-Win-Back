import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';

@Module({
  imports: [CatalogModule],
  providers: [LikesService],
  controllers: [LikesController],
})
export class LikesModule {}
