/** Контракт API `settings/admin/email-notifications` — общий для бэкенда (ответы сервиса) и админки (клиент). */
/** Сколько версий из истории правок хранится на письмо; старшие удаляются при сохранении. */
export declare const EMAIL_NOTIFICATION_REVISIONS_KEEP = 30;
export type EmailSendPath = 'rendered_db' | 'rendered_legacy' | 'skipped_disabled' | 'failed';
export type EmailNotificationAudience = 'customer' | 'staff';
export type EmailSampleVariant = 'full' | 'sparse';
export type EmailTemplateFields = {
    subject: string;
    title: string;
    body: string;
};
/** Кому уходят письма сотрудникам: адреса из `ORDER_CHAT_STAFF_EMAIL` или админы и модераторы с разделом «Заказы». */
export type EmailNotificationRecipients = {
    emails: string[];
    source: 'env' | 'staff';
};
export type EmailNotificationListItem = {
    eventKey: string;
    audience: EmailNotificationAudience;
    label: string;
    description: string;
    /** Только у писем сотрудникам. */
    recipients: EmailNotificationRecipients | null;
    enabled: boolean;
    isCustomized: boolean;
    updatedAt: string | null;
    lastSendPath: EmailSendPath | null;
    lastSendAt: string | null;
    lastErrorPath: EmailSendPath | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    lastEditedByEmail: string | null;
    lastEditedAt: string | null;
};
export type EmailNotificationDetail = EmailNotificationListItem & EmailTemplateFields & {
    defaultSubject: string;
    defaultTitle: string;
    defaultBody: string;
    variables: {
        key: string;
        label: string;
        optional: boolean;
    }[];
    snippets: {
        key: string;
        label: string;
    }[];
};
/** Версия до сохранения: текст и выключатель, которые были заменены. */
export type EmailNotificationRevision = EmailTemplateFields & {
    id: string;
    enabled: boolean;
    actorEmail: string | null;
    createdAt: string;
};
export type EmailNotificationUpdate = Partial<EmailTemplateFields> & {
    enabled?: boolean;
};
export type EmailNotificationPreviewRequest = Partial<EmailTemplateFields> & {
    sampleVariant?: EmailSampleVariant;
};
export type EmailPreview = {
    subject: string;
    text: string;
    html: string;
};
export type EmailTestSendResult = {
    ok: true;
    to: string;
};
