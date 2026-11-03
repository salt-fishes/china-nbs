import { describe, expect, it } from 'vitest';
import { fetchSeries, parsePeriodCode, resolveRange } from '../src/series.js';
import type { ResolvedIndicator, SeriesPeriod } from '../src/types.js';
import { StaticProvider, seriesFixture } from './helpers.js';

function cpiIndicator(): ResolvedIndicator {
  return {
    cid: '809d2522b0fe4be89142650341b19083',
    indicId: '4ae9047687934a6390984c21d6ddab96',
    name: '居民消费价格指数',
    displayName: '居民消费价格指数 (上年同月=100)',
    unit: '%',
    frequency: 'month',
    region: '全国',
    regionCode: '000000000000',
    measure: '上年同月=100',
    source: 'curated',
    shards: [
      {
        cid: '5c7452825c7c4dcba391db5ca7f335c5',
        indicId: '53180dfb9c14411ba4b762307c85920c',
        startYear: 2026,
      },
      {
        cid: '809d2522b0fe4be89142650341b19083',
        indicId: '4ae9047687934a6390984c21d6ddab96',
        startYear: 2021,
        endYear: 2025,
      },
      {
        cid: '9d4eec43537742a7ab5d63db97fa2f51',
        indicId: 'e5c318ffdbbc4d38898e52b52267eb25',
        startYear: 2016,
        endYear: 2020,
      },
      {
        cid: '954cfd7597e34b919ec71caf6aeead51',
        indicId: '4c1065dd4e984b25a21190c843551697',
        endYear: 2015,
      },
    ],
  };
}

function gdpIndicator(): ResolvedIndicator {
  return {
    cid: 'f7fd25aaad184414875632cf2327da60',
    indicId: '7dc6a2ee6c614960b7059991e0cc4d96',
    name: '国内生产总值',
    displayName: '国内生产总值 (亿元)',
    unit: '亿元',
    frequency: 'year',
    region: '全国',
    regionCode: '000000000000',
    source: 'curated',
  };
}

function provinceCpiIndicator(): ResolvedIndicator {
  return {
    cid: 'c7b31f465b2b4a40b9999090b03b5a37',
    indicId: 'a2713908ee9a4a86a6e1bf90a6c1df68',
    name: '居民消费价格指数',
    displayName: '居民消费价格指数 (上年同月=100)',
    unit: '%',
    frequency: 'month',
    region: '广东省',
    regionCode: '440000000000',
    measure: '上年同月=100',
    source: 'curated',
    shards: [
      {
        cid: 'b5e122302ad745358ba7415bd4a22c2f',
        indicId: '02d75ee002764e2ea53f263e52109e8f',
        startYear: 2026,
      },
      {
        cid: 'c7b31f465b2b4a40b9999090b03b5a37',
        indicId: 'a2713908ee9a4a86a6e1bf90a6c1df68',
        startYear: 2021,
        endYear: 2025,
      },
      {
        cid: 'f6b9c87376ad4b24b170766f419dc076',
        indicId: '072104df94b749dc8d0aa744718ba09b',
        startYear: 2016,
        endYear: 2020,
      },
      {
        cid: 'd699037b6a894b9ea15d662b5422ce16',
        indicId: '1f9acbec2553450fb5b1804b583833c6',
        endYear: 2015,
      },
    ],
  };
}

function provinceQuarterGdpIndicator(): ResolvedIndicator {
  return {
    cid: '44ecf9ea21884caea5451c35e9c08fff',
    indicId: 'dc168397231c49f391ee9e11966de389',
    name: '地区生产总值累计值',
    displayName: '地区生产总值累计值 (亿元)',
    unit: '亿元',
    frequency: 'quarter',
    region: '广东省',
    regionCode: '440000000000',
    measure: '累计值',
    source: 'curated',
  };
}

