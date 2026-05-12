import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrderChatService } from './order-chat.service';
import { PostOrderChatMessageDto } from './dto/order-chat.dto';

const uploadMem = memoryStorage();

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrderChatUserController {
  constructor(private readonly chat: OrderChatService) {}

  @Get(':orderId/chat/messages')
  async messages(@CurrentUser() user: JwtPayload, @Param('orderId') orderId: string) {
    await this.chat.assertCustomerCanAccess(orderId, user.sub);
    return this.chat.listMessages(orderId);
  }

  @Post(':orderId/chat/messages')
  async post(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Body() dto: PostOrderChatMessageDto,
  ) {
    await this.chat.assertCustomerCanAccess(orderId, user.sub);
    return this.chat.postMessage(orderId, user.sub, user.role, dto);
  }

  @Post(':orderId/chat/read')
  async read(@CurrentUser() user: JwtPayload, @Param('orderId') orderId: string) {
    await this.chat.assertCustomerCanAccess(orderId, user.sub);
    await this.chat.markRead(orderId, user.sub, user.role);
    return { ok: true as const };
  }

  @Post(':orderId/chat/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadMem,
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  async upload(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.chat.assertCustomerCanAccess(orderId, user.sub);
    if (!file?.buffer?.length) throw new BadRequestException('Файл не передан');
    return this.chat.uploadAttachment(orderId, user.sub, user.role, file);
  }

  @Delete(':orderId/chat/messages/:messageId')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Param('messageId') messageId: string,
  ) {
    await this.chat.assertCustomerCanAccess(orderId, user.sub);
    await this.chat.deleteMessage(orderId, messageId, user.sub, user.role);
    return { ok: true as const };
  }
}
