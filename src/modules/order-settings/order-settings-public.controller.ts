import { Controller, Get, Headers } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Public } from '../../common/decorators/public.decorator';
import { userIdFromBearerHeader } from '../../common/utils/optional-bearer-user-id';
import { OrderSettingsService } from './order-settings.service';

@Controller('settings')
export class OrderSettingsPublicController {
  constructor(
    private readonly orderSettingsService: OrderSettingsService,
    private readonly jwtService: JwtService,
  ) {}

  /** ЛК: бонус со своего заказа — профиль группы пользователя или основной (JWT опционален). */
  @Public()
  @Get('public/order-program')
  async orderProgramPublic(@Headers('authorization') authorization?: string) {
    const userId = userIdFromBearerHeader(this.jwtService, authorization);
    const r = await this.orderSettingsService.getResolved(userId);
    return {
      designerOwnCatalogBonusPercent: r.designerOwnCatalogBonusPercent,
      designerOwnMinimumCatalogSiteTotalRub: r.designerOwnMinimumCatalogSiteTotalRub,
    };
  }
}
