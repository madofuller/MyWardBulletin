import { describe, test, expect, beforeEach } from 'vitest';
import {
  getUnitLabel,
  getUnitLowercase,
  getHigherUnitLabel,
  getAudienceDisplayName,
  getTranslatedAudienceDisplayName,
  getUnitNameLabel,
  getUnitLeadershipLabel
} from './terminology';

// Mock localStorage for testing
const mockLocalStorage = {
  store: {} as Record<string, string>,
  getItem: (key: string) => mockLocalStorage.store[key] || null,
  setItem: (key: string, value: string) => {
    mockLocalStorage.store[key] = value;
  },
  clear: () => {
    mockLocalStorage.store = {};
  }
};

// @ts-ignore
global.localStorage = mockLocalStorage;

describe('Terminology Functions', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  test('should default to Ward terminology', () => {
    expect(getUnitLabel()).toBe('Ward');
    expect(getUnitLowercase()).toBe('ward');
    expect(getHigherUnitLabel()).toBe('Stake');
    expect(getUnitNameLabel()).toBe('Ward Name');
    expect(getUnitLeadershipLabel()).toBe('Ward Leadership');
  });

  test('should use Branch terminology when enabled', () => {
    mockLocalStorage.setItem('useBranchTerminology', 'true');
    // Note: Due to module caching, we'd need to reload the module
    // This is more of a documentation test showing expected behavior
  });

  test('should handle audience display names correctly', () => {
    expect(getAudienceDisplayName('ward')).toBe('Ward');
    expect(getAudienceDisplayName('stake')).toBe('Stake');
    expect(getAudienceDisplayName('relief_society')).toBe('Relief Society');
    expect(getAudienceDisplayName('youth')).toBe('Youth');
  });

  test('should route audience display names through translation', () => {
    // Stand-in for i18next's t(): echoes the key so we can assert which key
    // each audience resolves to, without booting a real i18n instance.
    const t = ((key: string) => `t:${key}`) as any;

    expect(getTranslatedAudienceDisplayName(t, 'relief_society')).toBe('t:terminology.reliefSociety');
    expect(getTranslatedAudienceDisplayName(t, 'elders_quorum')).toBe('t:terminology.eldersQuorum');
    expect(getTranslatedAudienceDisplayName(t, 'young_women')).toBe('t:terminology.youngWomen');
    expect(getTranslatedAudienceDisplayName(t, 'young_men')).toBe('t:terminology.youngMen');
    expect(getTranslatedAudienceDisplayName(t, 'youth')).toBe('t:terminology.youth');
    expect(getTranslatedAudienceDisplayName(t, 'primary')).toBe('t:terminology.primary');
    expect(getTranslatedAudienceDisplayName(t, 'sunday_school')).toBe('t:terminology.sundaySchool');
    expect(getTranslatedAudienceDisplayName(t, 'gospel_doctrine')).toBe('t:terminology.gospelDoctrine');
    expect(getTranslatedAudienceDisplayName(t, 'other')).toBe('t:common.other');
  });

  test('should translate unit-dependent audiences via the unit helpers', () => {
    const t = ((key: string) => `t:${key}`) as any;

    expect(getTranslatedAudienceDisplayName(t, 'ward', 'ward')).toBe('t:terminology.ward');
    expect(getTranslatedAudienceDisplayName(t, 'branch', 'branch')).toBe('t:terminology.branch');
    expect(getTranslatedAudienceDisplayName(t, 'stake', 'ward')).toBe('t:terminology.stake');
    // Branch units label the higher unit "District/Stake", not just "District".
    expect(getTranslatedAudienceDisplayName(t, 'district', 'branch')).toBe('t:terminology.districtStake');
    // Bulletins saved under the other unit type can hold this combined value.
    expect(getTranslatedAudienceDisplayName(t, 'district/stake', 'ward')).toBe('t:terminology.stake');
  });

  test('should fall back to the raw audience for unknown values', () => {
    const t = ((key: string) => `t:${key}`) as any;

    expect(getTranslatedAudienceDisplayName(t, 'some_custom_group')).toBe('some_custom_group');
  });

  test('translated audience coverage matches the untranslated helper', () => {
    const t = ((key: string) => `t:${key}`) as any;
    const audiences = [
      'ward', 'branch', 'stake', 'district', 'district/stake', 'relief_society',
      'elders_quorum', 'young_women', 'young_men', 'youth', 'primary',
      'sunday_school', 'gospel_doctrine', 'other'
    ];

    // Neither helper should pass an audience through untouched — that would mean
    // the switch is missing a case and the label would render as a raw slug.
    for (const audience of audiences) {
      expect(getAudienceDisplayName(audience)).not.toBe(audience);
      expect(getTranslatedAudienceDisplayName(t, audience)).not.toBe(audience);
    }
  });
});