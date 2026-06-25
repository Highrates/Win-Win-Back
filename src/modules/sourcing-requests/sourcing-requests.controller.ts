import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { USER_HEAVY_CREATE_THROTTLE } from '../../common/throttle/user-heavy-create.throttle';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SourcingRequestsService } from './sourcing-requests.service';
import { SourcingCommercialProposalService } from './sourcing-commercial-proposal.service';
import { parseSourcingListLimit, parseSourcingListPage } from './sourcing-limits.constants';
import { sourcingUploadMulterOptions } from './sourcing-upload.config';

@Controller('sourcing-requests')
@UseGuards(JwtAuthGuard)
export class SourcingRequestsController {
  constructor(
    private readonly sourcing: SourcingRequestsService,
    private readonly commercialProposals: SourcingCommercialProposalService,
  ) {}

  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('scope') scope?: string,
  ) {
    return this.sourcing.findByUser(
      userId,
      parseSourcingListPage(pageRaw),
      parseSourcingListLimit(limitRaw),
      scope,
    );
  }

  @Get(':id')
  async one(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    const row = await this.sourcing.findOneDetailForUser(userId, id);
    if (!row) throw new NotFoundException();
    const publishedCommercialProposals =
      await this.commercialProposals.getAllPublishedForUserSourcingRequest(userId, id);
    const latestCommercialProposal = publishedCommercialProposals[0] ?? null;
    return { ...row, latestCommercialProposal, publishedCommercialProposals };
  }

  @Patch(':id/commercial-proposal-seen')
  ackCommercialProposalSeen(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.sourcing.ackCommercialProposalSeenForCustomer(userId, id);
  }

  @Post()
  @Throttle(USER_HEAVY_CREATE_THROTTLE)
  @UseInterceptors(AnyFilesInterceptor(sourcingUploadMulterOptions()))
  create(
    @CurrentUser('sub') userId: string,
    @Body('payload') payload: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.sourcing.createForUser(userId, payload ?? '', files ?? []);
  }
}
