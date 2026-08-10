import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProductCorrespondenceService } from './product-correspondence.service';

@Controller('catalog/me/correspondence')
@UseGuards(JwtAuthGuard)
export class ProductCorrespondenceMeController {
  constructor(private readonly correspondence: ProductCorrespondenceService) {}

  @Get('products')
  listMyProducts(@CurrentUser('sub') userId: string) {
    return this.correspondence.listMyProducts(userId);
  }
}
