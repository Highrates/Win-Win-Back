import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProjectsController } from './projects.controller';
import { ProjectsFeedService } from './projects-feed.service';

@Module({
  imports: [PrismaModule, CatalogModule],
  controllers: [ProjectsController],
  providers: [ProjectsFeedService],
  exports: [ProjectsFeedService],
})
export class ProjectsModule {}
