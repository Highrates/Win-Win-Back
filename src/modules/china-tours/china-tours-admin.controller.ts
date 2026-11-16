import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChinaTourApplicationStatus, ChinaTourReviewStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChinaToursAdminService } from './china-tours-admin.service';
import {
  AdminCreateChinaTourReviewDto,
  AdminUpdateChinaTourReviewDto,
  CreateChinaTourDto,
  PatchChinaTourApplicationStatusDto,
  PatchChinaTourReviewStatusDto,
  ReorderChinaToursDto,
  UpdateChinaTourDto,
  UpdateChinaToursLandingDto,
} from './dto/china-tours.dto';

@Controller('china-tours/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class ChinaToursAdminController {
  constructor(private readonly admin: ChinaToursAdminService) {}

  @Get('landing')
  getLanding() {
    return this.admin.getLanding();
  }

  @Patch('landing')
  updateLanding(@Body() dto: UpdateChinaToursLandingDto) {
    return this.admin.updateLanding(dto);
  }

  @Get('tours')
  listTours(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listTours({
      q,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('tours/:id')
  getTour(@Param('id') id: string) {
    return this.admin.getTour(id);
  }

  @Post('tours')
  createTour(@Body() dto: CreateChinaTourDto) {
    return this.admin.createTour(dto);
  }

  @Post('tours/reorder')
  reorderTours(@Body() dto: ReorderChinaToursDto) {
    return this.admin.reorderTours(dto.orderedIds);
  }

  @Patch('tours/:id')
  updateTour(@Param('id') id: string, @Body() dto: UpdateChinaTourDto) {
    return this.admin.updateTour(id, dto);
  }

  @Delete('tours/:id')
  deleteTour(@Param('id') id: string) {
    return this.admin.deleteTour(id);
  }

  @Get('applications/pending-count')
  pendingApplicationsCount() {
    return this.admin.countPendingApplications();
  }

  @Get('applications')
  listApplications(
    @Query('tourId') tourId?: string,
    @Query('status') status?: ChinaTourApplicationStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listApplications({
      tourId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Patch('applications/:id/status')
  patchApplication(
    @Param('id') id: string,
    @Body() dto: PatchChinaTourApplicationStatusDto,
  ) {
    return this.admin.patchApplicationStatus(id, dto.status);
  }

  @Get('reviews/pending-count')
  pendingReviewsCount() {
    return this.admin.countPendingReviews();
  }

  @Get('reviews')
  listReviews(
    @Query('tourId') tourId?: string,
    @Query('status') status?: ChinaTourReviewStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listReviews({
      tourId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('reviews')
  createReview(@Body() dto: AdminCreateChinaTourReviewDto) {
    return this.admin.createReview(dto);
  }

  @Patch('reviews/:id')
  updateReview(@Param('id') id: string, @Body() dto: AdminUpdateChinaTourReviewDto) {
    return this.admin.updateReview(id, dto);
  }

  @Patch('reviews/:id/status')
  patchReview(@Param('id') id: string, @Body() dto: PatchChinaTourReviewStatusDto) {
    return this.admin.patchReviewStatus(id, dto.status);
  }

  @Delete('reviews/:id')
  deleteReview(@Param('id') id: string) {
    return this.admin.deleteReview(id);
  }
}
