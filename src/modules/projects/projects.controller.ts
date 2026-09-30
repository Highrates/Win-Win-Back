import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ProjectsFeedService, type ProjectsFeedSource } from './projects-feed.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly feed: ProjectsFeedService) {}

  /**
   * Единая лента проектов витрины `/projects`: дизайнеры ∪ бренды, по дате.
   * Query: source=all|designers|brands, brand, product, room, hasProducts, page, limit.
   */
  @Public()
  @Get('cases')
  listPublicCases(
    @Query('source') source?: string,
    @Query('brand') brand?: string,
    @Query('productBrand') productBrand?: string,
    @Query('product') product?: string,
    @Query('room') room?: string,
    @Query('hasProducts') hasProductsRaw?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const src: ProjectsFeedSource =
      source === 'designers' || source === 'brands' || source === 'all' ? source : 'all';
    const hasProducts =
      hasProductsRaw === '1' || hasProductsRaw === 'true' || hasProductsRaw === 'yes';
    return this.feed.listFeed({
      source: src,
      brandSlug: brand,
      productBrandSlug: productBrand,
      productId: product,
      room,
      hasProducts,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 48,
    });
  }
}
