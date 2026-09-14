import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { SearchPublicService, type SearchMode } from './search.public.service';

@Public()
@Controller('search')
export class SearchPublicController {
  constructor(private readonly search: SearchPublicService) {}

  @Get()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  searchQuery(@Query('q') q?: string, @Query('mode') mode?: string) {
    const resolved: SearchMode = mode === 'full' ? 'full' : 'overlay';
    return this.search.search(q ?? '', resolved);
  }
}
