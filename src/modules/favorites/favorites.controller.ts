import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private favoritesService: FavoritesService) {}

  @Get()
  findAll(@CurrentUser('sub') userId: string) {
    return this.favoritesService.findAll(userId);
  }

  @Post()
  add(@CurrentUser('sub') userId: string, @Body() body: { productVariantId: string }) {
    return this.favoritesService.add(userId, body.productVariantId);
  }

  @Delete(':productVariantId')
  remove(
    @CurrentUser('sub') userId: string,
    @Param('productVariantId') productVariantId: string,
  ) {
    return this.favoritesService.remove(userId, productVariantId);
  }
}
