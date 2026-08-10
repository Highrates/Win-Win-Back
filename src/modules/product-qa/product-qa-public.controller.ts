import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
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
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { ProductQaAuthorRole } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { userIdFromBearerHeader } from '../../common/utils/optional-bearer-user-id';
import { PostProductQaMessageDto, RevokeProductQaUploadDto, EditProductQaMessageBodyDto } from './dto/product-qa.dto';
import {
  PRODUCT_QA_POST_THROTTLE,
  PRODUCT_QA_UPLOAD_MAX_FILE_BYTES,
  PRODUCT_QA_UPLOAD_THROTTLE,
} from './product-qa.constants';
import { ProductQaService } from './product-qa.service';
import { productQaAuthorRoleFromJwt } from './product-qa-auth.util';
import { ProductCorrespondenceService } from '../product-correspondence/product-correspondence.service';

const uploadMem = memoryStorage();

@Controller('catalog')
export class ProductQaPublicController {
  constructor(
    private readonly qa: ProductQaService,
    private readonly jwt: JwtService,
    private readonly correspondence: ProductCorrespondenceService,
  ) {}

  @Public()
  @Get('products/:slug/qa/meta')
  meta(@Param('slug') slug: string) {
    return this.qa.getMetaBySlug(slug);
  }

  @Public()
  @Get('products/:slug/qa/topics')
  topics(@Param('slug') slug: string) {
    return this.qa.listTopicsBySlug(slug);
  }

  @Public()
  @Get('products/:slug/qa/messages')
  messages(
    @Param('slug') slug: string,
    @Headers('authorization') authorization: string | undefined,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeMessageIdRaw?: string,
    @Query('cursor') cursorMessageIdRaw?: string,
    @Query('topic') topicSlugRaw?: string,
  ) {
    let limitParsed: number | undefined;
    if (limitRaw != null && limitRaw.trim() !== '') {
      const n = parseInt(limitRaw, 10);
      if (!Number.isFinite(n)) throw new BadRequestException('limit');
      limitParsed = n;
    }
    const beforeTrim = beforeMessageIdRaw?.trim();
    const cursorTrim = cursorMessageIdRaw?.trim();
    if (beforeTrim && cursorTrim && beforeTrim !== cursorTrim) {
      throw new BadRequestException('Не используйте разные значения параметров before и cursor');
    }
    const beforeMessageId = beforeTrim || cursorTrim || undefined;
    const viewerUserId = userIdFromBearerHeader(this.jwt, authorization);
    return this.qa.listMessagesBySlug(slug, {
      limit: limitParsed,
      beforeMessageId,
      topicSlug: topicSlugRaw?.trim() || undefined,
      viewerUserId,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(PRODUCT_QA_POST_THROTTLE)
  @Post('products/:slug/qa/messages')
  post(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: PostProductQaMessageDto,
  ) {
    const authorRole = productQaAuthorRoleFromJwt(user.role);
    if (authorRole === ProductQaAuthorRole.USER) {
      return this.correspondence.postBySlug(slug, user.sub, user.role, dto);
    }
    throw new ForbiddenException('Ответы staff — только через private correspondence в админке');
  }

  @UseGuards(JwtAuthGuard)
  @Patch('products/:slug/qa/messages/:messageId')
  patchBody(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditProductQaMessageBodyDto,
  ) {
    const authorRole = productQaAuthorRoleFromJwt(user.role);
    if (authorRole === ProductQaAuthorRole.USER) {
      throw new ForbiddenException(
        'Редактируйте вопрос в разделе «Мои вопросы» — изменения синхронизируются с витриной после публикации',
      );
    }
    throw new ForbiddenException(
      'Редактирование витрины — через админку (Product Q&A или переписка)',
    );
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(PRODUCT_QA_UPLOAD_THROTTLE)
  @Post('products/:slug/qa/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadMem,
      limits: { fileSize: PRODUCT_QA_UPLOAD_MAX_FILE_BYTES },
    }),
  )
  upload(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Файл не передан');
    return this.qa
      .resolveActiveProductBySlug(slug)
      .then((p) => this.qa.uploadAttachment(p.id, user.sub, user.role, file));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('products/:slug/qa/upload')
  revokeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: RevokeProductQaUploadDto,
  ) {
    return this.qa
      .resolveActiveProductBySlug(slug)
      .then((p) => this.qa.revokePendingUpload(p.id, user.sub, dto.url));
  }
}
