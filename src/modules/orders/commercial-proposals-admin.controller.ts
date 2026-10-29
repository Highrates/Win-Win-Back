import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { CommercialProposalService } from './commercial-proposal.service';
import {
  InitCommercialProposalDraftDto,
  PublishCommercialProposalDto,
  UpdateCommercialProposalDraftDto,
} from './dto/commercial-proposal.dto';

@Controller('orders/admin/:orderId/commercial-proposals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class CommercialProposalsAdminController {
  constructor(private readonly kp: CommercialProposalService) {}

  @Get()
  summary(@Param('orderId') orderId: string) {
    return this.kp.getSummary(orderId);
  }

  @Get('draft')
  draft(@Param('orderId') orderId: string) {
    return this.kp.getDraft(orderId);
  }

  @Get('excel')
  async excel(
    @Param('orderId') orderId: string,
    @Query('source') sourceRaw: string | undefined,
    @Query('version') versionRaw: string | undefined,
    @Res() res: Response,
  ) {
    const source = (sourceRaw || 'draft') as 'order' | 'draft' | 'published';
    if (source !== 'order' && source !== 'draft' && source !== 'published') {
      throw new BadRequestException('source: order | draft | published');
    }
    const version =
      versionRaw != null && versionRaw !== ''
        ? Number.parseInt(versionRaw, 10)
        : undefined;
    const { buffer, filename } = await this.kp.exportExcel(orderId, source, version);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.byteLength));
    res.send(buffer);
  }

  @Get('published/:versionNumber')
  published(
    @Param('orderId') orderId: string,
    @Param('versionNumber', ParseIntPipe) versionNumber: number,
  ) {
    return this.kp.getPublished(orderId, versionNumber);
  }

  @Post('draft/init')
  init(@Param('orderId') orderId: string, @Body() body: InitCommercialProposalDraftDto) {
    return this.kp.initDraft(orderId, body?.fromPublishedProposalId);
  }

  @Post('draft/import-excel')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  importExcel(
    @Param('orderId') orderId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRunRaw?: string,
    @Query('expectedUpdatedAt') expectedUpdatedAt?: string,
  ) {
    const dryRun = dryRunRaw === '1' || dryRunRaw === 'true';
    return this.kp.importExcelToDraft(orderId, file, {
      dryRun,
      expectedUpdatedAt: expectedUpdatedAt?.trim() || null,
    });
  }

  @Put('draft')
  putDraft(@Param('orderId') orderId: string, @Body() dto: UpdateCommercialProposalDraftDto) {
    return this.kp.putDraft(orderId, dto.lines);
  }

  @Post('publish')
  publish(
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body?: PublishCommercialProposalDto,
  ) {
    return this.kp.publish(orderId, user.sub, body);
  }
}
