import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { ProductQaMessageStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import {
  CreateProductQaTopicDto,
  PatchProductQaMessageDto,
  PatchProductQaTopicDto,
  RevokeProductQaUploadDto,
} from './dto/product-qa.dto';
import { PRODUCT_QA_UPLOAD_MAX_FILE_BYTES, PRODUCT_QA_UPLOAD_THROTTLE } from './product-qa.constants';
import { ProductQaService } from './product-qa.service';

const uploadMem = memoryStorage();

@Controller('catalog/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class ProductQaAdminController {
  constructor(private readonly qa: ProductQaService) {}

  @Get('qa/unread-summary')
  qaUnreadSummary(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.qa.getStaffQaUnreadSummary(user.sub, user.role, {
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
    });
  }

  @Get('qa/pending-summary')
  qaPendingSummary(@CurrentUser() user: JwtPayload) {
    return this.qa.getStaffQaPendingSummary(user.sub, user.role);
  }

  @Get('qa/chat-products')
  qaChatProducts(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursorRaw?: string,
  ) {
    let limit: number | undefined;
    if (limitRaw != null && limitRaw.trim() !== '') {
      const n = parseInt(limitRaw, 10);
      if (!Number.isFinite(n)) throw new BadRequestException('limit');
      limit = n;
    }
    return this.qa.getStaffQaChatProducts(user.sub, user.role, {
      limit,
      cursor: cursorRaw?.trim() || undefined,
    });
  }

  @Post('products/:id/qa/mark-seen')
  markQaSeen(@CurrentUser() user: JwtPayload, @Param('id') productId: string) {
    return this.qa.markProductQaSeen(user.sub, user.role, productId);
  }

  @Get('products/:id/qa/topics')
  topics(@CurrentUser() user: JwtPayload, @Param('id') productId: string) {
    return this.qa.listTopicsForProductAsStaff(user.sub, user.role, productId);
  }

  @Post('products/:id/qa/topics')
  createTopic(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Body() dto: CreateProductQaTopicDto,
  ) {
    return this.qa.createTopic(productId, user.sub, user.role, dto);
  }

  @Patch('products/:id/qa/topics/:topicId')
  patchTopic(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Param('topicId') topicId: string,
    @Body() dto: PatchProductQaTopicDto,
  ) {
    return this.qa.patchTopic(productId, topicId, user.sub, user.role, dto);
  }

  @Get('products/:id/qa/messages')
  messages(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeMessageIdRaw?: string,
    @Query('topic') topicSlugRaw?: string,
    @Query('status') statusRaw?: string,
  ) {
    let limitParsed: number | undefined;
    if (limitRaw != null && limitRaw.trim() !== '') {
      const n = parseInt(limitRaw, 10);
      if (!Number.isFinite(n)) throw new BadRequestException('limit');
      limitParsed = n;
    }
    const statusTrim = statusRaw?.trim().toUpperCase();
    let statusParsed: ProductQaMessageStatus | undefined;
    if (statusTrim) {
      if (!Object.values(ProductQaMessageStatus).includes(statusTrim as ProductQaMessageStatus)) {
        throw new BadRequestException('status');
      }
      statusParsed = statusTrim as ProductQaMessageStatus;
    }
    return this.qa.listMessagesForProductAsStaff(user.sub, user.role, productId, {
      limit: limitParsed,
      beforeMessageId: beforeMessageIdRaw?.trim() || undefined,
      includeNonVisible: true,
      topicSlug: topicSlugRaw?.trim() || undefined,
      status: statusParsed,
    });
  }

  /** Закрыто: staff отвечает через private correspondence + curated publish. */
  @Post('products/:id/qa/messages')
  post() {
    throw new ForbiddenException(
      'Ответы staff — только через private correspondence; публикация на витрину — curated publish Q→A',
    );
  }

  @Post('products/:id/qa/upload')
  @Throttle(PRODUCT_QA_UPLOAD_THROTTLE)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadMem,
      limits: { fileSize: PRODUCT_QA_UPLOAD_MAX_FILE_BYTES },
    }),
  )
  upload(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    return this.qa.uploadAttachment(productId, user.sub, user.role, file);
  }

  @Delete('products/:id/qa/upload')
  revokeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Body() dto: RevokeProductQaUploadDto,
  ) {
    return this.qa.revokePendingUpload(productId, user.sub, dto.url);
  }

  @Post('products/:id/qa/messages/:messageId/approve')
  approvePending(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.qa.approvePendingMessage(productId, messageId, user.sub, user.role);
  }

  @Post('products/:id/qa/messages/:messageId/reject')
  rejectPending(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.qa.rejectPendingMessage(productId, messageId, user.sub, user.role);
  }

  @Patch('products/:id/qa/messages/:messageId')
  patchMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Param('messageId') messageId: string,
    @Body() dto: PatchProductQaMessageDto,
  ) {
    const hasBody = dto.body != null && dto.body.trim() !== '';
    const hasStatus = dto.status != null;
    if (hasBody && hasStatus) {
      throw new BadRequestException('Укажите body или status, не оба');
    }
    if (hasBody) {
      return this.qa.editMessageForProduct(
        productId,
        messageId,
        user.sub,
        user.role,
        dto.body!,
      );
    }
    if (hasStatus) {
      if (
        dto.status !== ProductQaMessageStatus.VISIBLE &&
        dto.status !== ProductQaMessageStatus.HIDDEN
      ) {
        throw new BadRequestException('Допустимы статусы VISIBLE или HIDDEN');
      }
      return this.qa.setMessageStatus(
        productId,
        messageId,
        user.sub,
        user.role,
        dto.status,
      );
    }
    throw new BadRequestException('body или status обязателен');
  }

  @Get('products/:id/qa/messages/:messageId/revisions')
  messageRevisions(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.qa.listMessageRevisions(productId, messageId, user.sub, user.role);
  }

  @Post('products/:id/qa/messages/:messageId/delete')
  softDelete(
    @CurrentUser() user: JwtPayload,
    @Param('id') productId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.qa.setMessageStatus(
      productId,
      messageId,
      user.sub,
      user.role,
      ProductQaMessageStatus.DELETED,
    );
  }
}
