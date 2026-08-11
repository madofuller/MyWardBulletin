import { getCurrentUnitType, getTerminologyForUnitType, UnitType } from './config';
import { TFunction } from 'i18next';

// Helper function to get terminology based on optional override.
// Reads the current unit type live so labels are correct after the cloud
// profile sync updates it post-login (a frozen module constant was not).
function getTerminology(unitTypeOverride?: UnitType) {
  return getTerminologyForUnitType(unitTypeOverride ?? getCurrentUnitType());
}

// Helper functions to get terminology-aware labels
export function getUnitLabel(unitTypeOverride?: UnitType): string {
  return getTerminology(unitTypeOverride).unit;
}

export function getUnitLowercase(unitTypeOverride?: UnitType): string {
  return getTerminology(unitTypeOverride).unitLowercase;
}

export function getHigherUnitLabel(unitTypeOverride?: UnitType): string {
  return getTerminology(unitTypeOverride).higherUnit;
}

export function getHigherUnitLowercase(unitTypeOverride?: UnitType): string {
  return getTerminology(unitTypeOverride).higherUnitLowercase;
}

export function getLeaderTitle(unitTypeOverride?: UnitType): string {
  return getTerminology(unitTypeOverride).leader;
}

export function getLeadershipBodyTitle(unitTypeOverride?: UnitType): string {
  return getTerminology(unitTypeOverride).leadershipBody;
}

export function getUnitPossessive(unitTypeOverride?: UnitType): string {
  return getTerminology(unitTypeOverride).unitPossessive;
}

// Helper function to get audience display name
export function getAudienceDisplayName(audience: string, unitTypeOverride?: UnitType): string {
  const term = getTerminology(unitTypeOverride);
  switch (audience) {
    case 'ward':
    case 'branch':
      return term.unit;
    case 'stake':
    case 'district':
    case 'district/stake':
      return term.higherUnit;
    case 'relief_society':
      return 'Relief Society';
    case 'elders_quorum':
      return 'Elders Quorum';
    case 'young_women':
      return 'Young Women';
    case 'young_men':
      return 'Young Men';
    case 'youth':
      return 'Youth';
    case 'primary':
      return 'Primary';
    case 'sunday_school':
      return 'Sunday School';
    case 'gospel_doctrine':
      return 'Gospel Doctrine';
    case 'other':
      return 'Other';
    default:
      return audience;
  }
}

// Helper function to get the appropriate higher unit label based on context
// Branches can be in either Stakes or Districts, so we need to be flexible
export function getHigherUnitLabelForContext(isBranch: boolean = false, unitTypeOverride?: UnitType): string {
  if (isBranch) {
    // For branches, we default to District but could be Stake
    return 'District/Stake';
  }
  return getTerminology(unitTypeOverride).higherUnit;
}

// Helper function to get the correct audience value based on current terminology
export function getAudienceValue(type: 'unit' | 'higher_unit', unitTypeOverride?: UnitType): string {
  const term = getTerminology(unitTypeOverride);
  if (type === 'unit') {
    return term.unitLowercase;
  } else if (type === 'higher_unit') {
    return term.higherUnitLowercase;
  }
  return 'other';
}

// Default leadership roster titled for the unit type, so branches don't
// start with (and print) 'Bishop' / 'Ward Clerk' rows they have to retitle.
export function getDefaultLeadershipTitles(unitTypeOverride?: UnitType): string[] {
  const isBranch = (unitTypeOverride ?? getCurrentUnitType()) === 'branch';
  return [
    isBranch ? 'Branch President' : 'Bishop',
    '1st Counselor',
    '2nd Counselor',
    'Executive Secretary',
    isBranch ? 'Branch Clerk' : 'Ward Clerk',
    'Elders Quorum President',
    'Relief Society President',
    "Young Women's President",
    'Primary President',
    'Sunday School President',
    isBranch ? 'Branch Mission Leader' : 'Ward Mission Leader',
    'Building Representative',
    'Temple & Family History',
  ];
}

export function getDefaultLeadershipRoster(unitTypeOverride?: UnitType): Array<{ title: string; name: string; phone: string }> {
  return getDefaultLeadershipTitles(unitTypeOverride).map(title => ({ title, name: '', phone: '' }));
}

