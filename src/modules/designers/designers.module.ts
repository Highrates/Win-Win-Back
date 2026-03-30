import { Module } from '@nestjs/common';
import { DesignersService } from './designers.service';
import { DesignersController } from './designers.controller';

@Module({
  providers: [DesignersService],
  controllers: [DesignersController],
  exports: [DesignersService],
})
export class DesignersModule {}
