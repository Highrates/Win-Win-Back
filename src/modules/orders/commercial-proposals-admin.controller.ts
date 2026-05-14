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
    return this.kp.publish(orderId, user.sub, user.role, body);
  }
}
