import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AuditService } from './audit.service';
import { PurgeAuditJournalDto } from './dto/purge-audit.dto';

@Controller('audit/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class AuditAdminController {
  constructor(private readonly audit: AuditService) {}

  /** Полный сброс журнала: только ADMIN + пароль из AUDIT_JOURNAL_PURGE_PASSWORD. */
  @Post('purge')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  async purge(@Body() dto: PurgeAuditJournalDto) {
    const r = await this.audit.purgeAllWithPassword(dto.password);
    if (r.ok === false) {
      if (r.reason === 'not_configured') {
        throw new ServiceUnavailableException(
          'Пароль очистки журнала не задан на сервере. Укажите AUDIT_JOURNAL_PURGE_PASSWORD в .env бэка и перезапустите API.',
        );
      }
      throw new UnauthorizedException('Invalid purge password');
    }
    return { deleted: r.deleted };
  }

  @Get('logs')
  list(
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const page = pageRaw ? parseInt(pageRaw, 10) : 1;
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    return this.audit.listForAdmin(
      Number.isFinite(page) ? page : 1,
      Number.isFinite(limit) ? limit : 50,
    );
  }
}
