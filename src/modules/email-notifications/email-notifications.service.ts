import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction } from '@prisma/client';
import {
  EMAIL_NOTIFICATION_REVISIONS_KEEP,
  type EmailNotificationDetail,
  type EmailNotificationListItem,
  type EmailNotificationPreviewRequest,
  type EmailNotificationRecipients,
  type EmailNotificationRevision,
  type EmailNotificationUpdate,
  type EmailSampleVariant,
  type EmailSendPath,
} from '@win-win/admin-sections';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { MailContent, MailContext } from '../auth/mail-layout';
import { StaffAccessService } from '../staff/staff-access.service';
import {
  EMAIL_GLOBAL_VARIABLES,
  EMAIL_NOTIFICATION_EVENTS,
  eventSnippets,
  getEmailNotificationEventDef,
  isEmailNotificationEventKey,
  type EmailNotificationEventDef,
  type EmailNotificationEventKey,
  type EmailTemplateVars,
} from './email-notification-events';
import { renderEditableEmail, validateEditableTemplate, type EditableTemplate } from './email-notification-render';

export type { EmailSendPath };

const ERROR_SEND_PATHS: ReadonlySet<EmailSendPath> = new Set(['rendered_legacy', 'failed']);
const ERROR_MESSAGE_MAX = 500;

type TemplateRow = EditableTemplate & { enabled: boolean };

const REVISIONS_KEEP = EMAIL_NOTIFICATION_REVISIONS_KEEP;

@Injectable()
export class EmailNotificationsService {
  private readonly logger = new Logger(EmailNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly staffAccess: StaffAccessService,
  ) {}

  async list(): Promise<EmailNotificationListItem[]> {
    const [rows, staffRecipients] = await Promise.all([
      this.prisma.emailNotificationTemplate.findMany(),
      this.staffRecipients(),
    ]);
    const byKey = new Map(rows.map((r) => [r.eventKey, r]));
    return EMAIL_NOTIFICATION_EVENTS.map((def) =>
      this.toListItem(def, byKey.get(def.key) ?? null, def.audience === 'staff' ? staffRecipients : null),
    );
  }

  async get(eventKey: string): Promise<EmailNotificationDetail> {
    const def = this.requireDef(eventKey);
    const [row, recipients] = await Promise.all([
      this.prisma.emailNotificationTemplate.findUnique({ where: { eventKey: def.key } }),
      def.audience === 'staff' ? this.staffRecipients() : Promise.resolve(null),
    ]);
    const tpl = currentTemplate(def, row);
    return {
      ...this.toListItem(def, row, recipients),
      ...tpl,
      defaultSubject: def.defaultSubject,
      defaultTitle: def.defaultTitle,
      defaultBody: def.defaultBody,
      variables: [...def.variables, ...EMAIL_GLOBAL_VARIABLES].map((v) => ({
        key: v.key,
        label: v.label,
        optional: Boolean(v.optional),
      })),
      snippets: eventSnippets(def),
    };
  }

