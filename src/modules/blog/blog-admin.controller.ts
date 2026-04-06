import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { BlogAdminService } from './blog-admin.service';
import {
  BulkIdsDto,
  BulkSetPublishedDto,
  CreateBlogCategoryAdminDto,
  CreateBlogPostAdminDto,
  ReorderBlogPostsDto,
  UpdateBlogCategoryAdminDto,
  UpdateBlogPostAdminDto,
} from './dto/blog-admin.dto';

@Controller('blog/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
export class BlogAdminController {
  constructor(private readonly blogAdmin: BlogAdminService) {}

  @Get('categories')
  listCategories() {
    return this.blogAdmin.listCategoriesAdmin();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateBlogCategoryAdminDto) {
    return this.blogAdmin.createCategory(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateBlogCategoryAdminDto) {
    return this.blogAdmin.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.blogAdmin.deleteCategory(id);
  }

  @Get('posts')
  listPosts(
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.blogAdmin.listPostsAdmin({
      q,
      categoryId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('posts/:id')
  getPost(@Param('id') id: string) {
    return this.blogAdmin.getPostAdmin(id);
  }

  @Post('posts')
  createPost(@Body() dto: CreateBlogPostAdminDto, @CurrentUser() user: JwtPayload) {
    return this.blogAdmin.createPost(dto, user?.sub);
  }

  @Patch('posts/:id')
  updatePost(@Param('id') id: string, @Body() dto: UpdateBlogPostAdminDto) {
    return this.blogAdmin.updatePost(id, dto);
  }

  @Delete('posts/:id')
  deletePost(@Param('id') id: string) {
    return this.blogAdmin.deletePost(id);
  }

  @Post('posts/bulk-delete')
  bulkDeletePosts(@Body() dto: BulkIdsDto) {
    return this.blogAdmin.bulkDeletePosts(dto);
  }

  @Post('posts/bulk-published')
  bulkSetPublished(@Body() dto: BulkSetPublishedDto) {
    return this.blogAdmin.bulkSetPublished(dto);
  }

  @Post('posts/reorder')
  reorderPosts(@Body() dto: ReorderBlogPostsDto) {
    return this.blogAdmin.reorderPosts(dto);
  }
}
