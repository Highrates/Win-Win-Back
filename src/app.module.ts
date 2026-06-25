import { join } from 'path';
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { AuditHttpInterceptor } from './modules/audit/audit-http.interceptor';
import { AuditModule } from './modules/audit/audit.module';
import { AuthSecurityExceptionFilter } from './modules/audit/auth-security.exception-filter';
import { PrismaModule } from './prisma/prisma.module';
import { MeilisearchModule } from './meilisearch/meilisearch.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OrderChatModule } from './modules/order-chat/order-chat.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { BlogModule } from './modules/blog/blog.module';
import { BrandsModule } from './modules/brands/brands.module';
import { DesignersModule } from './modules/designers/designers.module';
import { CartModule } from './modules/cart/cart.module';
import { PagesModule } from './modules/pages/pages.module';
import { PublicCollectionsModule } from './modules/public-collections/public-collections.module';
import { MediaLibraryModule } from './modules/media-library/media-library.module';
import { SiteSettingsModule } from './modules/site-settings/site-settings.module';
import { CasesModule } from './modules/cases/cases.module';
import { DesignerProjectsModule } from './modules/designer-projects/designer-projects.module';
import { OrderSettingsModule } from './modules/order-settings/order-settings.module';
import { UserGroupProfilesModule } from './modules/user-group-profiles/user-group-profiles.module';
import { UserGroupsModule } from './modules/user-groups/user-groups.module';
import { SourcingRequestsModule } from './modules/sourcing-requests/sourcing-requests.module';
import { LikesModule } from './modules/likes/likes.module';

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
    // default limiter: 100 req/min per tracker (см. ThrottlerGuard).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 100 }]),
    PrismaModule,
    MeilisearchModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    OrderChatModule,
    OrdersModule,
    CollectionsModule,
    ReferralsModule,
    BlogModule,
    BrandsModule,
    DesignersModule,
    CartModule,
    PagesModule,
    PublicCollectionsModule,
    MediaLibraryModule,
    SiteSettingsModule,
    CasesModule,
    LikesModule,
    DesignerProjectsModule,
    AuditModule,
    OrderSettingsModule,
    UserGroupProfilesModule,
    UserGroupsModule,
    SourcingRequestsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: AuthSecurityExceptionFilter,
    },
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
