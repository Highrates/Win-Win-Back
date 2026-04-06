import { Module } from '@nestjs/common';
import { BlogService } from './blog.service';
import { BlogController } from './blog.controller';
import { BlogAdminService } from './blog-admin.service';
import { BlogAdminController } from './blog-admin.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [BlogService, BlogAdminService],
  controllers: [BlogController, BlogAdminController],
  exports: [BlogService, BlogAdminService],
})
export class BlogModule {}
