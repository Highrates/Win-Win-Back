import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { OrderSettingsService } from './order-settings.service';

@Controller('settings')
export class OrderSettingsPublicController {
  constructor(private readonly orderSettingsService: OrderSettingsService) {}

  /** ЛК дизайнера: параметры программы своего заказа (бонус как % × база при пороге). */
  @Public()
  @Get('public/order-program')
  async orderProgramPublic() {
    const r = await this.orderSettingsService.getResolved();
    return {
      designerOwnCatalogBonusPercent: r.designerOwnCatalogBonusPercent,
      designerOwnMinimumCatalogSiteTotalRub: r.designerOwnMinimumCatalogSiteTotalRub,
    };
  }
}
