import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  type JwtPayload,
} from '../common/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';
import { AssistantChatDto } from './dto/assistant-chat.dto';

@Controller('assistant/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class AssistantAdminController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('threads')
  listThreads(@CurrentUser('sub') staffId: string) {
    return this.assistant.listThreads(staffId);
  }

  @Get('threads/:id')
  getThread(@CurrentUser('sub') staffId: string, @Param('id') id: string) {
    return this.assistant.getThread(staffId, id);
  }

  @Delete('threads')
  clearAll(@CurrentUser('sub') staffId: string) {
    return this.assistant.clearAllThreads(staffId);
  }

  @Post('chat')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async chat(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssistantChatDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const ac = new AbortController();
    const onClose = () => {
      if (!ac.signal.aborted) ac.abort();
    };
    req.on('close', onClose);
    req.on('aborted', onClose);

    try {
      for await (const event of this.assistant.chatStream(
        user.sub,
        user.role,
        dto.message,
        dto.threadId,
        ac.signal,
      )) {
        if (ac.signal.aborted || res.writableEnded) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (e) {
      if (!ac.signal.aborted && !res.writableEnded) {
        const message = e instanceof Error ? e.message : 'Ошибка ассистента';
        res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
      }
    } finally {
      req.off('close', onClose);
      req.off('aborted', onClose);
      if (!res.writableEnded) {
        res.write('data: {"type":"close"}\n\n');
        res.end();
      }
    }
  }
}
