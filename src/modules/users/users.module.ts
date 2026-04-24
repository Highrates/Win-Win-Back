import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsersAdminController } from './users-admin.controller';
import { MediaLibraryModule } from '../media-library/media-library.module';

@Module({
  imports: [MediaLibraryModule],
  providers: [UsersService],
  controllers: [UsersController, UsersAdminController],
  exports: [UsersService],
})
export class UsersModule {}
