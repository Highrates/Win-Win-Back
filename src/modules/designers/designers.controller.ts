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

  @Public()
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.designersService.findBySlug(slug);
  }
}
