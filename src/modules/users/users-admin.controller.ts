import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';

/** Список покупателей (роль USER) для админки. */
@Controller('users/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class UsersAdminController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(50), ParseIntPipe) take: number,
    @Query('q') q?: string,
  ) {
    const t = Math.min(Math.max(take, 1), 100);
    return this.users.listRetailUsers({ skip: Math.max(skip, 0), take: t, q });
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.users.findRetailUserByIdForAdmin(id);
  }
}
