import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const TOO_MANY =
  'Слишком много запросов кода за короткое время. Подождите около 15 минут и попробуйте снова.';

/**
 * Shared OTP-start counters (Postgres) — корректно при нескольких инстансах API.
 * Атомарный upsert через raw SQL.
 */
@Injectable()
export class AuthRateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async consumeSlot(bucketKey: string, maxPerWindow: number, windowMs: number): Promise<void> {
    const key = bucketKey.trim().slice(0, 191);
    if (!key) return;

    const now = new Date();
    const windowEnd = new Date(now.getTime() + windowMs);

    await this.prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "AuthRateLimitBucket" ("bucketKey", "count", "windowEnd", "updatedAt")
        VALUES (${key}, 1, ${windowEnd}, ${now})
        ON CONFLICT ("bucketKey") DO UPDATE SET
          "count" = CASE
            WHEN "AuthRateLimitBucket"."windowEnd" < ${now} THEN 1
            ELSE "AuthRateLimitBucket"."count" + 1
          END,
          "windowEnd" = CASE
            WHEN "AuthRateLimitBucket"."windowEnd" < ${now} THEN ${windowEnd}
            ELSE "AuthRateLimitBucket"."windowEnd"
          END,
          "updatedAt" = ${now}
      `,
    );

    const row = await this.prisma.authRateLimitBucket.findUnique({
      where: { bucketKey: key },
      select: { count: true },
    });

    if ((row?.count ?? 0) > maxPerWindow) {
      throw new HttpException(TOO_MANY, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
