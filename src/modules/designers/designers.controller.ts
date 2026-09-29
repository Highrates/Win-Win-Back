import { Controller, Get, Param, Query } from '@nestjs/common';
import { DesignersService } from './designers.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('designers')
export class DesignersController {
  constructor(private designersService: DesignersService) {}

  @Public()
  @Get()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string, @Query('q') q?: string) {
    return this.designersService.findAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      q,
    );
  }

  /** Все публичные кейсы партнёров (витрина `/projects`). Должен быть выше `:slug`, иначе `cases` станет slug. */
  @Public()
  @Get('cases')
  listPublicCases(
    @Query('product') product?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.designersService.listAllPublicCases(
      product,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 48,
    );
  }

  @Public()
  @Get(':slug')
  findBySlug(
    @Param('slug') slug: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('hasProducts') hasProducts?: string,
  ) {
    const withProducts =
      hasProducts === '1' || hasProducts === 'true' || hasProducts === 'yes';
    return this.designersService.findBySlug(
      slug,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 36,
      withProducts,
    );
  }
}
