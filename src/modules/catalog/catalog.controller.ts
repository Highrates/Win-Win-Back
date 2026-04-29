import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';
import { ResolveProductIdsDto } from './dto/resolve-product-ids.dto';

@Controller('catalog')
export class CatalogController {
  constructor(private catalogService: CatalogService) {}

  /** Компактное дерево (корни + дети), без дублирования узлов в плоском списке. */
  @Public()
  @Get('categories/tree')
  categoryTree() {
    return this.catalogService.getCategoryTree();
  }

  /** Только корневые категории для навигации. */
  @Public()
  @Get('categories/roots')
  categoryRootsNav() {
    return this.catalogService.getCategoryRootsNav();
  }

  /** Активные подкатегории у корня с данным slug. */
  @Public()
  @Get('categories/:parentSlug/children')
  categoryChildren(@Param('parentSlug') parentSlug: string) {
    return this.catalogService.getCategoryChildrenByParentSlug(parentSlug);
  }

  /** @deprecated Предпочтительно `GET categories/tree` или `roots` + `children`. */
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

  /** Кураторская коллекция брендов по slug (`kind: BRAND`, активная). */
  @Public()
  @Get('curated-collections/:slug')
  async curatedBrandCollection(@Param('slug') slug: string) {
    const data = await this.catalogService.getCuratedBrandCollectionBySlug(slug);
    if (!data) throw new NotFoundException();
    return data;
  }

  @Public()
  @Post('products/resolve-ids')
  resolveProductIds(@Body() dto: ResolveProductIdsDto) {
    return this.catalogService.resolveProductSummariesByIds(dto.ids ?? []);
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

  /** Товары из тех же активных кураторских наборов (без текущего товара). */
  @Public()
  @Get('products/:slug/set-siblings')
  productSetSiblings(@Param('slug') slug: string) {
    return this.catalogService.getProductSiblingsFromCuratedSets(slug);
  }

  @Public()
  @Get('products/:slug')
  product(
    @Param('slug') slug: string,
    @Query('vs') vs?: string,
    @Query('v') v?: string,
    /** Размер (id или sizeSlug) без выбора SKU — фильтр галереи и цены */
    @Query('sz') sz?: string,
  ) {
    const variantSlug = vs?.trim();
    const variantId = v?.trim();
    const sizeParam = sz?.trim();
    return this.catalogService.getProductBySlug(slug, {
      ...(variantSlug ? { variantSlug } : {}),
      ...(variantId ? { variantId } : {}),
      ...(sizeParam ? { sizeParam } : {}),
    });
  }
}
