import { Body, Controller, Get, Headers, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';
import { userIdFromBearerHeader } from '../../common/utils/optional-bearer-user-id';
import { ResolveProductIdsDto } from './dto/resolve-product-ids.dto';

@Controller('catalog')
export class CatalogController {
  constructor(
    private catalogService: CatalogService,
    private jwtService: JwtService,
  ) {}

  /** Компактное дерево (корни и рекурсивные активные потомки), без дублирования узлов между ветками. */
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

  /** Контекстные теги каталога для навигации. */
  @Public()
  @Get('tags')
  catalogTagsNav() {
    return this.catalogService.getCatalogTagsNav();
  }

  /** Контекстный тег по slug (обложка и название). */
  @Public()
  @Get('tags/:slug')
  catalogTagBySlug(@Param('slug') slug: string) {
    return this.catalogService.getCatalogTagBySlug(slug);
  }

  /** Категории для полосы ScrollCatalog на главной при выбранном теге. */
  @Public()
  @Get('tags/:slug/strip-categories')
  tagStripCategories(@Param('slug') slug: string) {
    return this.catalogService.getTagStripCategories(slug);
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

  /** Все активные товарные коллекции и наборы (полный состав). */
  @Public()
  @Get('collections-and-sets')
  async collectionsAndSets(@Headers('authorization') authorization: string | undefined) {
    const userId = userIdFromBearerHeader(this.jwtService, authorization);
    return this.catalogService.listPublicCollectionsAndSets(userId);
  }

  /** Кураторская коллекция по slug: бренды (`kind: BRAND`) или товары (`kind: PRODUCT`). */
  @Public()
  @Get('curated-collections/:slug')
  async curatedCollectionBySlug(
    @Headers('authorization') authorization: string | undefined,
    @Param('slug') slug: string,
  ) {
    const userId = userIdFromBearerHeader(this.jwtService, authorization);
    const brands = await this.catalogService.getCuratedBrandCollectionBySlug(slug);
    if (brands) return brands;
    const products = await this.catalogService.getCuratedProductCollectionBySlug(slug, userId);
    if (!products) throw new NotFoundException();
    return products;
  }

  @Public()
  @Post('products/resolve-ids')
  resolveProductIds(@Body() dto: ResolveProductIdsDto) {
    return this.catalogService.resolveProductSummariesByIds(dto.ids ?? []);
  }

  @Public()
  @Get('products/search')
  search(
    @Headers('authorization') authorization: string | undefined,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('tag') tag?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('priceFrom') priceFrom?: string,
    @Query('priceTo') priceTo?: string,
    @Query('widthFrom') widthFrom?: string,
    @Query('widthTo') widthTo?: string,
    @Query('heightFrom') heightFrom?: string,
    @Query('heightTo') heightTo?: string,
    @Query('materialId') materialId?: string,
    @Query('hasCase') hasCase?: string,
    @Query('has3d') has3d?: string,
    @Query('hasDrawing') hasDrawing?: string,
  ) {
    const userId = userIdFromBearerHeader(this.jwtService, authorization);
    return this.catalogService.searchProducts({
      q,
      categoryId,
      brandId,
      tagSlug: tag,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      userId,
      sort,
      priceFrom: priceFrom != null && priceFrom !== '' ? Number(priceFrom) : undefined,
      priceTo: priceTo != null && priceTo !== '' ? Number(priceTo) : undefined,
      widthFrom,
      widthTo,
      heightFrom,
      heightTo,
      materialId,
      hasCase,
      has3d,
      hasDrawing,
    });
  }

  /** Опции панели фильтров (материалы / бренды) с учётом активных фильтров. */
  @Public()
  @Get('products/filter-options')
  productFilterOptions(
    @Query('categoryId') categoryId?: string,
    @Query('brandId') brandId?: string,
    @Query('tag') tag?: string,
    @Query('priceFrom') priceFrom?: string,
    @Query('priceTo') priceTo?: string,
    @Query('widthFrom') widthFrom?: string,
    @Query('widthTo') widthTo?: string,
    @Query('heightFrom') heightFrom?: string,
    @Query('heightTo') heightTo?: string,
    @Query('materialId') materialId?: string,
    @Query('hasCase') hasCase?: string,
    @Query('has3d') has3d?: string,
    @Query('hasDrawing') hasDrawing?: string,
  ) {
    return this.catalogService.getProductFilterOptions({
      categoryId,
      brandId,
      tagSlug: tag,
      priceFrom: priceFrom != null && priceFrom !== '' ? Number(priceFrom) : undefined,
      priceTo: priceTo != null && priceTo !== '' ? Number(priceTo) : undefined,
      widthFrom,
      widthTo,
      heightFrom,
      heightTo,
      materialId,
      hasCase,
      has3d,
      hasDrawing,
    });
  }

  /** Товары из тех же активных кураторских наборов (без текущего товара). */
  @Public()
  @Get('products/:slug/set-siblings')
  productSetSiblings(
    @Headers('authorization') authorization: string | undefined,
    @Param('slug') slug: string,
  ) {
    const userId = userIdFromBearerHeader(this.jwtService, authorization);
    return this.catalogService.getProductSiblingsFromCuratedSets(slug, userId);
  }

  @Public()
  @Get('products/:slug')
  product(
    @Headers('authorization') authorization: string | undefined,
    @Param('slug') slug: string,
    @Query('vs') vs?: string,
    @Query('v') v?: string,
    /** Размер (id или sizeSlug) без выбора SKU — фильтр галереи и цены */
    @Query('sz') sz?: string,
  ) {
    const userId = userIdFromBearerHeader(this.jwtService, authorization);
    const variantSlug = vs?.trim();
    const variantId = v?.trim();
    const sizeParam = sz?.trim();
    return this.catalogService.getProductBySlug(slug, {
      ...(variantSlug ? { variantSlug } : {}),
      ...(variantId ? { variantId } : {}),
      ...(sizeParam ? { sizeParam } : {}),
      userId,
    });
  }
}
