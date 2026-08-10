import { Injectable, Logger } from '@nestjs/common';
import { ProductSearchIndexService } from '../../meilisearch/product-search-index.service';

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 400;

@Injectable()
export class ProductQaSearchSyncService {
  private readonly log = new Logger(ProductQaSearchSyncService.name);
  private syncSuccess = 0;
  private syncFailure = 0;

  constructor(private readonly productSearchIndex: ProductSearchIndexService) {}

  /** Fire-and-forget с retry; при исчерпании попыток — лог + hint meili:reindex. */
  scheduleProductReindex(productId: string): void {
    void this.syncWithRetry(productId);
  }

  getMetrics(): { syncSuccess: number; syncFailure: number } {
    return { syncSuccess: this.syncSuccess, syncFailure: this.syncFailure };
  }

  private async syncWithRetry(productId: string): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.productSearchIndex.syncProductStrict(productId);
        this.syncSuccess += 1;
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt < MAX_ATTEMPTS) {
          const delay = RETRY_BASE_MS * attempt;
          this.log.warn(
            `Meilisearch sync attempt ${attempt}/${MAX_ATTEMPTS} failed for product ${productId}: ${msg}; retry in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        this.syncFailure += 1;
        this.log.error(
          `Meilisearch sync failed for product ${productId} after ${MAX_ATTEMPTS} attempts: ${msg}. ` +
            `При дрейфе qaMessageCountPublic выполните: cd backend && npm run meili:reindex`,
        );
      }
    }
  }
}
