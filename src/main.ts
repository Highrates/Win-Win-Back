import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

function shouldServeLocalUploads(config: ConfigService): boolean {
  const v = (config.get<string>('LOCAL_UPLOADS_ENABLED') || '').toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  const env = config.get<string>('NODE_ENV') || 'development';
  if (env === 'production') return false;
  const hasS3 =
    !!(config.get<string>('S3_BUCKET')?.trim()) &&
    !!(config.get<string>('S3_ACCESS_KEY_ID')?.trim() || config.get<string>('AWS_ACCESS_KEY_ID')?.trim()) &&
    !!(config.get<string>('S3_SECRET_ACCESS_KEY')?.trim() ||
      config.get<string>('AWS_SECRET_ACCESS_KEY')?.trim()) &&
    !!(config.get<string>('S3_PUBLIC_BASE_URL')?.trim());
  return !hasS3;
}

/** Rich HTML / base64 в теле JSON (админка брендов и др.) — дефолт Express ~100kb даёт 413. */
const JSON_BODY_LIMIT = '15mb';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

  const config = app.get(ConfigService);
  const port = config.get('PORT', 3001);
  const prefix = config.get('API_PREFIX', 'api/v1');

  if (shouldServeLocalUploads(config)) {
    const localDir =
      config.get<string>('LOCAL_UPLOADS_DIR')?.trim() ||
      join(process.cwd(), '.data', 'local-uploads');
    mkdirSync(localDir, { recursive: true });
    app.useStaticAssets(localDir, { prefix: '/uploads/' });
  }

  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableCors({
    origin: config.get('CORS_ORIGIN', '*'),
    credentials: true,
  });

  await app.listen(port);
  console.log(`Win-Win API: http://localhost:${port}/${prefix}`);
}

bootstrap();
