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
    @Body() body: { productVariantId: string; quantity?: number },
  ) {
    return this.cartService.addItem(userId, body.productVariantId, body.quantity ?? 1);
  }

  @Post('items/:productVariantId')
  updateItem(
    @CurrentUser('sub') userId: string,
    @Param('productVariantId') productVariantId: string,
    @Body() body: { quantity: number },
  ) {
    return this.cartService.updateItem(userId, productVariantId, body.quantity);
  }

  @Delete('items/:productVariantId')
  removeItem(@CurrentUser('sub') userId: string, @Param('productVariantId') productVariantId: string) {
    return this.cartService.removeItem(userId, productVariantId);
  }

  @Delete()
  clear(@CurrentUser('sub') userId: string) {
    return this.cartService.clear(userId);
  }
}
