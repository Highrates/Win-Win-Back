import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AddUserGroupMemberAdminDto, UpsertUserGroupAdminDto } from './dto/user-group-admin.dto';
import { UserGroupsService } from './user-groups.service';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class UserGroupsAdminController {
  constructor(private readonly userGroups: UserGroupsService) {}

  @Get('admin/user-groups')
  list() {
    return this.userGroups.list();
  }

  @Post('admin/user-groups')
  create(@Body() dto: UpsertUserGroupAdminDto) {
    return this.userGroups.create(dto);
  }

  @Get('admin/user-groups/:id')
  getOne(@Param('id') id: string) {
    return this.userGroups.getOne(id);
  }

  @Patch('admin/user-groups/:id')
  patch(@Param('id') id: string, @Body() dto: UpsertUserGroupAdminDto) {
    return this.userGroups.update(id, dto);
  }

  @Delete('admin/user-groups/:id')
  remove(@Param('id') id: string) {
    return this.userGroups.remove(id);
  }

  @Get('admin/user-groups/:id/members')
  listMembers(
    @Param('id') id: string,
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take: number,
  ) {
    const t = Math.min(Math.max(take, 1), 100);
    return this.userGroups.listMembers(id, Math.max(skip, 0), t);
  }

  @Post('admin/user-groups/:id/members')
  addMember(@Param('id') id: string, @Body() dto: AddUserGroupMemberAdminDto) {
    return this.userGroups.addMember(id, dto.userId);
  }

  @Delete('admin/user-groups/:id/members/:userId')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.userGroups.removeMember(id, userId);
  }
}
