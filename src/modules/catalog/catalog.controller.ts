import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('catalog')
export class CatalogController {
  constructor(private catalogService: CatalogService) {}

  @Public()
  @Get('categories')
  categories() {
    return this.catalogService.getCategories();
  }

  @Public()
  @Get('categories/:slug')
  category(@Param('slug') slug: string) {
    return this.catalogService.getCategoryBySlug(slug);
  }

  @Public()
  @Get('products/search')
  search(
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.catalogService.searchProducts({
      q,
      categoryId,
      brandId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Public()
  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.catalogService.getProductBySlug(slug);
  }
}
