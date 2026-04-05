import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';

export const PRODUCTS_INDEX = 'products';

@Injectable()
export class MeilisearchService {
  private client: MeiliSearch;

  constructor(private config: ConfigService) {
    const host =
      this.config.get<string>('MEILISEARCH_HOST')?.trim() || 'http://localhost:7700';
    const apiKey = this.config.get<string>('MEILISEARCH_API_KEY');
    this.client = new MeiliSearch({
      host,
      ...(apiKey ? { apiKey } : {}),
    });
  }

  /**
   * Поиск и индексация через Meilisearch только при MEILISEARCH_ENABLED=true (или 1).
   * Иначе каталог ищется через Prisma, синхронизация индекса — no-op.
   */
  isEnabled(): boolean {
    const v = this.config.get<string>('MEILISEARCH_ENABLED')?.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }

  getClient(): MeiliSearch {
    return this.client;
  }

  getIndex(name: string) {
    return this.client.index(name);
  }
}
