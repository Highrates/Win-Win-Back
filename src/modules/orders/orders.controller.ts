import { Controller, Get, NotFoundException, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CommercialProposalService } from './commercial-proposal.service';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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
    return { ...order, latestCommercialProposal };
  }

  @Patch(':id/commercial-proposal-seen')
  ackCommercialProposalSeen(@CurrentUser('sub') userId: string, @Param('id') orderId: string) {
    return this.ordersService.ackCommercialProposalSeenForCustomer(userId, orderId);
  }
}
