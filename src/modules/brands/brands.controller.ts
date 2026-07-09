import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BrandsService } from './brands.service';
import { Public } from '../../common/decorators/public.decorator';
import { userIdFromBearerHeader } from '../../common/utils/optional-bearer-user-id';

@Controller('brands')
export class BrandsController {
  constructor(
    private brandsService: BrandsService,
    private jwtService: JwtService,
  ) {}

  @Public()
  @Get()
  findAll(@Query('categoryId') categoryId?: string) {
    return this.brandsService.findAll(categoryId);
  }

  @Public()
  @Get(':slug')
  findBySlug(
    @Headers('authorization') authorization: string | undefined,
    @Param('slug') slug: string,
  ) {
    const userId = userIdFromBearerHeader(this.jwtService, authorization);
    return this.brandsService.findBySlug(slug, userId);
  }
}
