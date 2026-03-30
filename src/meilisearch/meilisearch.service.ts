import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';

export const PRODUCTS_INDEX = 'products';

@Injectable()
export class MeilisearchService {
  private client: MeiliSearch;

  constructor(private config: ConfigService) {
    const host =
      this.config.get<string>('MEILISEARCH_HOST') ?? 'http://localhost:7700';
    const apiKey = this.config.get<string>('MEILISEARCH_API_KEY');
    this.client = new MeiliSearch({
      host,
      ...(apiKey ? { apiKey } : {}),
    });
  }

  getClient(): MeiliSearch {
    return this.client;
  }

  getIndex(name: string) {
    return this.client.index(name);
  }
}
