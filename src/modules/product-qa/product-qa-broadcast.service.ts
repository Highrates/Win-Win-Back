import { Injectable } from '@nestjs/common';
import { ProductQaCoreService } from './product-qa-core.service';
import { ProductQaGateway } from './product-qa.gateway';

@Injectable()
export class ProductQaBroadcastService {
  constructor(
    private readonly core: ProductQaCoreService,
    private readonly gateway: ProductQaGateway,
  ) {}

  async broadcastMeta(productId: string): Promise<void> {
    const meta = await this.core.buildMeta(productId);
    this.gateway.broadcastMetaUpdated(productId, meta);
  }
}
