import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const LEGAL_TYPES = ['INDIVIDUAL', 'IE', 'LLC'] as const;

export class CustomerKpRequisitesDto {
  @IsIn(LEGAL_TYPES)
  legalType!: (typeof LEGAL_TYPES)[number];

  @IsString()
  @MaxLength(200)
  contactName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ValidateIf((o: CustomerKpRequisitesDto) => o.legalType !== 'INDIVIDUAL')
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @ValidateIf((o: CustomerKpRequisitesDto) => o.legalType !== 'INDIVIDUAL')
  @IsString()
  @MaxLength(20)
  inn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  kpp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  legalAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bankAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  correspondentAccount?: string;
}

export class AcceptCommercialProposalDto {
  /** Версия опубликованного КП, на которую клиент отвечает (optimistic concurrency). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ValidateNested()
  @Type(() => CustomerKpRequisitesDto)
  requisites!: CustomerKpRequisitesDto;
}

export class RecordCommercialProposalDecisionDto {
  /** Версия опубликованного КП, на которую клиент отвечает (optimistic concurrency). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsIn(['CHANGES_REQUESTED', 'REJECTED'])
  decision!: 'CHANGES_REQUESTED' | 'REJECTED';
}