  async listRevisions(eventKey: string): Promise<EmailNotificationRevision[]> {
    const def = this.requireDef(eventKey);
    const rows = await this.prisma.emailNotificationTemplateRevision.findMany({
      where: { eventKey: def.key },
      orderBy: { createdAt: 'desc' },
      take: REVISIONS_KEEP,
    });
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      title: r.title,
      body: r.body,
      enabled: r.enabled,
      actorEmail: r.actorEmail,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async update(eventKey: string, dto: EmailNotificationUpdate, actorUserId: string): Promise<EmailNotificationDetail> {
    const def = this.requireDef(eventKey);
    const current = await this.prisma.emailNotificationTemplate.findUnique({ where: { eventKey: def.key } });
    const prev: TemplateRow = { ...currentTemplate(def, current), enabled: current?.enabled ?? true };
    const next: TemplateRow = {
      subject: dto.subject !== undefined ? dto.subject.trim() : prev.subject,
      title: dto.title !== undefined ? dto.title.trim() : prev.title,
      body: dto.body !== undefined ? dto.body.replace(/\r\n/g, '\n').trim() : prev.body,
      enabled: dto.enabled ?? prev.enabled,
    };

    const textChanged = dto.subject !== undefined || dto.title !== undefined || dto.body !== undefined;
    if (textChanged) {
      const errors = validateEditableTemplate(def, next);
      if (errors.length) throw new BadRequestException(errors.join('. '));
    }

    const changedFields = (['subject', 'title', 'body', 'enabled'] as const).filter((k) => prev[k] !== next[k]);
    if (!changedFields.length) return this.get(def.key);

    const actor = await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { email: true } });
    const actorEmail = actor?.email ?? null;
    const editedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.emailNotificationTemplateRevision.create({
        data: { eventKey: def.key, ...prev, actorUserId, actorEmail },
      });
      const edit = {
        ...overrides(def, next),
        enabled: next.enabled,
        lastEditedByUserId: actorUserId,
        lastEditedByEmail: actorEmail,
        lastEditedAt: editedAt,
      };
      await tx.emailNotificationTemplate.upsert({
        where: { eventKey: def.key },
        create: { eventKey: def.key, ...edit },
        update: edit,
      });
      const stale = await tx.emailNotificationTemplateRevision.findMany({
        where: { eventKey: def.key },
        orderBy: { createdAt: 'desc' },
        skip: REVISIONS_KEEP,
        select: { id: true },
      });
      if (stale.length) {
        await tx.emailNotificationTemplateRevision.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });
      }
    });

    await this.audit.log({
      action: AuditAction.UPDATE,
      entityType: 'EmailNotificationTemplate',
      entityId: def.key,
      path: `/settings/admin/email-notifications/${def.key}`,
      actorUserId,
      actorEmail,
      metadata: { changed: changedFields, enabled: next.enabled },
    });

    return this.get(def.key);
  }

  /** Демо-письмо для редактора; несохранённый текст можно передать в `overrides`. */
  async preview(
    eventKey: string,
    ctx: MailContext,
    overrides: EmailNotificationPreviewRequest,
  ): Promise<MailContent> {
    const def = this.requireDef(eventKey);
    const detail = await this.get(def.key);
    const tpl: EditableTemplate = {
      subject: overrides.subject ?? detail.subject,
      title: overrides.title ?? detail.title,
      body: overrides.body ?? detail.body,
    };
    const errors = validateEditableTemplate(def, tpl);
    if (errors.length) throw new BadRequestException(errors.join('. '));
    return renderEditableEmail(ctx, def, tpl, sampleVars(def, ctx.siteUrl, overrides.sampleVariant ?? 'full'));
  }

  /**
   * Письмо по сохранённому шаблону; `null` — уведомление выключено в админке.
   * Без кэша в памяти: при нескольких репликах выключение должно действовать сразу, а чтение по PK дешёвое.
   */
  async build(eventKey: EmailNotificationEventKey, vars: EmailTemplateVars, ctx: MailContext): Promise<MailContent | null> {
    const def = getEmailNotificationEventDef(eventKey);
    const row = await this.prisma.emailNotificationTemplate.findUnique({ where: { eventKey: def.key } });
    if (row && !row.enabled) return null;
    return renderEditableEmail(ctx, def, currentTemplate(def, row), vars);
  }

  /**
   * Raw SQL: у неправленого письма строки может не быть, а у существующей не должен меняться `updatedAt`.
   * Сбой пишется ещё и в `lastError*`, чтобы следующее успешное письмо его не затёрло.
   */
  async recordSendPath(eventKey: EmailNotificationEventKey, path: EmailSendPath, error?: string): Promise<void> {
    try {
      if (ERROR_SEND_PATHS.has(path)) {
        const message = (error ?? '').slice(0, ERROR_MESSAGE_MAX) || null;
        await this.prisma.$executeRaw`
          INSERT INTO "EmailNotificationTemplate"
            ("eventKey", "lastSendPath", "lastSendAt", "lastErrorPath", "lastErrorAt", "lastErrorMessage", "updatedAt")
          VALUES (${eventKey}, ${path}, NOW(), ${path}, NOW(), ${message}, NOW())
          ON CONFLICT ("eventKey") DO UPDATE
          SET "lastSendPath" = EXCLUDED."lastSendPath", "lastSendAt" = EXCLUDED."lastSendAt",
              "lastErrorPath" = EXCLUDED."lastErrorPath", "lastErrorAt" = EXCLUDED."lastErrorAt",
              "lastErrorMessage" = EXCLUDED."lastErrorMessage"
        `;
        return;
      }
      await this.prisma.$executeRaw`
        INSERT INTO "EmailNotificationTemplate" ("eventKey", "lastSendPath", "lastSendAt", "updatedAt")
        VALUES (${eventKey}, ${path}, NOW(), NOW())
        ON CONFLICT ("eventKey") DO UPDATE
        SET "lastSendPath" = EXCLUDED."lastSendPath", "lastSendAt" = EXCLUDED."lastSendAt"
      `;
    } catch (e) {
      this.logger.warn(`recordSendPath(${eventKey}, ${path}): ${errorMessage(e)}`);
    }
  }

  private requireDef(eventKey: string): EmailNotificationEventDef {
    if (!isEmailNotificationEventKey(eventKey)) throw new NotFoundException('Неизвестное email-уведомление');
    return getEmailNotificationEventDef(eventKey);
  }

  /** Те же адресаты, что у отправки писем сотрудникам (`OrderChatService.getStaffNotifyEmailRecipients`). */
  private staffRecipients(): Promise<EmailNotificationRecipients> {
    return this.staffAccess.resolveOrderNotifyRecipients(this.config.get<string>('ORDER_CHAT_STAFF_EMAIL'));
  }

  private toListItem(
    def: EmailNotificationEventDef,
    row: TemplateDbRow | null,
    recipients: EmailNotificationRecipients | null,
  ): EmailNotificationListItem {
    const tpl = currentTemplate(def, row);
    return {
      eventKey: def.key,
      audience: def.audience,
      label: def.label,
      description: def.description,
      recipients,
      enabled: row?.enabled ?? true,
      isCustomized:
        tpl.subject !== def.defaultSubject || tpl.title !== def.defaultTitle || tpl.body !== def.defaultBody,
      updatedAt: row?.lastEditedAt?.toISOString() ?? null,
      lastSendPath: (row?.lastSendPath as EmailSendPath | null) ?? null,
      lastSendAt: row?.lastSendAt?.toISOString() ?? null,
      lastErrorPath: (row?.lastErrorPath as EmailSendPath | null) ?? null,
      lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
      lastErrorMessage: row?.lastErrorMessage ?? null,
      lastEditedByEmail: row?.lastEditedByEmail ?? null,
      lastEditedAt: row?.lastEditedAt?.toISOString() ?? null,
    };
  }
}

