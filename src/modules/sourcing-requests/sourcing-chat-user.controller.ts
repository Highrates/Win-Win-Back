import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrderChatService } from '../order-chat/order-chat.service';
import { ORDER_CHAT_UPLOAD_MAX_FILE_BYTES } from '../order-chat/order-chat.constants';
import { PostOrderChatMessageDto } from '../order-chat/dto/order-chat.dto';

const uploadMem = memoryStorage();

@Controller('sourcing-requests')
@UseGuards(JwtAuthGuard)
export class SourcingChatUserController {
  constructor(private readonly chat: OrderChatService) {}

  @Get(':id/chat/messages')
  messages(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeMessageIdRaw?: string,
  ) {
    return this.chat.listSourcingMessages(id, user.sub, user.role, {
      limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
      beforeMessageId: beforeMessageIdRaw?.trim() || undefined,
    });
  }

  @Post(':id/chat/messages')
  post(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: PostOrderChatMessageDto,
  ) {
    return this.chat.postSourcingMessage(id, user.sub, user.role, dto);
  }

  @Post(':id/chat/read')
  async read(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.chat.markSourcingRead(id, user.sub, user.role);
    return { ok: true as const };
  }

  @Post(':id/chat/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadMem,
      limits: { fileSize: ORDER_CHAT_UPLOAD_MAX_FILE_BYTES },
    }),
  )
  upload(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Файл не передан');
    return this.chat.uploadSourcingAttachment(id, user.sub, user.role, file);
  }

  @Delete(':id/chat/messages/:messageId')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    await this.chat.deleteSourcingMessage(id, messageId, user.sub, user.role);
    return { ok: true as const };
  }
}
