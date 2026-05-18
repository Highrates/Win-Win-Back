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
import { UserRole } from '@prisma/client';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrderChatService } from './order-chat.service';
import { ORDER_CHAT_UPLOAD_MAX_FILE_BYTES } from './order-chat.constants';
import { PostOrderChatMessageDto } from './dto/order-chat.dto';

const uploadMem = memoryStorage();

@Controller('orders/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class OrderChatAdminController {
  constructor(private readonly chat: OrderChatService) {}

  @Get('chat/unread-count')
  async unreadStaff(@CurrentUser('sub') staffId: string) {
    const count = await this.chat.unreadCountForStaff(staffId);
    return { count };
  }

  @Get(':orderId/chat/messages')
  async messages(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeMessageIdRaw?: string,
    @Query('cursor') cursorMessageIdRaw?: string,
  ) {
    await this.chat.assertStaffCanAccess(orderId);
    let limitParsed: number | undefined;
    if (limitRaw != null && limitRaw.trim() !== '') {
      const n = parseInt(limitRaw, 10);
      if (!Number.isFinite(n)) throw new BadRequestException('limit');
      limitParsed = n;
    }
    const beforeTrim = beforeMessageIdRaw?.trim();
    const cursorTrim = cursorMessageIdRaw?.trim();
    if (
      beforeTrim &&
      cursorTrim &&
      beforeTrim !== cursorTrim
    ) {
      throw new BadRequestException('Не используйте разные значения параметров before и cursor');
    }
    const beforeMessageId = beforeTrim || cursorTrim || undefined;
    return this.chat.listMessages(orderId, { limit: limitParsed, beforeMessageId });
  }

  @Post(':orderId/chat/messages')
  async post(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Body() dto: PostOrderChatMessageDto,
  ) {
    await this.chat.assertStaffCanAccess(orderId);
    return this.chat.postMessage(orderId, user.sub, user.role, dto);
  }

  @Post(':orderId/chat/read')
  async read(@CurrentUser() user: JwtPayload, @Param('orderId') orderId: string) {
    await this.chat.assertStaffCanAccess(orderId);
    await this.chat.markRead(orderId, user.sub, user.role);
    return { ok: true as const };
  }

  @Post(':orderId/chat/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadMem,
      limits: { fileSize: ORDER_CHAT_UPLOAD_MAX_FILE_BYTES },
    }),
  )
  async upload(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.chat.assertStaffCanAccess(orderId);
    if (!file?.buffer?.length) throw new BadRequestException('Файл не передан');
    return this.chat.uploadAttachment(orderId, user.sub, user.role, file);
  }

  @Delete(':orderId/chat/messages/:messageId')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Param('messageId') messageId: string,
  ) {
    await this.chat.assertStaffCanAccess(orderId);
    await this.chat.deleteMessage(orderId, messageId, user.sub, user.role);
    return { ok: true as const };
  }
}
