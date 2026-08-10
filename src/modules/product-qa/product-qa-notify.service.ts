import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductQaAuthorRole, ProductQaMessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../auth/mail.service';
import { OrderChatService } from '../order-chat/order-chat.service';
import { ProductQaGateway } from './product-qa.gateway';
import type { ProductQaMessageOut, ProductQaStaffNewQuestionOut } from './product-qa.types';
import type { ProductCorrespondenceMessageOut } from '../product-correspondence/product-correspondence.types';

type StaffNotifyContext = {
  productId: string;
  productSlug: string;
  productTitle: string;
  message: ProductQaMessageOut;
  bodyPreview: string;
  staffPayload: ProductQaStaffNewQuestionOut;
};

@Injectable()
export class ProductQaNotifyService {
  private readonly logger = new Logger(ProductQaNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly orderChat: OrderChatService,
    private readonly gateway: ProductQaGateway,
  ) {}

  /** Email покупателю о новом ответе staff в private correspondence. */
  scheduleCustomerNotifyForCorrespondenceReply(
    productId: string,
    customerUserId: string,
    message: ProductCorrespondenceMessageOut,
  ): void {
    if (message.authorRole !== ProductQaAuthorRole.STAFF) return;
    void this.notifyCustomerCorrespondenceReply(productId, customerUserId, message).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Product QA customer reply notify failed: ${msg}`);
    });
  }

  private async notifyCustomerCorrespondenceReply(
    productId: string,
    customerUserId: string,
    message: ProductCorrespondenceMessageOut,
  ): Promise<void> {
    const [product, user] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: productId },
        select: { slug: true, name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: customerUserId },
        select: {
          email: true,
          profile: { select: { firstName: true } },
        },
      }),
    ]);
    if (!product) return;
    const to = user?.email?.trim();
    if (!to) return;

    const frontBase =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';

    const productTitle = product.name.trim() || product.slug;
    const bodyPreview = this.previewBody(message.body, message.attachments.length);

    await this.mail.sendProductQaStaffReplyCustomer({
      to,
      customerName: user?.profile?.firstName?.trim() || null,
      productTitle,
      bodyPreview,
      accountQuestionsUrl: `${frontBase}/account/questions`,
    });
  }

  /** Email покупателю об отклонении вопроса на модерации. */
  scheduleCustomerNotifyForQaReject(productId: string, message: ProductQaMessageOut): void {
    if (message.authorRole !== ProductQaAuthorRole.USER) return;
    void this.notifyCustomerQaReject(productId, message).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Product QA customer reject notify failed: ${msg}`);
    });
  }

  private async notifyCustomerQaReject(
    productId: string,
    message: ProductQaMessageOut,
  ): Promise<void> {
    const [product, user] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: productId },
        select: { slug: true, name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: message.authorUserId },
        select: {
          email: true,
          profile: { select: { firstName: true } },
        },
      }),
    ]);
    if (!product) return;
    const to = user?.email?.trim();
    if (!to) return;

    const frontBase =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';

    const productTitle = product.name.trim() || product.slug;
    const bodyPreview = this.previewBody(message.body, message.attachments.length);

    await this.mail.sendProductQaRejectCustomer({
      to,
      customerName: user?.profile?.firstName?.trim() || null,
      productTitle,
      bodyPreview,
      accountQuestionsUrl: `${frontBase}/account/questions`,
    });
  }

  /** Fire-and-forget: in-app WS (always) + email (best-effort) о новом вопросе покупателя. */
  scheduleStaffNotifyForUserQuestion(productId: string, message: ProductQaMessageOut): void {
    if (message.authorRole !== ProductQaAuthorRole.USER) return;
    void this.notifyStaffNewUserQuestion(productId, message).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Product QA staff notify failed: ${msg}`);
    });
  }

  scheduleStaffNotifyForCorrespondenceQuestion(
    productId: string,
    message: ProductCorrespondenceMessageOut,
  ): void {
    if (message.authorRole !== ProductQaAuthorRole.USER) return;
    this.scheduleStaffNotifyForUserQuestion(productId, {
      id: message.id,
      threadId: message.correspondenceId,
      topicSlug: 'correspondence',
      topicTitle: 'Переписка с покупателем',
      authorUserId: message.authorUserId,
      authorRole: message.authorRole,
      authorLabel: message.authorLabel,
      authorAvatarUrl: message.authorAvatarUrl,
      body: message.body,
      productVariantId: message.productVariantId,
      variantLabel: message.variantLabel,
      status: ProductQaMessageStatus.PENDING,
      replyToMessageId: null,
      replyToPreview: null,
      attachments: message.attachments,
      editedAt: message.editedAt ?? null,
      createdAt: message.createdAt,
    });
  }

  private async notifyStaffNewUserQuestion(
    productId: string,
    message: ProductQaMessageOut,
  ): Promise<void> {
    const ctx = await this.loadStaffNotifyContext(productId, message);
    if (!ctx) return;

    this.broadcastStaffInApp(ctx);
    this.scheduleStaffEmailBestEffort(ctx);
  }

  private async loadStaffNotifyContext(
    productId: string,
    message: ProductQaMessageOut,
  ): Promise<StaffNotifyContext | null> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { slug: true, name: true },
    });
    if (!product) return null;

    const productTitle = product.name.trim() || product.slug;
    const bodyPreview = this.previewBody(message.body, message.attachments.length);

    return {
      productId,
      productSlug: product.slug,
      productTitle,
      message,
      bodyPreview,
      staffPayload: {
        productId,
        productSlug: product.slug,
        productName: productTitle,
        messageId: message.id,
        topicSlug: message.topicSlug,
        topicTitle: message.topicTitle,
        preview: bodyPreview,
      },
    };
  }

  /** In-app push: не зависит от email / recipients / SMTP. */
  private broadcastStaffInApp(ctx: StaffNotifyContext): void {
    this.gateway.broadcastStaffNewQuestion(ctx.staffPayload);
  }

  /** Email параллельно, не блокирует WS и не пробрасывает ошибки наружу. */
  private scheduleStaffEmailBestEffort(ctx: StaffNotifyContext): void {
    void this.sendStaffEmailBestEffort(ctx).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Product QA staff email failed: ${msg}`);
    });
  }

  private async sendStaffEmailBestEffort(ctx: StaffNotifyContext): Promise<void> {
    const recipients = await this.orderChat.getStaffNotifyEmailRecipients();
    if (!recipients.length) {
      this.logger.log(
        'Product QA: no staff email recipients (set ORDER_CHAT_STAFF_EMAIL or add admin/moderator emails)',
      );
      return;
    }

    const frontBase =
      this.config.get<string>('FRONTEND_PUBLIC_URL')?.replace(/\/+$/, '') ||
      this.config.get<string>('NEXT_PUBLIC_SITE_URL')?.replace(/\/+$/, '') ||
      'http://localhost:3000';

    await this.mail.sendProductQaNewQuestionStaff({
      recipients,
      productTitle: ctx.productTitle,
      topicTitle: ctx.message.topicTitle,
      authorLabel: ctx.message.authorLabel,
      bodyPreview: ctx.bodyPreview,
      adminProductUrl: `${frontBase}/admin/catalog/products/${encodeURIComponent(ctx.productId)}`,
      storefrontUrl: `${frontBase}/product/${encodeURIComponent(ctx.productSlug)}#product-qa`,
    });
  }

  private previewBody(body: string, attachmentCount: number): string {
    const text = body.trim();
    if (text) {
      return text.length > 280 ? `${text.slice(0, 277)}…` : text;
    }
    if (attachmentCount > 0) {
      return attachmentCount === 1 ? '(вложение без текста)' : `(вложений: ${attachmentCount})`;
    }
    return '(пустое сообщение)';
  }
}
