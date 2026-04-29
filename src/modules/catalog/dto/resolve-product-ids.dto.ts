import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

export class ResolveProductIdsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  ids?: string[];
}
