import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { BlogService } from './blog.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('blog')
export class BlogController {
  constructor(private blogService: BlogService) {}

  @Public()
  @Get('categories')
  categories() {
    return this.blogService.getPublicCategories();
  }

  /** Статичный путь до параметризованного `posts/:slug`, иначе в некоторых версиях Nest список может конфликтовать с деталкой. */
  @Public()
  @Get('posts')
  posts(
    @Query('categoryId') categoryId?: string,
    @Query('categorySlug') categorySlug?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.blogService.getPosts({
      categoryId,
      categorySlug,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Public()
  @Get('posts/:slug')
  async post(@Param('slug') slug: string) {
    let s = slug;
    try {
      s = decodeURIComponent(slug);
    } catch {
      /* как пришло */
    }
    const row = await this.blogService.getPostBySlug(s);
    if (!row) throw new NotFoundException();
    return row;
  }
}
