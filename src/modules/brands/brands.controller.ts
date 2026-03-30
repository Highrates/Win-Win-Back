import { Controller, Get, Param } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('brands')
export class BrandsController {
  constructor(private brandsService: BrandsService) {}

  @Public()
  @Get()
  findAll() {
    return this.brandsService.findAll();
  }

  @Public()
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.brandsService.findBySlug(slug);
  }
}