type StoredTemplate = { [K in keyof EditableTemplate]: string | null };

type TemplateDbRow = StoredTemplate & {
  enabled: boolean;
  lastSendPath: string | null;
  lastSendAt: Date | null;
  lastErrorPath: string | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  lastEditedByEmail: string | null;
  lastEditedAt: Date | null;
};

/** `null` в БД — текст по умолчанию из реестра, поэтому правка кода доходит до прода. */
function currentTemplate(def: EmailNotificationEventDef, row: StoredTemplate | null): EditableTemplate {
  return {
    subject: row?.subject ?? def.defaultSubject,
    title: row?.title ?? def.defaultTitle,
    body: row?.body ?? def.defaultBody,
  };
}

function overrides(def: EmailNotificationEventDef, tpl: EditableTemplate): StoredTemplate {
  return {
    subject: tpl.subject === def.defaultSubject ? null : tpl.subject,
    title: tpl.title === def.defaultTitle ? null : tpl.title,
    body: tpl.body === def.defaultBody ? null : tpl.body,
  };
}

function sampleVars(def: EmailNotificationEventDef, siteUrl: string, variant: EmailSampleVariant): EmailTemplateVars {
  const vars = def.sample(siteUrl);
  if (variant === 'sparse') {
    for (const v of def.variables) if (v.optional) vars[v.key] = '';
  }
  return vars;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
