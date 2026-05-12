import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';

const DAY_MS = 86_400_000;

@Injectable()
export class OrderChatRetentionService implements OnModuleInit {
  private readonly logger = new Logger(OrderChatRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
  ) {}

  onModuleInit(): void {
    const sweep = () => {
      void this.purgeExpired().catch((e) =>
        this.logger.error(e instanceof Error ? e.stack : String(e)),
      );
    };
    sweep();
    const t = setInterval(sweep, DAY_MS);
    t.unref?.();
  }

  async purgeExpired(): Promise<void> {
    try {
      const now = new Date();
      const expired = await this.prisma.chatConversation.findMany({
        where: { retentionPurgesAt: { lte: now } },
        include: {
          messages: {
            include: { attachments: true },
          },
        },
      });
      for (const conv of expired) {
        for (const m of conv.messages) {
          for (const a of m.attachments) {
            const key = this.storage.tryPublicUrlToKey(a.fileUrl);
            if (key) {
              await this.storage.removeObjectKey(key).catch(() => undefined);
            }
          }
        }
        await this.prisma.chatConversation.delete({ where: { id: conv.id } });
      }
      if (expired.length) {
        this.logger.log(`order-chat retention: удалено диалогов ${expired.length}`);
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') {
        this.logger.warn(
          'order-chat retention пропущен: таблицы чата не в БД (выполните миграции prisma для order chat)',
        );
        return;
      }
      throw e;
    }
  }
}
