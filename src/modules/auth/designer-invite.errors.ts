import { BadRequestException } from '@nestjs/common';
import {
  DESIGNER_INVITE_ERROR_CODE,
  type DesignerInviteErrorCode,
} from './designer-invite.constants';

/** Nest BadRequest с машинным `code` для invite-flow. */
export function designerInviteBadRequest(
  code: DesignerInviteErrorCode,
  message: string,
): BadRequestException {
  return new BadRequestException({ message, code });
}

export function inviteInvalid(message: string): BadRequestException {
  return designerInviteBadRequest(DESIGNER_INVITE_ERROR_CODE.INVALID, message);
}

export function inviteMismatch(message: string): BadRequestException {
  return designerInviteBadRequest(DESIGNER_INVITE_ERROR_CODE.MISMATCH, message);
}
