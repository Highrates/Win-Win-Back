import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';

export const PRODUCTS_INDEX = 'products';

@Injectable()
export class MeilisearchService {
  private client: MeiliSearch;

  constructor(private config: ConfigService) {
    this.client = new MeiliSearch(
      this.config.get('MEILISEARCH_HOST', 'http://localhost:7700'),
      { apiKey: this.config.get('MEILISEARCH_API_KEY') },
    );
  }

  getClient(): MeiliSearch {
    return this.client;
  }

  getIndex(name: string) {
    return this.client.index(name);
  }
}
