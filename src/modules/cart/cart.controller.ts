import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private cartService: CartService) {}

  @Get()
  get(@CurrentUser('sub') userId: string) {
    return this.cartService.getOrCreateCart(userId);
  }

  @Post('items')
  addItem(
    @CurrentUser('sub') userId: string,
    @Body() body: { productId: string; quantity?: number },
  ) {
    return this.cartService.addItem(userId, body.productId, body.quantity ?? 1);
  }

  @Post('items/:productId')
  updateItem(
    @CurrentUser('sub') userId: string,
    @Param('productId') productId: string,
    @Body() body: { quantity: number },
  ) {
    return this.cartService.updateItem(userId, productId, body.quantity);
  }

  @Delete('items/:productId')
  removeItem(@CurrentUser('sub') userId: string, @Param('productId') productId: string) {
    return this.cartService.removeItem(userId, productId);
  }

  @Delete()
  clear(@CurrentUser('sub') userId: string) {
    return this.cartService.clear(userId);
  }
}
