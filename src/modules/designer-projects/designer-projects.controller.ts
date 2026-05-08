import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DesignerProjectsService } from './designer-projects.service';
import {
  CreateDesignerProjectDto,
  DesignerProjectsAdminQueryDto,
  UpdateDesignerProjectDto,
} from './dto/designer-projects.dto';

@Controller('designer-projects')
export class DesignerProjectsController {
  constructor(private readonly svc: DesignerProjectsService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser('sub') userId: string) {
    return this.svc.listMine(userId);
  }

  @Post('me')
  @UseGuards(JwtAuthGuard)
  createMine(@CurrentUser('sub') userId: string, @Body() dto: CreateDesignerProjectDto) {
    return this.svc.createMine(userId, dto);
  }

  @Get('me/:id')
  @UseGuards(JwtAuthGuard)
  getMine(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.svc.getMine(userId, id);
  }

  @Put('me/:id')
  @UseGuards(JwtAuthGuard)
  updateMine(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDesignerProjectDto,
  ) {
    return this.svc.updateMine(userId, id, dto);
  }

  @Delete('me/:id')
  @UseGuards(JwtAuthGuard)
  deleteMine(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.svc.deleteMine(userId, id);
  }

  // ---- Admin (операционная видимость) ----

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  listAdmin(@Query() query: DesignerProjectsAdminQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.svc.listForAdmin({
      page,
      limit,
      q: query.q,
      userId: query.userId,
    });
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  getAdmin(@CurrentUser('role') role: UserRole, @Param('id') id: string) {
    return this.svc.getForAdmin(role, id);
  }
}
