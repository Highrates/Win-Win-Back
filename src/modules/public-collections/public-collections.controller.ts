import { Controller, Get, Param } from '@nestjs/common';
import { PublicCollectionsService } from './public-collections.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('public-collections')
export class PublicCollectionsController {
  constructor(private publicCollectionsService: PublicCollectionsService) {}

  @Public()
  @Get()
  findAll() {
    return this.publicCollectionsService.findAll();
  }

  @Public()
  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.publicCollectionsService.findBySlug(slug);
  }
}
