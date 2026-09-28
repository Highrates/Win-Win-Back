import type { EmailNotificationPreviewRequest, EmailNotificationUpdate, EmailSampleVariant } from '@win-win/admin-sections';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class UpdateEmailNotificationDto implements EmailNotificationUpdate {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  subject?: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20_000)
  body?: string;
}

export class PreviewEmailNotificationDto implements EmailNotificationPreviewRequest {
  @IsOptional()
  @IsString()
  @Length(1, 300)
  subject?: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20_000)
  body?: string;

  @IsOptional()
  @IsIn(['full', 'sparse'] satisfies EmailSampleVariant[])
  sampleVariant?: EmailSampleVariant;
}
