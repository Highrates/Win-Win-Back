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

  /** Публичные проекты брендов (витрина `/projects`). Выше `:slug`. */
  @Public()
  @Get('cases')
  listPublicCases(
    @Query('brand') brand?: string,
    @Query('product') product?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.brandsService.listPublicCases({
      brandSlug: brand,
      productId: product,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 48,
    });
  }

  @Public()
  @Get(':slug')
  findBySlug(
    @Headers('authorization') authorization: string | undefined,
    @Param('slug') slug: string,
    @Query('categoryId') categoryId?: string,
  ) {
    const userId = userIdFromBearerHeader(this.jwtService, authorization);
    return this.brandsService.findBySlug(slug, userId, categoryId);
  }
}
