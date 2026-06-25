import { SourcingRequestStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateSourcingRequestStatusDto {
  @IsEnum(SourcingRequestStatus)
  status!: SourcingRequestStatus;
}
