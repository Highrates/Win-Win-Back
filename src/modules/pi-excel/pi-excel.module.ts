import { Module } from '@nestjs/common';
import { PiExcelService } from './pi-excel.service';

@Module({
  providers: [PiExcelService],
  exports: [PiExcelService],
})
export class PiExcelModule {}
