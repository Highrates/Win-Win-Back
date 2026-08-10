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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { PRODUCT_QA_POST_THROTTLE } from '../product-qa/product-qa.constants';
import {
  PostProductCorrespondenceMessageDto,
  PublishCorrespondenceToQaDto,
  PublishCorrespondencePairToQaDto,
  EditProductCorrespondenceMessageBodyDto,
} from './dto/product-correspondence.dto';
import { ProductCorrespondenceService } from './product-correspondence.service';

@Controller('catalog/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class ProductCorrespondenceAdminController {
  constructor(private readonly correspondence: ProductCorrespondenceService) {}

  @Get('products/:id/correspondence/threads')
  threads(@CurrentUser() user: JwtPayload, @Param('id') productId: string) {
    return this.correspondence.listThreadsForProductAsStaff(user.sub, user.role, productId);
  }

  @Get('products/:id/correspondence/messages')
  messages(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Query('customerUserId') customerUserIdRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeMessageIdRaw?: string,
  ) {
    const customerUserId = customerUserIdRaw?.trim();
    if (!customerUserId) {
      throw new BadRequestException('customerUserId обязателен');
    }
    let limitParsed: number | undefined;
    if (limitRaw != null && limitRaw.trim() !== '') {
      const n = parseInt(limitRaw, 10);
      if (!Number.isFinite(n)) throw new BadRequestException('limit');
      limitParsed = n;
    }
    return this.correspondence.listMessagesForProductAsStaff(
      user.sub,
      user.role,
      productId,
      customerUserId,
      {
        limit: limitParsed,
        beforeMessageId: beforeMessageIdRaw?.trim() || undefined,
      },
    );
  }

  @Post('products/:id/correspondence/messages')
  @Throttle(PRODUCT_QA_POST_THROTTLE)
  post(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Body() dto: PostProductCorrespondenceMessageDto,
  ) {
    const customerUserId = dto.customerUserId?.trim();
    if (!customerUserId) {
      throw new BadRequestException('customerUserId обязателен для ответа staff');
    }
    return this.correspondence.postForProduct(productId, user.sub, user.role, dto, {
      customerUserId,
    });
  }

  @Post('products/:id/correspondence/messages/:messageId/publish-to-qa')
  publishToQa(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Param('messageId') messageId: string,
    @Body() dto: PublishCorrespondenceToQaDto,
  ) {
    return this.correspondence.publishMessageToQa(
      productId,
      messageId,
      user.sub,
      user.role,
      dto,
    );
  }

  @Post('products/:id/correspondence/publish-pair-to-qa')
  publishPairToQa(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Body() dto: PublishCorrespondencePairToQaDto,
  ) {
    return this.correspondence.publishPairToQa(productId, user.sub, user.role, dto);
  }

  @Patch('products/:id/correspondence/messages/:messageId')
  patchBody(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditProductCorrespondenceMessageBodyDto,
    @Query('customerUserId') customerUserIdRaw?: string,
  ) {
    const customerUserId = customerUserIdRaw?.trim();
    if (!customerUserId) {
      throw new BadRequestException('customerUserId обязателен');
    }
    return this.correspondence.editMessageForProduct(
      productId,
      customerUserId,
      messageId,
      user.sub,
      user.role,
      dto.body,
    );
  }

  @Get('products/:id/correspondence/messages/:messageId/revisions')
  messageRevisions(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Param('messageId') messageId: string,
    @Query('customerUserId') customerUserIdRaw?: string,
  ) {
    const customerUserId = customerUserIdRaw?.trim();
    if (!customerUserId) {
      throw new BadRequestException('customerUserId обязателен');
    }
    return this.correspondence.listMessageRevisions(
      productId,
      customerUserId,
      messageId,
      user.sub,
      user.role,
    );
  }
}
