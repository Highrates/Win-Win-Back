import { Global, Module } from '@nestjs/common';
import { MeilisearchService } from './meilisearch.service';
import { ProductSearchIndexService } from './product-search-index.service';

@Global()
@Module({
  providers: [MeilisearchService, ProductSearchIndexService],
  exports: [MeilisearchService, ProductSearchIndexService],
})
export class MeilisearchModule {}
