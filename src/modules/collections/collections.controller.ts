import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('collections')
export class CollectionsController {
  constructor(private collectionsService: CollectionsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: { title: string; description?: string }) {
    return this.collectionsService.create(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  myCollections(@CurrentUser('sub') userId: string) {
    return this.collectionsService.findByUser(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/items')
  addProduct(@Param('id') collectionId: string, @CurrentUser('sub') userId: string, @Body() body: { productId: string }) {
    return this.collectionsService.addProduct(collectionId, userId, body.productId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/items/:productId')
  removeProduct(@Param('id') collectionId: string, @CurrentUser('sub') userId: string, @Param('productId') productId: string) {
    return this.collectionsService.removeProduct(collectionId, userId, productId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/share')
  createShareLink(@Param('id') collectionId: string, @CurrentUser('sub') userId: string) {
    return this.collectionsService.createShareLink(collectionId, userId);
  }

  @Public()
  @Get('shared')
  getByShareToken(@Query('token') token: string) {
    return this.collectionsService.getByShareToken(token);
  }
}
