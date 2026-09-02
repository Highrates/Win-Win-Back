import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AssistantChatDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  threadId?: string;
}
