import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LikesService, type LikesCollectionQuery } from './likes.service';

const COLLECTION_MAX_LIMIT = 100;
const COLLECTION_DEFAULT_LIMIT = 40;

function parseCollectionLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 0), COLLECTION_MAX_LIMIT);
}

function parseCollectionOffset(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 500_000);
}

@Controller('likes')
@UseGuards(JwtAuthGuard)
export class LikesController {
  constructor(private readonly likes: LikesService) {}

  @Get('collection')
  collection(
    @CurrentUser('sub') userId: string,
    @Query('productsLimit') productsLimit?: string,
    @Query('productsOffset') productsOffset?: string,
    @Query('casesLimit') casesLimit?: string,
    @Query('casesOffset') casesOffset?: string,
    @Query('designersLimit') designersLimit?: string,
    @Query('designersOffset') designersOffset?: string,
  ) {
    const q: LikesCollectionQuery = {
      productsLimit: parseCollectionLimit(productsLimit, COLLECTION_DEFAULT_LIMIT),
      productsOffset: parseCollectionOffset(productsOffset),
      casesLimit: parseCollectionLimit(casesLimit, COLLECTION_DEFAULT_LIMIT),
      casesOffset: parseCollectionOffset(casesOffset),
      designersLimit: parseCollectionLimit(designersLimit, COLLECTION_DEFAULT_LIMIT),
      designersOffset: parseCollectionOffset(designersOffset),
    };
    return this.likes.getCollection(userId, q);
  }

  @Get('products/:productId/me')
  productMe(@CurrentUser('sub') userId: string, @Param('productId') productId: string) {
    return this.likes.isProductLiked(userId, productId);
  }

  @Post('products/:productId')
  likeProduct(@CurrentUser('sub') userId: string, @Param('productId') productId: string) {
    return this.likes.likeProduct(userId, productId);
  }

  @Delete('products/:productId')
  unlikeProduct(@CurrentUser('sub') userId: string, @Param('productId') productId: string) {
    return this.likes.unlikeProduct(userId, productId);
  }

  @Get('cases/:caseId/me')
  caseMe(@CurrentUser('sub') userId: string, @Param('caseId') caseId: string) {
    return this.likes.isCaseLiked(userId, caseId);
  }

  @Post('cases/:caseId')
  likeCase(@CurrentUser('sub') userId: string, @Param('caseId') caseId: string) {
    return this.likes.likeCase(userId, caseId);
  }

  @Delete('cases/:caseId')
  unlikeCase(@CurrentUser('sub') userId: string, @Param('caseId') caseId: string) {
    return this.likes.unlikeCase(userId, caseId);
  }

  @Get('designers/:designerId/me')
  designerMe(@CurrentUser('sub') userId: string, @Param('designerId') designerId: string) {
    return this.likes.isDesignerLiked(userId, designerId);
  }

  @Post('designers/:designerId')
  likeDesigner(@CurrentUser('sub') userId: string, @Param('designerId') designerId: string) {
    return this.likes.likeDesigner(userId, designerId);
  }

  @Delete('designers/:designerId')
  unlikeDesigner(@CurrentUser('sub') userId: string, @Param('designerId') designerId: string) {
    return this.likes.unlikeDesigner(userId, designerId);
  }

  /** Read-only batch (один SQL); не считаем в общий 100 req/min — иначе 429 на «тяжёлых» страницах. */
  @SkipThrottle()
  @Post('designers/me/bulk')
  designersMeBulk(
    @CurrentUser('sub') userId: string,
    @Body() body: { designerIds?: unknown },
  ) {
    const raw = body?.designerIds;
    const ids = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 80)
      : [];
    return this.likes.designersMeBulk(userId, ids);
  }

  @SkipThrottle()
  @Post('products/me/bulk')
  productsMeBulk(
    @CurrentUser('sub') userId: string,
    @Body() body: { productIds?: unknown },
  ) {
    const raw = body?.productIds;
    const ids = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 80)
      : [];
    return this.likes.productsMeBulk(userId, ids);
  }

  @SkipThrottle()
  @Post('cases/me/bulk')
  casesMeBulk(@CurrentUser('sub') userId: string, @Body() body: { caseIds?: unknown }) {
    const raw = body?.caseIds;
    const ids = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 80)
      : [];
    return this.likes.casesMeBulk(userId, ids);
  }
}
