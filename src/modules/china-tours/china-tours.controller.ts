import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChinaToursService } from './china-tours.service';
import {
  CreateChinaTourApplicationDto,
  CreateChinaTourReviewDto,
} from './dto/china-tours.dto';

@Controller('china-tours')
export class ChinaToursController {
  constructor(private readonly tours: ChinaToursService) {}

  @Public()
  @Get('landing')
  landing() {
    return this.tours.getLanding();
  }

  @Public()
  @Get()
  list() {
    return this.tours.listPublished();
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-applications')
  myApplications(@CurrentUser('sub') userId: string) {
    return this.tours.listMyApplications(userId);
  }

  @Public()
  @Get(':slug')
  async detail(@Param('slug') slug: string) {
    let s = slug;
    try {
      s = decodeURIComponent(slug);
    } catch {
      /* as-is */
    }
    const row = await this.tours.getBySlug(s);
    if (!row) throw new NotFoundException();
    return row;
  }

  @UseGuards(JwtAuthGuard)
  @Get(':slug/my-application')
  myApplication(@Param('slug') slug: string, @CurrentUser('sub') userId: string) {
    return this.tours.myApplication(slug, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':slug/applications')
  apply(
    @Param('slug') slug: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateChinaTourApplicationDto,
  ) {
    return this.tours.apply(slug, userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':slug/my-review')
  myReview(@Param('slug') slug: string, @CurrentUser('sub') userId: string) {
    return this.tours.myReview(slug, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':slug/reviews')
  review(
    @Param('slug') slug: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateChinaTourReviewDto,
  ) {
    return this.tours.createReview(slug, userId, dto);
  }
}
