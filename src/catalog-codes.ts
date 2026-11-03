import type { Period } from './types.js';

export type RegionScope = 'national' | 'province' | 'city';

/**
 * NBS public-release catalog codes are a scope × frequency matrix, not a
 * frequency alone. Using code=6 for every province query silently returns
 * annual data only, so keep the mapping in one place.
 *
 * | scope    | month | quarter | year |
 * |----------|-------|---------|------|
 * | national | 1     | 2       | 3    |
 * | province | 4     | 5       | 6    |
 * | city     | —     | —       | 8    |
 */
const CATALOG_CODES: Record<RegionScope, Partial<Record<Period, string>>> = {
  national: { month: '1', quarter: '2', year: '3' },
  province: { month: '4', quarter: '5', year: '6' },
  city: { year: '8' },
};

export function catalogCode(scope: RegionScope, period: Period): string | undefined {
  return CATALOG_CODES[scope][period];
}

export const CATALOG_CODE_LABELS: Record<string, string> = {
  '1': '全国月度',
  '2': '全国季度',
  '3': '全国年度',
  '4': '分省月度',
  '5': '分省季度',
  '6': '分省年度',
  '7': '主要城市月度价格',
  '8': '主要城市年度',
  '9': '港澳台月度',
};
