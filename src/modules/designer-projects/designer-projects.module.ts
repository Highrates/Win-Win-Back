import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DesignerProjectsController } from './designer-projects.controller';
import { DesignerProjectsService } from './designer-projects.service';

@Module({
  imports: [PrismaModule],
  controllers: [DesignerProjectsController],
  providers: [DesignerProjectsService],
  exports: [DesignerProjectsService],
})
export class DesignerProjectsModule {}
