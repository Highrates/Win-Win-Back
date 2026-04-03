import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
})
export class AppModule {}
