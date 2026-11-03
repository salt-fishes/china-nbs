import { normalize } from './aliases.js';
import { CITIES as GENERATED_CITIES } from './cities.js';

export interface RegionRecord {
  text: string;
  value: string;
  aliases: string[];
  national?: boolean;
  scope?: 'national' | 'province' | 'city';
}

export const NATIONAL_REGION: RegionRecord = {
  text: '全国',
  value: '000000000000',
  aliases: ['全国', '中国', '国家', '全国合计'],
  national: true,
  scope: 'national',
};

export const PROVINCES: RegionRecord[] = [
  { text: '北京市', value: '110000000000', aliases: ['北京'] },
  { text: '天津市', value: '120000000000', aliases: ['天津'] },
  { text: '河北省', value: '130000000000', aliases: ['河北'] },
  { text: '山西省', value: '140000000000', aliases: ['山西'] },
  { text: '内蒙古自治区', value: '150000000000', aliases: ['内蒙古', '内蒙'] },
  { text: '辽宁省', value: '210000000000', aliases: ['辽宁'] },
  { text: '吉林省', value: '220000000000', aliases: ['吉林'] },
  { text: '黑龙江省', value: '230000000000', aliases: ['黑龙江'] },
  { text: '上海市', value: '310000000000', aliases: ['上海'] },
  { text: '江苏省', value: '320000000000', aliases: ['江苏'] },
  { text: '浙江省', value: '330000000000', aliases: ['浙江'] },
  { text: '安徽省', value: '340000000000', aliases: ['安徽'] },
  { text: '福建省', value: '350000000000', aliases: ['福建'] },
  { text: '江西省', value: '360000000000', aliases: ['江西'] },
  { text: '山东省', value: '370000000000', aliases: ['山东'] },
  { text: '河南省', value: '410000000000', aliases: ['河南'] },
  { text: '湖北省', value: '420000000000', aliases: ['湖北'] },
  { text: '湖南省', value: '430000000000', aliases: ['湖南'] },
  { text: '广东省', value: '440000000000', aliases: ['广东'] },
  { text: '广西壮族自治区', value: '450000000000', aliases: ['广西'] },
  { text: '海南省', value: '460000000000', aliases: ['海南'] },
  { text: '重庆市', value: '500000000000', aliases: ['重庆'] },
  { text: '四川省', value: '510000000000', aliases: ['四川'] },
  { text: '贵州省', value: '520000000000', aliases: ['贵州'] },
  { text: '云南省', value: '530000000000', aliases: ['云南'] },
  { text: '西藏自治区', value: '540000000000', aliases: ['西藏'] },
  { text: '陕西省', value: '610000000000', aliases: ['陕西'] },
  { text: '甘肃省', value: '620000000000', aliases: ['甘肃'] },
  { text: '青海省', value: '630000000000', aliases: ['青海'] },
  { text: '宁夏回族自治区', value: '640000000000', aliases: ['宁夏'] },
  { text: '新疆维吾尔自治区', value: '650000000000', aliases: ['新疆'] },
  { text: '台湾省', value: '710000000000', aliases: ['台湾'] },
  { text: '香港特别行政区', value: '810000000000', aliases: ['香港'] },
  { text: '澳门特别行政区', value: '820000000000', aliases: ['澳门'] },
];

/**
 * Official NBS major-city list: 36 cities. Four municipalities are represented
 * as provinces, so 32 city records are listed here. Values use the 12-digit
 * `das` format, e.g. 广州 440100000000. The upstream city annual dataset does
 * not publish other prefecture-level cities.
 */
export const CITIES: RegionRecord[] = GENERATED_CITIES.map((city) => ({
  text: city.text,
  value: city.value,
  aliases: [...city.aliases],
  scope: 'city',
}));

export const ALL_REGIONS: RegionRecord[] = [NATIONAL_REGION, ...PROVINCES, ...CITIES];

export function scopeOf(region: RegionRecord): 'national' | 'province' | 'city' {
  return region.scope ?? (region.national ? 'national' : 'province');
}

export function regionNames(): string[] {
  return ALL_REGIONS.flatMap((region) => [region.text, ...region.aliases]);
}

/** Resolve a Chinese region name to the NBS `das` value. */
export function resolveRegion(input?: string): RegionRecord | undefined {
  if (!input?.trim()) return NATIONAL_REGION;
  const normalized = normalize(input);

  for (const region of ALL_REGIONS) {
    if (normalize(region.text) === normalized) return region;
    if (region.aliases.some((alias) => normalize(alias) === normalized)) return region;
  }

  // Allow "广东省" vs "广东" and "中国广东省" style inputs.
  const candidates = ALL_REGIONS.filter((region) => {
    const names = [region.text, ...region.aliases].map(normalize);
    return names.some((name) => normalized.includes(name) || name.includes(normalized));
  });

  if (candidates.length === 1) return candidates[0];
  return undefined;
}

export function isNationalRegion(input?: string): boolean {
  return resolveRegion(input)?.national === true;
}

/** Infer a province or major city from free text such as "广东 GDP"; national words are ignored. */
export function inferRegionFromText(text?: string): RegionRecord | undefined {
  if (!text?.trim()) return undefined;
  const normalized = normalize(text);
  const matches = ALL_REGIONS.filter(
    (region) =>
      !region.national &&
      [region.text, ...region.aliases].some((name) => normalized.includes(normalize(name))),
  );
  const city = matches.find((region) => region.scope === 'city');
  if (city) return city;
  return matches.length === 1 ? matches[0] : undefined;
}

export function regionSuggestions(input: string): string[] {
  const normalized = normalize(input);
  return ALL_REGIONS.filter((region) =>
    [region.text, ...region.aliases].some((name) => {
      const candidate = normalize(name);
      return candidate.includes(normalized) || normalized.includes(candidate);
    }),
  )
    .slice(0, 6)
    .map((region) => region.text);
}
