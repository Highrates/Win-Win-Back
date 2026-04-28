import type { LegalType, KycStatus, Prisma } from '@prisma/client';

/**
 * Явный контракт ответа `GET/PATCH .../users/me/profile` (и методов, возвращающих витрину ЛК).
 * Без произвольного `...p`, чтобы не утекали внутренние поля профиля при расширении схемы.
 */
export type UserProfileVitrineDto = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  services: Prisma.JsonValue;
  aboutHtml: string | null;
  coverLayout: string | null;
  coverImageUrls: Prisma.JsonValue;
  profileOnboardingPending: boolean;
  winWinPartnerApproved: boolean;
  partnerApplicationCoverLetter: string | null;
  partnerApplicationCvUrl: string | null;
  partnerApplicationSubmittedAt: Date | null;
  partnerApplicationRejectedAt: Date | null;
  partnerApplicationReferralCode: string | null;
  winWinReferralCode: string | null;
  legalType: LegalType | null;
  companyName: string | null;
  inn: string | null;
  kpp: string | null;
  legalAddress: string | null;
  bankName: string | null;
  bankAccount: string | null;
  kycStatus: KycStatus | null;
  updatedAt: Date;
  /** Email пользователя (не из UserProfile — для ЛК). */
  email: string | null;
  referralInviteCodeExempt: boolean;
  designerSlug: string | null;
  designerSiteVisible: boolean;
};

/** Select для чтения профиля ЛК без «тяжёлых» или внутренних JSON (напр. kycData). */
export const USER_PROFILE_VITRINE_SELECT = {
  userId: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  city: true,
  services: true,
  aboutHtml: true,
  coverLayout: true,
  coverImageUrls: true,
  profileOnboardingPending: true,
  winWinPartnerApproved: true,
  partnerApplicationCoverLetter: true,
  partnerApplicationCvUrl: true,
  partnerApplicationSubmittedAt: true,
  partnerApplicationRejectedAt: true,
  partnerApplicationReferralCode: true,
  winWinReferralCode: true,
  legalType: true,
  companyName: true,
  inn: true,
  kpp: true,
  legalAddress: true,
  bankName: true,
  bankAccount: true,
  kycStatus: true,
  updatedAt: true,
} as const satisfies Prisma.UserProfileSelect;

export type UserProfileVitrineRow = Prisma.UserProfileGetPayload<{ select: typeof USER_PROFILE_VITRINE_SELECT }>;

export function mapUserProfileToVitrineDto(
  row: UserProfileVitrineRow,
  email: string | null,
  referralInviteCodeExempt: boolean,
  designerSlug: string | null,
  designerSiteVisible: boolean,
): UserProfileVitrineDto {
  return {
    ...row,
    email,
    referralInviteCodeExempt,
    designerSlug,
    designerSiteVisible,
  };
}
