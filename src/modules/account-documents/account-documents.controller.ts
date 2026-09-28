import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountDocumentsService, type AccountDocumentsFilter } from './account-documents.service';

const DOCUMENT_FILTERS = new Set<AccountDocumentsFilter>(['all', 'orders', 'sourcing', 'mine']);

function parseFilter(filter: string | undefined): AccountDocumentsFilter {
  return DOCUMENT_FILTERS.has(filter as AccountDocumentsFilter) ? (filter as AccountDocumentsFilter) : 'all';
}

function parseIntParam(raw: string | undefined): number | undefined {
  const n = raw ? Number.parseInt(raw, 10) : undefined;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Документы покупателя в ЛК: чаты заказов и подборов, вложения заявок, документы заказов.
 * Сами файлы — через GET /files/:ref (id элемента списка).
 */
@Controller('account/documents')
@UseGuards(JwtAuthGuard)
export class AccountDocumentsController {
  constructor(private readonly documents: AccountDocumentsService) {}

  /**
   * Курсорная пагинация: `limit` (≤100), `cursor`, `filter=all|orders|sourcing|mine`, `q` — поиск по названию,
   * `group=order:<id>|sourcing:<id>` — только одна группа.
   */
  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('filter') filter?: string,
    @Query('q') q?: string,
    @Query('group') group?: string,
  ) {
    return this.documents.listForCustomer(userId, {
      limit: parseIntParam(limit),
      cursor: cursor || null,
      filter: parseFilter(filter),
      q: q || null,
      group: group || null,
    });
  }

  /** Группы по заказам / заявкам: `limit` групп (≤50), `items` документов в каждой (≤20), те же `filter` и `q`. */
  @Get('groups')
  groups(
    @CurrentUser('sub') userId: string,
    @Query('limit') limit?: string,
    @Query('items') items?: string,
    @Query('cursor') cursor?: string,
    @Query('filter') filter?: string,
    @Query('q') q?: string,
  ) {
    return this.documents.listGroupsForCustomer(userId, {
      limit: parseIntParam(limit),
      itemsPerGroup: parseIntParam(items),
      cursor: cursor || null,
      filter: parseFilter(filter),
      q: q || null,
    });
  }
}
