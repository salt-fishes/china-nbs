import { CURATED } from '../src/curated.js';
import type { Period } from '../src/types.js';

type Scope = 'national' | 'province' | 'city';
type Cell = `${Scope}:${Period}`;

const TARGETS: Record<string, Cell[]> = {
  GDP: ['national:year', 'national:quarter', 'province:year', 'province:quarter', 'city:year'],
  人口: ['national:year', 'province:year', 'city:year'],
  就业: ['national:year', 'national:month', 'province:year', 'city:year'],
  CPI: ['national:year', 'national:month', 'province:year', 'province:month'],
  PPI: ['national:year', 'national:month', 'province:year', 'province:month'],
  居民收入: ['national:year', 'national:quarter', 'province:year', 'province:quarter', 'city:year'],
  居民消费: ['national:year', 'national:quarter', 'province:year', 'province:quarter', 'city:year'],
  社零: ['national:year', 'national:month', 'province:year', 'province:quarter', 'city:year'],
  固投: ['national:year', 'national:month', 'province:year', 'province:month', 'city:year'],
  房地产: ['national:year', 'national:month', 'province:year', 'province:month', 'city:year'],
  财政: ['national:year', 'national:month', 'province:year', 'province:month', 'city:year'],
  贸易: ['national:year', 'national:month', 'province:year', 'province:month', 'city:year'],
  农业: ['national:year', 'province:year'],
  工业: ['national:year', 'national:month', 'province:year', 'province:month', 'city:year'],
  能源: ['national:year', 'province:year'],
  交通: ['national:year', 'province:year', 'city:year'],
  金融: ['national:year', 'national:month', 'province:year', 'city:year'],
  教育: ['national:year', 'province:year', 'city:year'],
  卫生: ['national:year', 'province:year', 'city:year'],
  环境: ['national:year', 'province:year', 'city:year'],
};

function familyOf(key: string): string | undefined {
  if (key.startsWith('gdp') || key.startsWith('construction')) return 'GDP';
  if (/^(population|birth|death|natural|dependency|child-dependency|old-age-dependency)/.test(key))
    return '人口';
  if (/^(survey|youth|age|registered|big-city|wage|state-wage|urban-unemployment)/.test(key))
    return '就业';
  if (/^cpi/.test(key)) return 'CPI';
  if (/^ppi-(year|month)/.test(key)) return 'PPI';
  if (/^(income|rural-income|urban-income)/.test(key)) return '居民收入';
  if (/^consumption/.test(key)) return '居民消费';
  if (/^(retail|service-retail)/.test(key)) return '社零';
  if (/^(fai|private-fai)/.test(key)) return '固投';
  if (/^(home|real-estate)/.test(key)) return '房地产';
  if (/^(fiscal|tax)/.test(key)) return '财政';
  if (/^(trade|export|import)/.test(key)) return '贸易';
  if (
    /^(grain|summer-grain|agriculture|grain-producer|wheat-producer|rice-producer|corn-producer|pig-producer|vegetable-producer|fruit-producer)/.test(
      key,
    )
  )
    return '农业';
  if (
    /^(industrial|cement|crude-steel|steel-output|auto-output|mobile-phone-output|integrated-circuit|ethylene|nonferrous|generator|microcomputer|notebook|color-tv|refrigerator|air-conditioner|washing-machine|pig-iron|refined-copper|primary-aluminum|alumina|flat-glass|chemical-fiber|chemical-fertilizer|pesticide|capacity|manufacturing)/.test(
      key,
    )
  )
    return '工业';
  if (/^(energy|coal-output|oil-output|electricity|coal-share)/.test(key)) return '能源';
  if (/^(passenger|freight|express|mobile-phone-users|broadband)/.test(key)) return '交通';
  if (/^(m2|m1|deposits|loans)/.test(key)) return '金融';
  if (/^higher-ed/.test(key)) return '教育';
  if (/^health/.test(key)) return '卫生';
  if (/^(water-supply|garbage|afforestation)/.test(key)) return '环境';
  return undefined;
}

function scopeOf(entry: (typeof CURATED)[number]): Scope {
  return entry.regionScope === 'national'
    ? 'national'
    : entry.regionScope === 'province'
      ? 'province'
      : 'city';
}

const counts = new Map<string, Map<string, number>>();
for (const entry of CURATED) {
  const family = familyOf(entry.key);
  if (!family) continue;
  const cell = `${scopeOf(entry)}:${entry.frequency}`;
  const familyCounts = counts.get(family) ?? new Map<string, number>();
  familyCounts.set(cell, (familyCounts.get(cell) ?? 0) + 1);
  counts.set(family, familyCounts);
}

const scopeLabels: Record<Scope, string> = {
  national: '全国',
  province: '分省',
  city: '城市',
};
const periodLabels: Record<Period, string> = { year: '年', quarter: '季', month: '月' };

console.log('常用指标覆盖矩阵');
console.log('================');
console.log('目标：常用指标在可用范围内做到 全国/分省/城市 × 年/季/月 覆盖。');
console.log('数字 = curated 条目数；0 = 目标缺口。\n');

let gaps = 0;
for (const [family, targets] of Object.entries(TARGETS)) {
  const familyCounts = counts.get(family) ?? new Map<string, number>();
  const parts: string[] = [];
  for (const scope of ['national', 'province', 'city'] as const) {
    const cells = targets.filter((target) => target.startsWith(`${scope}:`));
    if (cells.length === 0) continue;
    const values = cells.map((cell) => {
      const period = cell.split(':')[1] as Period;
      const count = familyCounts.get(cell) ?? 0;
      if (count === 0) gaps += 1;
      return `${periodLabels[period]}${count === 0 ? '❌' : count}`;
    });
    parts.push(`${scopeLabels[scope]} ${values.join('/')}`);
  }
  console.log(`${family.padEnd(6, '　')} ${parts.join('  |  ')}`);
}

console.log(`\n目标缺口：${gaps} 个 cell（不是指标个数）`);
if (process.argv.includes('--strict') && gaps > 0) process.exitCode = 1;
