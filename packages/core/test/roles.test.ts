import { describe, expect, it } from 'vitest';
import { ROLE_CODES, ROLES, SPACES, canCombineRoles, isRoleCode, roleLabelKey } from '../src/index';

describe('roles and spaces', () => {
  it('has the thirteen spaces of the study', () => {
    expect(SPACES).toHaveLength(13);
    expect(new Set(SPACES).size).toBe(13);
  });

  it('has twenty-six distinct roles, each in one of the spaces', () => {
    expect(ROLE_CODES).toHaveLength(26);
    expect(new Set(ROLE_CODES).size).toBe(26);
    for (const code of ROLE_CODES) {
      expect(ROLES[code].code).toBe(code);
      expect(SPACES).toContain(ROLES[code].space);
    }
  });

  it('gives every space at least one role', () => {
    for (const space of SPACES) {
      expect(ROLE_CODES.some((code) => ROLES[code].space === space)).toBe(true);
    }
  });

  it('keeps the clerk offices as distinct roles, never merged', () => {
    const clerkRoles = ROLE_CODES.filter((code) => ROLES[code].space === 'clerk');
    expect(clerkRoles).toEqual([
      'CLERK_REGISTRATION',
      'CLERK_CASHIER',
      'CLERK_NOTIFICATION',
      'CLERK_HEARING',
      'CLERK_COPIES_ENFORCEMENT',
      'CHIEF_CLERK',
    ]);
  });

  it('labels the court president as «الرئيس الأول» at an appeal court', () => {
    expect(roleLabelKey('COURT_PRESIDENT', 'FIRST_INSTANCE')).toBe('roles.COURT_PRESIDENT');
    expect(roleLabelKey('COURT_PRESIDENT', 'APPEAL')).toBe('roles.COURT_PRESIDENT_APPEAL');
    expect(roleLabelKey('LAWYER', 'APPEAL')).toBe('roles.LAWYER');
  });

  it('recognises role codes and nothing else', () => {
    expect(isRoleCode('LAWYER')).toBe(true);
    expect(isRoleCode('lawyer')).toBe(false);
    expect(isRoleCode('__proto__')).toBe(false);
    expect(isRoleCode(undefined)).toBe(false);
  });
});

describe('combining roles', () => {
  it('allows ordinary combinations, such as a rapporteur who presides another panel', () => {
    expect(canCombineRoles(['JUDGE_RAPPORTEUR'], 'PANEL_PRESIDENT')).toBe(true);
    expect(canCombineRoles([], 'SYSTEM_ADMIN')).toBe(true);
  });

  it('never combines system administration with another role', () => {
    expect(canCombineRoles(['SYSTEM_ADMIN'], 'JUDGE_RAPPORTEUR')).toBe(false);
    expect(canCombineRoles(['JUDGE_RAPPORTEUR'], 'SYSTEM_ADMIN')).toBe(false);
    expect(canCombineRoles(['RULES_LEGAL_VALIDATOR'], 'SYSTEM_ADMIN')).toBe(false);
    expect(canCombineRoles(['SYSTEM_ADMIN'], 'RULES_LEGAL_VALIDATOR')).toBe(false);
  });
});
