import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readMigration(dir: string): string {
  return readFileSync(
    join(__dirname, '../../../prisma/migrations', dir, 'migration.sql'),
    'utf8',
  );
}

describe('user-group-profiles migrations', () => {
  const phase1 = readMigration('20260621120000_user_group_profiles_phase1');
  const percentFields = readMigration('20260623120000_referral_profile_percent_fields');
  const primaryLabel = readMigration('20260622120000_profile_primary_label');
  const phase2 = readMigration('20260624120000_user_groups_phase2');

  it('phase1: создаёт таблицы профилей и partial unique на isDefault', () => {
    expect(phase1).toContain('CREATE TABLE "ReferralProgramProfile"');
    expect(phase1).toContain('CREATE TABLE "DesignerBonusProfile"');
    expect(phase1).toContain('ReferralProgramProfile_single_default_idx');
    expect(phase1).toContain('DesignerBonusProfile_single_default_idx');
  });

  it('phase1: seed основных профилей с фиксированными id', () => {
    expect(phase1).toContain("'ref_prog_profile_default'");
    expect(phase1).toContain("'designer_bonus_profile_default'");
    expect(phase1).toContain('"isDefault"');
    expect(phase1).toContain('order_designer_own_catalog_bonus_percent');
  });

  it('percent fields: добавляет L1/L2/мин. в ReferralProgramProfile', () => {
    expect(percentFields).toContain('"level1Percent"');
    expect(percentFields).toContain('"level2Percent"');
    expect(percentFields).toContain('"minimumOrderSiteTotalRub"');
    expect(percentFields).toContain('referral_level1_percent');
  });

  it('primary label: переименовывает seed «По умолчанию» → «Основной»', () => {
    expect(primaryLabel).toContain("'Основной'");
    expect(primaryLabel).toContain("'По умолчанию'");
  });

  it('phase2: UserGroup, UserGroupMember, снимки на Order', () => {
    expect(phase2).toContain('CREATE TABLE "UserGroup"');
    expect(phase2).toContain('CREATE TABLE "UserGroupMember"');
    expect(phase2).toContain('UserGroupMember_userId_key');
    expect(phase2).toContain('buyerReferralProgramProfileIdSnapshot');
    expect(phase2).toContain('buyerDesignerBonusProfileIdSnapshot');
  });
});
