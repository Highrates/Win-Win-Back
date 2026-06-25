import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { USER_HEAVY_CREATE_THROTTLE } from '../../common/throttle/user-heavy-create.throttle';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AddOrderPreparationLineDto,
  PatchOrderPreparationDto,
  PatchOrderPreparationLineDto,
  SubmitPreparationDraftDto,
} from './dto/order-preparation.dto';
import { OrdersService } from './orders.service';

@Controller('orders/me')
@UseGuards(JwtAuthGuard)
export class OrdersMeController {
  constructor(private readonly orders: OrdersService) {}

  @Get('preparation')
  getPreparation(@CurrentUser('sub') userId: string) {
    return this.orders.getPreparationDraft(userId);
  }

  @Patch('preparation')
  patchPreparation(@CurrentUser('sub') userId: string, @Body() dto: PatchOrderPreparationDto) {
    return this.orders.patchPreparationDraft(userId, dto);
  }

  @Post('preparation/lines')
  addLine(@CurrentUser('sub') userId: string, @Body() dto: AddOrderPreparationLineDto) {
    return this.orders.addPreparationLine(userId, dto);
  }

  @Patch('preparation/lines/:lineId')
  patchLine(
    @CurrentUser('sub') userId: string,
    @Param('lineId') lineId: string,
    @Body() dto: PatchOrderPreparationLineDto,
  ) {
    return this.orders.patchPreparationLine(userId, lineId, dto);
  }

  @Delete('preparation/lines/:lineId')
  removeLine(@CurrentUser('sub') userId: string, @Param('lineId') lineId: string) {
    return this.orders.removePreparationLine(userId, lineId);
  }

  @Post('preparation/submit')
  @Throttle(USER_HEAVY_CREATE_THROTTLE)
  submit(@CurrentUser('sub') userId: string, @Body() dto: SubmitPreparationDraftDto) {
    return this.orders.submitPreparationDraft(userId, dto);
  }
}
