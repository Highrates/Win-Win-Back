import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaLibraryService } from './media-library.service';

@Injectable()
export class MediaLibraryRetentionService implements OnModuleInit {
  private readonly logger = new Logger(MediaLibraryRetentionService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly media: MediaLibraryService,
  ) {}

  onModuleInit(): void {
    const raw = this.config.get<string>('MEDIA_LIBRARY_SWEEP_INTERVAL_MS') ?? '0';
    const ms = parseInt(raw, 10);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.logger.log(`Фоновая уборка orphan-ключей objects/ каждые ${ms} ms`);
    const tick = () => {
      this.media
        .sweepOrphanObjectKeysUnderPrefix('objects/')
        .then((r) => {
          if (r.deleted > 0) {
            this.logger.log(`Удалены сироты в S3/локально: ${r.deleted} из ${r.scanned} ключей`);
          }
        })
        .catch((e) => this.logger.error(e));
    };
    const h = setInterval(tick, ms);
    if (typeof (h as NodeJS.Timeout).unref === 'function') {
      (h as NodeJS.Timeout).unref();
    }
  }
}
