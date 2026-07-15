// Display formatting for institution_tier, shared by the school and conference
// pages. The raw enum values ('ncaa_d1') don't survive the usual
// `s.replace(/_/g, ' ')` + title-case trick -- that yields "Ncaa D1" -- so the
// labels are an explicit map.

import type { InstitutionTier } from './api';

const TIER_LABELS: Record<InstitutionTier, string> = {
  ncaa_d1: 'NCAA D1',
  ncaa_d2: 'NCAA D2',
  ncaa_d3: 'NCAA D3',
  naia: 'NAIA',
  juco: 'JUCO',
  high_school: 'High school',
  unclassified: 'Unclassified',
};

// Falls back to the raw value so a tier added to the DB enum before this map is
// updated still renders something legible instead of blank.
export function tierLabel(tier: InstitutionTier | null | undefined): string {
  if (!tier) return '';
  return TIER_LABELS[tier] ?? tier;
}

// Gender tokens are 'mens' | 'womens' | 'coed' (CHECK-constrained server-side),
// null on hand-made rows that predate the college import.
export function genderLabel(gender: string | null | undefined): string {
  if (!gender) return '';
  if (gender === 'mens') return "Men's";
  if (gender === 'womens') return "Women's";
  if (gender === 'coed') return 'Coed';
  return gender;
}
