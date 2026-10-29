import {
  BadRequestException,
  Body,
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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { SourcingCommercialProposalService } from './sourcing-commercial-proposal.service';
import {
  InitSourcingCommercialProposalDraftDto,
  UpdateSourcingCommercialProposalDraftDto,
} from './dto/sourcing-commercial-proposal.dto';

@Controller('sourcing-requests/admin/:sourcingRequestId/commercial-proposals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class SourcingCommercialProposalsAdminController {
  constructor(private readonly kp: SourcingCommercialProposalService) {}

  @Get()
  summary(@Param('sourcingRequestId') sourcingRequestId: string) {
    return this.kp.getSummary(sourcingRequestId);
  }

  @Get('draft')
  draft(@Param('sourcingRequestId') sourcingRequestId: string) {
    return this.kp.getDraft(sourcingRequestId);
  }

  @Get('excel')
  async excel(
    @Param('sourcingRequestId') sourcingRequestId: string,
    @Query('source') sourceRaw: string | undefined,
    @Query('version') versionRaw: string | undefined,
    @Res() res: Response,
  ) {
    const source = (sourceRaw || 'draft') as 'request' | 'draft' | 'published';
    if (source !== 'request' && source !== 'draft' && source !== 'published') {
      throw new BadRequestException('source: request | draft | published');
    }
    const version =
      versionRaw != null && versionRaw !== ''
        ? Number.parseInt(versionRaw, 10)
        : undefined;
    const { buffer, filename } = await this.kp.exportExcel(
      sourcingRequestId,
      source,
      version,
    );
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
    @Param('sourcingRequestId') sourcingRequestId: string,
    @Param('versionNumber', ParseIntPipe) versionNumber: number,
  ) {
    return this.kp.getPublished(sourcingRequestId, versionNumber);
  }

  @Post('draft/init')
  init(
    @Param('sourcingRequestId') sourcingRequestId: string,
    @Body() body: InitSourcingCommercialProposalDraftDto,
  ) {
    return this.kp.initDraft(sourcingRequestId, body);
  }

  @Post('draft/import-excel')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  importExcel(
    @Param('sourcingRequestId') sourcingRequestId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRunRaw?: string,
    @Query('expectedUpdatedAt') expectedUpdatedAt?: string,
  ) {
    const dryRun = dryRunRaw === '1' || dryRunRaw === 'true';
    return this.kp.importExcelToDraft(sourcingRequestId, file, {
      dryRun,
      expectedUpdatedAt: expectedUpdatedAt?.trim() || null,
    });
  }

  @Put('draft')
  putDraft(
    @Param('sourcingRequestId') sourcingRequestId: string,
    @Body() dto: UpdateSourcingCommercialProposalDraftDto,
  ) {
    return this.kp.putDraft(sourcingRequestId, dto.lines);
  }

  @Post('publish')
  publish(
    @Param('sourcingRequestId') sourcingRequestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.kp.publish(sourcingRequestId, user.sub);
  }
}
