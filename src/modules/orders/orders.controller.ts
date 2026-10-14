import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { CommercialProposalService } from './commercial-proposal.service';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AcceptCommercialProposalDto,
  RecordCommercialProposalDecisionDto,
} from './dto/customer-kp-decision.dto';

/** Создание заказов только через `orders/me/preparation/*` + submit → согласование. */
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly commercialProposals: CommercialProposalService,
  ) {}

  @Get()
  myOrders(
    @CurrentUser('sub') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('scope') scope?: string,
  ) {
    return this.ordersService.findByUser(
      userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      scope,
    );
  }

  @Get(':id')
  async one(@CurrentUser('sub') userId: string, @Param('id') orderId: string) {
    const order = await this.ordersService.findOneDetailForUser(userId, orderId);
    if (!order) throw new NotFoundException();
    const latestCommercialProposal =
      await this.commercialProposals.getLatestPublishedForOrder(orderId);
    const decisionVersion = order.customerKpDecisionVersion ?? 0;
    const canRespondToCommercialProposal =
      latestCommercialProposal != null &&
      order.status === OrderStatus.PROPOSAL_FORMED &&
      (order.customerKpDecision == null || decisionVersion < latestCommercialProposal.versionNumber);
    return {
      ...order,
      latestCommercialProposal,
      canRespondToCommercialProposal,
      commercialProposalVersion: latestCommercialProposal?.versionNumber ?? null,
    };
  }

  @Patch(':id/archive')
  archive(@CurrentUser('sub') userId: string, @Param('id') orderId: string) {
    return this.ordersService.archiveOrderForCustomer(userId, orderId);
  }

  @Patch(':id/commercial-proposal-seen')
  ackCommercialProposalSeen(@CurrentUser('sub') userId: string, @Param('id') orderId: string) {
    return this.ordersService.ackCommercialProposalSeenForCustomer(userId, orderId);
  }

  @Post(':id/commercial-proposal/accept')
  acceptCommercialProposal(
    @CurrentUser('sub') userId: string,
    @Param('id') orderId: string,
    @Body() dto: AcceptCommercialProposalDto,
  ) {
    return this.ordersService.acceptCommercialProposalForCustomer(userId, orderId, dto);
  }

  @Post(':id/commercial-proposal/decision')
  recordCommercialProposalDecision(
    @CurrentUser('sub') userId: string,
    @Param('id') orderId: string,
    @Body() dto: RecordCommercialProposalDecisionDto,
  ) {
    return this.ordersService.recordCommercialProposalDecisionForCustomer(userId, orderId, dto);
  }
}
