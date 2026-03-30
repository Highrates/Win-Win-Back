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
  add(@CurrentUser('sub') userId: string, @Body() body: { productId: string }) {
    return this.favoritesService.add(userId, body.productId);
  }

  @Delete(':productId')
  remove(@CurrentUser('sub') userId: string, @Param('productId') productId: string) {
    return this.favoritesService.remove(userId, productId);
  }
}
