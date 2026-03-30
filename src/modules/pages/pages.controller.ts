import { Controller, Get, Param } from '@nestjs/common';
import { PagesService } from './pages.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('pages')
export class PagesController {
  constructor(private pagesService: PagesService) {}

  @Public()
  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.pagesService.findBySlug(slug);
  }

  @Public()
  @Get('type/:type')
  findByType(@Param('type') type: 'ABOUT' | 'SERVICES' | 'DELIVERY' | 'PAYMENT' | 'CONTACTS' | 'CUSTOM') {
    return this.pagesService.findByType(type);
  }
}
