import { Injectable, NotFoundException } from '@nestjs/common';
import { ChatConversationKind, OrderStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StaffAccessService } from '../staff/staff-access.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { orderDocumentFilename } from '../orders/order-document-labels';
import { openStoredFile, type StoredFileResponse } from '../storage/stored-file';

export type PrivateFileViewer = { userId: string; role: string };

type FileRef = { url: string; filename: string; mimeType: string | null };

/**
 * Персональные файлы по составному id: `chat:<attachmentId>`, `sourcing:<attachmentId>`, `order-doc:<documentId>`.
 * Покупатель — только свои; сотрудник с доступом к разделу «Заказы» — любые.
 * Чужой или несуществующий id — 404 без различия, чтобы не раскрывать наличие.
 */
@Injectable()
export class PrivateFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly staffAccess: StaffAccessService,
  ) {}

  async open(viewer: PrivateFileViewer, fileRef: string): Promise<StoredFileResponse> {
    const ref = await this.find(viewer, fileRef);
    if (!ref) throw new NotFoundException('Файл не найден');
    return openStoredFile(this.storage, ref);
  }

  private async isStaff(viewer: PrivateFileViewer): Promise<boolean> {
    if (viewer.role !== UserRole.ADMIN && viewer.role !== UserRole.MODERATOR) return false;
    return this.staffAccess.canAccessOrdersSection(viewer.userId, viewer.role as UserRole);
  }

  private async find(viewer: PrivateFileViewer, fileRef: string): Promise<FileRef | null> {
    const sep = fileRef.indexOf(':');
    if (sep <= 0) return null;
    const type = fileRef.slice(0, sep);
    const id = fileRef.slice(sep + 1);
    if (!id) return null;
    const staff = await this.isStaff(viewer);
    const userId = viewer.userId;

    if (type === 'chat') {
      const conversation: Prisma.ChatConversationWhereInput = {
        AND: [
          { OR: [{ retentionPurgesAt: null }, { retentionPurgesAt: { gt: new Date() } }] },
          staff
            ? {}
            : {
                OR: [
                  { kind: ChatConversationKind.ORDER, order: { userId, status: { not: OrderStatus.DRAFT } } },
                  { kind: ChatConversationKind.SOURCING, sourcingRequest: { userId } },
                ],
              },
        ],
      };
      const a = await this.prisma.chatAttachment.findFirst({
        where: { id, message: { deletedAt: null, conversation } },
        select: { fileUrl: true, filename: true, mimeType: true },
      });
      return a ? { url: a.fileUrl, filename: a.filename, mimeType: a.mimeType } : null;
    }

    if (type === 'sourcing') {
      const a = await this.prisma.sourcingRequestAttachment.findFirst({
        where: { id, ...(staff ? {} : { request: { userId } }) },
        select: { url: true, filename: true, mimeType: true },
      });
      return a ? { url: a.url, filename: a.filename, mimeType: a.mimeType } : null;
    }

    if (type === 'order-doc') {
      const d = await this.prisma.orderDocument.findFirst({
        where: { id, ...(staff ? {} : { order: { userId, status: { not: OrderStatus.DRAFT } } }) },
        select: { kind: true, url: true },
      });
      return d ? { url: d.url, filename: orderDocumentFilename(d.kind, d.url), mimeType: null } : null;
    }

    return null;
  }
}