import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LikesService } from './likes.service';

@Controller('likes')
@UseGuards(JwtAuthGuard)
export class LikesController {
  constructor(private readonly likes: LikesService) {}

  @Get('collection')
  collection(@CurrentUser('sub') userId: string) {
    return this.likes.getCollection(userId);
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
}