describe('period helpers', () => {
  it('parses API codes', () => {
    expect(parsePeriodCode('2025YY')).toEqual({ period: '2025', name: '2025年' });
    expect(parsePeriodCode('202603SS')).toEqual({ period: '2026Q3', name: '2026年第3季度' });
    expect(parsePeriodCode('202510MM')).toEqual({ period: '2025-10', name: '2025年10月' });
  });

  it('resolves ranges', () => {
    expect(resolveRange('year', 2015, 2025)).toEqual({ start: 2015, end: 2025 });
    expect(resolveRange('quarter', '2025Q1', '2025Q4')).toEqual({
      start: 2025 * 4,
      end: 2025 * 4 + 3,
    });
    expect(resolveRange('month', '2025-01', '2025-10')).toEqual({
      start: 2025 * 12,
      end: 2025 * 12 + 9,
    });
    expect(() => resolveRange('year', 2026, 2025)).toThrow();
  });
});

describe('fetchSeries', () => {
  it('merges the CPI monthly shard for 2025-01..2025-10', async () => {
    const provider = new StaticProvider();
    provider.series['809d2522b0fe4be89142650341b19083'] = seriesFixture('series-cpi.json');
    const result = await fetchSeries(provider, cpiIndicator(), 'month', {
      start: '2025-01',
      end: '2025-10',
    });
    expect(result.points).toHaveLength(10);
    expect(result.points[0]?.period).toBe('2025-01');
    expect(result.points[0]?.value).toBe(100.5);
    expect(result.points.at(-1)?.period).toBe('2025-10');
    expect(result.points.at(-1)?.value).toBe(100.2);
    expect(result.points[0]?.unit).toBe('%');
    expect(result.partial).toBe(false);
  });

  it('returns annual GDP points', async () => {
    const provider = new StaticProvider();
    provider.series['f7fd25aaad184414875632cf2327da60'] = seriesFixture('series-gdp.json');
    const result = await fetchSeries(provider, gdpIndicator(), 'year', {
      start: 2015,
      end: 2025,
    });
    expect(result.points).toHaveLength(11);
    expect(result.points[0]?.period).toBe('2015');
    expect(result.points.at(-1)?.value).toBe(1401879.2);
  });

  it('caps points and keeps the latest ones', async () => {
    const provider = new StaticProvider();
    provider.series['f7fd25aaad184414875632cf2327da60'] = seriesFixture('series-gdp.json');
    const result = await fetchSeries(provider, gdpIndicator(), 'year', {
      start: 2015,
      end: 2025,
      maxPoints: 5,
    });
    expect(result.points).toHaveLength(5);
    expect(result.points[0]?.period).toBe('2021');
    expect(result.points.at(-1)?.period).toBe('2025');
    expect(result.notes.join(' ')).toContain('最近 5 个');
  });

  it('merges two shards across the 2025/2026 boundary', async () => {
    const provider = new StaticProvider();
    const point = (code: string, name: string, value: string): SeriesPeriod => ({
      code,
      name,
      values: [
        {
          id: 'ind',
          name: '居民消费价格指数',
          showName: '居民消费价格指数 (上年同月=100)',
          unit: '%',
          value,
          region: '000000000000',
          regionName: '全国',
        },
      ],
    });
    const indicator = cpiIndicator();
    indicator.indicId = 'ind';
    provider.series['809d2522b0fe4be89142650341b19083:202512MM'] = [
      point('202512MM', '2025年12月', '100.1'),
    ];
    provider.series['5c7452825c7c4dcba391db5ca7f335c5:202601MM'] = [
      point('202601MM', '2026年1月', '100.2'),
    ];
    const result = await fetchSeries(provider, indicator, 'month', {
      start: '2025-12',
      end: '2026-01',
    });
    expect(result.points.map((item) => item.period)).toEqual(['2025-12', '2026-01']);
    expect(provider.seriesCalls).toEqual(['202512MM', '202601MM']);
  });

  it('returns province quarterly GDP points', async () => {
    const provider = new StaticProvider();
    const point = (code: string, name: string, value: string): SeriesPeriod => ({
      code,
      name,
      values: [
        {
          id: 'dc168397231c49f391ee9e11966de389',
          name: '地区生产总值',
          showName: '地区生产总值累计值 (亿元)',
          unit: '亿元',
          value,
          region: '440000000000',
          regionName: '广东省',
        },
      ],
    });
    provider.series['44ecf9ea21884caea5451c35e9c08fff'] = [
      point('202501SS', '2025年第一季度', '33528'),
      point('202502SS', '2025年第二季度', '68724'),
      point('202503SS', '2025年第三季度', '105171'),
      point('202504SS', '2025年第四季度', '145847'),
      point('202601SS', '2026年第一季度', '34950'),
      point('202602SS', '2026年第二季度', '72281'),
      point('202603SS', '2026年第三季度', '111091'),
    ];
    const result = await fetchSeries(provider, provinceQuarterGdpIndicator(), 'quarter', {
      start: '2025Q1',
      end: '2026Q3',
    });
    expect(result.points).toHaveLength(7);
    expect(result.points[0]?.period).toBe('2025Q1');
    expect(result.points[0]?.value).toBe(33528);
    expect(result.points.at(-1)?.period).toBe('2026Q3');
    expect(result.points.at(-1)?.value).toBe(111091);
    expect(result.points.at(-1)?.region).toBe('广东省');
    expect(result.points.at(-1)?.unit).toBe('亿元');
  });

  it('returns province monthly CPI points from the 2021-2025 shard', async () => {
    const provider = new StaticProvider();
    const values: Array<[string, string, string]> = [
      ['202501MM', '2025年1月', '100.5'],
      ['202502MM', '2025年2月', '98.9'],
      ['202503MM', '2025年3月', '99.5'],
      ['202504MM', '2025年4月', '99.6'],
      ['202505MM', '2025年5月', '99.6'],
      ['202506MM', '2025年6月', '99.6'],
      ['202507MM', '2025年7月', '99.7'],
      ['202508MM', '2025年8月', '99.8'],
      ['202509MM', '2025年9月', '99.9'],
      ['202510MM', '2025年10月', '100.3'],
    ];
    provider.series['c7b31f465b2b4a40b9999090b03b5a37:202501MM-202510MM'] = values.map(
      ([code, name, value]) => ({
        code,
        name,
        values: [
          {
            id: 'a2713908ee9a4a86a6e1bf90a6c1df68',
            name: '居民消费价格指数',
            showName: '居民消费价格指数 (上年同月=100)',
            unit: '%',
            value,
            region: '440000000000',
            regionName: '广东省',
          },
        ],
      }),
    );
    const result = await fetchSeries(provider, provinceCpiIndicator(), 'month', {
      start: '2025-01',
      end: '2025-10',
    });
    expect(result.points).toHaveLength(10);
    expect(result.points[0]?.value).toBe(100.5);
    expect(result.points.at(-1)?.value).toBe(100.3);
    expect(result.points.at(-1)?.region).toBe('广东省');
    expect(provider.seriesCalls).toEqual(['202501MM-202510MM']);
  });

  it('picks the requested indicator when a period contains multiple values', async () => {
    const provider = new StaticProvider();
    provider.series['c7b31f465b2b4a40b9999090b03b5a37:202501MM'] = [
      {
        code: '202501MM',
        name: '2025年1月',
        values: [
          {
            id: 'another-indicator',
            name: '另一指标',
            showName: '另一指标 (%)',
            unit: '%',
            value: '999',
            region: '440000000000',
            regionName: '广东省',
          },
          {
            id: 'a2713908ee9a4a86a6e1bf90a6c1df68',
            name: '居民消费价格指数',
            showName: '居民消费价格指数 (上年同月=100)',
            unit: '%',
            value: '100.5',
            region: '440000000000',
            regionName: '广东省',
          },
        ],
      },
    ];
    const result = await fetchSeries(provider, provinceCpiIndicator(), 'month', {
      start: '2025-01',
      end: '2025-01',
    });
    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.value).toBe(100.5);
  });

  it('returns partial data and a note when one shard fails', async () => {
    const provider = new StaticProvider();
    provider.series['809d2522b0fe4be89142650341b19083:202512MM'] = [
      {
        code: '202512MM',
        name: '2025年12月',
        values: [
          {
            id: 'ind',
            name: '居民消费价格指数',
            showName: '居民消费价格指数 (上年同月=100)',
            unit: '%',
            value: '100.5',
            region: '000000000000',
            regionName: '全国',
          },
        ],
      },
    ];
    const indicator = cpiIndicator();
    indicator.indicId = 'ind';
    const result = await fetchSeries(provider, indicator, 'month', {
      start: '2025-12',
      end: '2026-01',
    });
    expect(result.points).toHaveLength(1);
    expect(result.partial).toBe(true);
    expect(result.notes.length).toBeGreaterThan(0);
  });
});
