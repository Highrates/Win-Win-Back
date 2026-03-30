import { Controller, Get, Param, Query } from '@nestjs/common';
import { BlogService } from './blog.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('blog')
export class BlogController {
  constructor(private blogService: BlogService) {}

  @Public()
  @Get('categories')
  categories() {
    return this.blogService.getCategories();
  }

  @Public()
  @Get('posts')
  posts(
    @Query('categoryId') categoryId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.blogService.getPosts({
      categoryId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Public()
  @Get('posts/:slug')
  post(@Param('slug') slug: string) {
    return this.blogService.getPostBySlug(slug);
  }
}
