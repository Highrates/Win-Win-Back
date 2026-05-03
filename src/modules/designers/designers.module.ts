import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DesignersService } from './designers.service';
import { DesignersController } from './designers.controller';

@Module({
  imports: [CatalogModule],
  providers: [DesignersService],
  controllers: [DesignersController],
  exports: [DesignersService],
})
export class DesignersModule {}