// Template string helpers for dynamic content
export function getUnitNameLabel(unitTypeOverride?: UnitType): string {
  return `${getTerminology(unitTypeOverride).unit} Name`;
}

export function getUnitLeadershipLabel(unitTypeOverride?: UnitType): string {
  return `${getTerminology(unitTypeOverride).unit} Leadership`;
}

export function getUnitMissionariesLabel(unitTypeOverride?: UnitType): string {
  return `${getTerminology(unitTypeOverride).unit} Missionaries`;
}

export function getLeadershipMessageLabel(unitTypeOverride?: UnitType): string {
  return `${getTerminology(unitTypeOverride).leadershipBody} Message`;
}

// Re-export UnitType for convenience
export type { UnitType } from './config';

// ========================================
// TRANSLATED TERMINOLOGY HELPERS
// ========================================
// These functions return translated unit labels using i18next

/**
 * Get the translated unit label (Ward/Branch) based on unit type
 */
export function getTranslatedUnitLabel(t: TFunction, unitTypeOverride?: UnitType): string {
  const unitType = unitTypeOverride || (typeof window !== 'undefined' ? localStorage.getItem('selectedUnitType') as UnitType : 'ward') || 'ward';
  return unitType === 'branch' ? t('terminology.branch') : t('terminology.ward');
}

/**
 * Get the translated unit label in lowercase
 */
export function getTranslatedUnitLowercase(t: TFunction, unitTypeOverride?: UnitType): string {
  const unitType = unitTypeOverride || (typeof window !== 'undefined' ? localStorage.getItem('selectedUnitType') as UnitType : 'ward') || 'ward';
  return unitType === 'branch' ? t('terminology.branchLowercase') : t('terminology.wardLowercase');
}

/**
 * Get the translated higher unit label (Stake/District)
 */
export function getTranslatedHigherUnitLabel(t: TFunction, unitTypeOverride?: UnitType): string {
  const unitType = unitTypeOverride || (typeof window !== 'undefined' ? localStorage.getItem('selectedUnitType') as UnitType : 'ward') || 'ward';
  return unitType === 'branch' ? t('terminology.districtStake') : t('terminology.stake');
}

/**
 * Get the translated leadership body label (Bishopric/Branch Presidency)
 */
export function getTranslatedLeadershipBody(t: TFunction, unitTypeOverride?: UnitType): string {
  const unitType = unitTypeOverride || (typeof window !== 'undefined' ? localStorage.getItem('selectedUnitType') as UnitType : 'ward') || 'ward';
  return unitType === 'branch' ? t('terminology.branchPresidency') : t('terminology.bishopric');
}

/**
 * Get the translated leader title (Bishop/Branch President)
 */
/**
 * Translated counterpart of getAudienceDisplayName. The untranslated version
 * hardcodes English for the auxiliary organizations, so anything rendering an
 * audience label through it stays English no matter the selected language.
 * Case coverage must stay in sync with getAudienceDisplayName above.
 */
export function getTranslatedAudienceDisplayName(t: TFunction, audience: string, unitTypeOverride?: UnitType): string {
  switch (audience) {
    case 'ward':
    case 'branch':
      return getTranslatedUnitLabel(t, unitTypeOverride);
    case 'stake':
    case 'district':
    case 'district/stake':
      return getTranslatedHigherUnitLabel(t, unitTypeOverride);
    case 'relief_society':
      return t('terminology.reliefSociety');
    case 'elders_quorum':
      return t('terminology.eldersQuorum');
    case 'young_women':
      return t('terminology.youngWomen');
    case 'young_men':
      return t('terminology.youngMen');
    case 'youth':
      return t('terminology.youth');
    case 'primary':
      return t('terminology.primary');
    case 'sunday_school':
      return t('terminology.sundaySchool');
    case 'gospel_doctrine':
      return t('terminology.gospelDoctrine');
    case 'other':
      return t('common.other');
    default:
      return audience;
  }
}

export function getTranslatedLeaderTitle(t: TFunction, unitTypeOverride?: UnitType): string {
  const unitType = unitTypeOverride || (typeof window !== 'undefined' ? localStorage.getItem('selectedUnitType') as UnitType : 'ward') || 'ward';
  return unitType === 'branch' ? t('terminology.branchPresident') : t('terminology.bishop');
}