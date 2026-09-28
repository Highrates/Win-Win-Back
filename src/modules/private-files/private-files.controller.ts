import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { sendStoredFile } from '../storage/stored-file';
import { PrivateFilesService } from './private-files.service';

/** Скачивание персональных файлов (вложения чатов и заявок, документы заказов) с проверкой доступа. */
@Controller('files')
@UseGuards(JwtAuthGuard)
export class PrivateFilesController {
  constructor(private readonly files: PrivateFilesService) {}

  @Get(':ref')
  async file(@CurrentUser() user: JwtPayload, @Param('ref') ref: string, @Res() res: Response) {
    const file = await this.files.open({ userId: user.sub, role: user.role }, ref);
    sendStoredFile(res, file);
  }
}
