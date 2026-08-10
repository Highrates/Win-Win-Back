import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { PostProductQaMessageDto } from '../product-qa/dto/product-qa.dto';
import { PRODUCT_QA_POST_THROTTLE } from '../product-qa/product-qa.constants';
import { EditProductCorrespondenceMessageBodyDto } from './dto/product-correspondence.dto';
import { ProductCorrespondenceService } from './product-correspondence.service';

@Controller('catalog')
export class ProductCorrespondencePublicController {
  constructor(private readonly correspondence: ProductCorrespondenceService) {}

  @UseGuards(JwtAuthGuard)
  @Get('products/:slug/correspondence/messages')
  messages(
    @CurrentUser('sub') userId: string,
    @Param('slug') slug: string,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeMessageIdRaw?: string,
  ) {
    let limitParsed: number | undefined;
    if (limitRaw != null && limitRaw.trim() !== '') {
      const n = parseInt(limitRaw, 10);
      if (!Number.isFinite(n)) throw new BadRequestException('limit');
      limitParsed = n;
    }
    return this.correspondence.listMessagesBySlug(slug, userId, {
      limit: limitParsed,
      beforeMessageId: beforeMessageIdRaw?.trim() || undefined,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(PRODUCT_QA_POST_THROTTLE)
  @Post('products/:slug/correspondence/messages')
  post(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: PostProductQaMessageDto,
  ) {
    return this.correspondence.postBySlug(slug, user.sub, user.role, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('products/:slug/correspondence/messages/:messageId')
  patchBody(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditProductCorrespondenceMessageBodyDto,
  ) {
    return this.correspondence.editMessageBySlug(slug, messageId, user.sub, user.role, dto.body);
  }
}
