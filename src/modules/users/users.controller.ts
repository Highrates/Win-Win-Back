import { Body, Controller, Get, Patch, Post, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { LkVitrineUploadExceptionFilter } from './lk-vitrine-upload.exception-filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateUserProfileDto } from './dto/user-profile.dto';
import { UpdateConsentsDto, UpdatePasswordDto } from './dto/user-account.dto';
import { SendDesignerInviteDto, DesignerInviteTokenBodyDto } from '../auth/dto/designer-invite.dto';
import { DesignerInviteService } from '../auth/designer-invite.service';
import { Throttle } from '@nestjs/throttler';

const LK_AVATAR_MAX = 2 * 1024 * 1024;
const LK_COVER_MAX = 5 * 1024 * 1024;
const LK_RICH_MAX = 100 * 1024 * 1024;
const LK_PARTNER_CV_MAX = 20 * 1024 * 1024;

@Controller('users')
@UseGuards(JwtAuthGuard)
@UseFilters(LkVitrineUploadExceptionFilter)
export class UsersController {
  constructor(
    private usersService: UsersService,
    private designerInvites: DesignerInviteService,
  ) {}

  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.usersService.findByIdPublic(userId);
  }

  @Get('me/profile')
  myProfile(@CurrentUser('sub') userId: string) {
    return this.usersService.getUserProfileVitrine(userId);
  }

  /** Реферальная структура «Команда» (L1/L2) + сводка для витрины ЛК партнёра. */
  @Get('me/winwin-team')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  myWinWinTeam(@CurrentUser('sub') userId: string) {
    return this.usersService.getWinWinPartnerTeamOverview(userId);
  }

  @Patch('me/profile')
  updateMyProfile(@CurrentUser('sub') userId: string, @Body() dto: UpdateUserProfileDto) {
    return this.usersService.updateUserProfileVitrine(userId, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      city: dto.city,
      services: dto.services,
      aboutHtml: dto.aboutHtml,
      coverLayout: dto.coverLayout,
      coverImageUrls: dto.coverImageUrls,
      avatarUrl: dto.avatarUrl,
    });
  }

  @Patch('me/profile/onboarding/ack')
  ackOnboarding(@CurrentUser('sub') userId: string) {
    return this.usersService.ackProfileOnboarding(userId);
  }

  @Patch('me/password')
  updateMyPassword(@CurrentUser('sub') userId: string, @Body() dto: UpdatePasswordDto) {
    return this.usersService.changePassword(userId, dto.currentPassword, dto.newPassword);
  }

  @Patch('me/consents')
  updateMyConsents(@CurrentUser('sub') userId: string, @Body() dto: UpdateConsentsDto) {
    return this.usersService.updateAccountConsents(userId, {
      consentPersonalData: dto.consentPersonalData,
      consentSmsMarketing: dto.consentSmsMarketing,
    });
  }

  @Post('me/profile/avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LK_AVATAR_MAX } }))
  async uploadAvatar(@CurrentUser('sub') userId: string, @UploadedFile() file: Express.Multer.File) {
    const { publicUrl } = await this.usersService.uploadUserAvatarImage(userId, file);
    return this.usersService.updateUserProfileVitrine(userId, { avatarUrl: publicUrl });
  }

  @Post('me/profile/cover')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LK_COVER_MAX } }))
  async uploadCover(@CurrentUser('sub') userId: string, @UploadedFile() file: Express.Multer.File) {
    return this.usersService.uploadUserCoverImage(userId, file);
  }

  /** Загрузки для блока «Подробнее о вас» (RichBlock) — та же папка пользователя в S3, что и обложка. */
  @Post('me/profile/rich-media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LK_RICH_MAX } }))
  async uploadProfileRichMedia(@CurrentUser('sub') userId: string, @UploadedFile() file: Express.Multer.File) {
    return this.usersService.uploadUserProfileRichMedia(userId, file);
  }

  /** Заявка на партнёра Win-Win: multipart `coverLetter` (текст) + `file` (CV). */
  @Post('me/designer-invite')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  sendDesignerInvite(@CurrentUser('sub') userId: string, @Body() dto: SendDesignerInviteDto) {
    return this.designerInvites.sendInvite(userId, dto.email);
  }

  @Post('me/designer-invite/claim')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  claimDesignerInvite(@CurrentUser('sub') userId: string, @Body() dto: DesignerInviteTokenBodyDto) {
    return this.designerInvites.claimByTokenForUser(userId, dto.token);
  }

  @Post('me/partner-application')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LK_PARTNER_CV_MAX } }))
  async submitPartnerApplication(
    @CurrentUser('sub') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('coverLetter') coverLetter: string,
    @Body('referralCode') referralCode: string,
  ) {
    return this.usersService.submitPartnerApplication(userId, file, coverLetter ?? '', referralCode);
  }
}
