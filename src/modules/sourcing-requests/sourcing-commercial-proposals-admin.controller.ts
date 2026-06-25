import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
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
