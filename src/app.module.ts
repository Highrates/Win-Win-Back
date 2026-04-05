import { join } from 'path';
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { AuditHttpInterceptor } from './modules/audit/audit-http.interceptor';
import { AuditModule } from './modules/audit/audit.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MeilisearchModule } from './meilisearch/meilisearch.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { BlogModule } from './modules/blog/blog.module';
import { BrandsModule } from './modules/brands/brands.module';
import { DesignersModule } from './modules/designers/designers.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { CartModule } from './modules/cart/cart.module';
import { PagesModule } from './modules/pages/pages.module';
import { PublicCollectionsModule } from './modules/public-collections/public-collections.module';
import { MediaLibraryModule } from './modules/media-library/media-library.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // cwd часто backend/, но при запуске из корня монорепо — подхватываем backend/.env явно.
      envFilePath: [
        join(process.cwd(), '.env'),
        join(process.cwd(), 'backend', '.env'),
      ],
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    RedisModule,
    MeilisearchModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    OrdersModule,
    CollectionsModule,
    ReferralsModule,
    BlogModule,
    BrandsModule,
    DesignersModule,
    FavoritesModule,
    CartModule,
    PagesModule,
    PublicCollectionsModule,
    MediaLibraryModule,
    AuditModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditHttpInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
  }
}
