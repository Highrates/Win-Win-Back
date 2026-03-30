import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get('PORT', 3001);
  const prefix = config.get('API_PREFIX', 'api/v1');

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
