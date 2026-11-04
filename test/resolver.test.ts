import { beforeEach, describe, expect, it } from 'vitest';
import { catalogCode } from '../src/catalog-codes.js';
import { resolveRegion } from '../src/regions.js';
import { clearResolverNegativeCache, parseShardLabel, resolveIndicator } from '../src/resolver.js';
import type { SearchRecord } from '../src/types.js';
import { indicator, StaticProvider, searchFixture } from './helpers.js';

function region(name: string) {
  const resolved = resolveRegion(name);
  if (!resolved) throw new Error(`Unknown region: ${name}`);
  return resolved;
}

const national = region('全国');
const guangdong = region('广东');
const guangzhou = region('广州');

function record(overrides: Partial<SearchRecord>): SearchRecord {
  return {
    cid: 'cid',
    indicId: 'ind',
    name: '国内生产总值',
    showName: '国内生产总值 (亿元)',
    unit: '亿元',
    frequency: 'year',
    dt: '2025',
    dtName: '2025年',
    region: '全国',
    regionCode: '000000000000',
    value: '1401879.2',
    typeValue: '3',
    ...overrides,
  };
}

describe('resolveIndicator', () => {
  beforeEach(() => clearResolverNegativeCache());

  it('uses the curated fast path for national GDP', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(provider, { query: '2025年GDP' }, 'year', national);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.source).toBe('curated');
    expect(outcome.indicator.cid).toBe('f7fd25aaad184414875632cf2327da60');
    expect(outcome.indicator.displayName).toContain('国内生产总值');
    expect(provider.searchCalls).toBe(0);
  });

  it('uses the province curated entry for 广东 GDP', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(provider, { query: '广东 GDP' }, 'year', guangdong);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.cid).toBe('6f8fbd415cbc40ffa7ecb7fd917f2598');
    expect(outcome.indicator.region).toBe('广东省');
    expect(outcome.indicator.regionCode).toBe('440000000000');
  });

  it('uses the province curated entry for quarterly GDP', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(provider, { query: 'GDP' }, 'quarter', guangdong);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.source).toBe('curated');
    expect(outcome.indicator.cid).toBe('44ecf9ea21884caea5451c35e9c08fff');
    expect(outcome.indicator.indicId).toBe('dc168397231c49f391ee9e11966de389');
    expect(outcome.indicator.frequency).toBe('quarter');
    expect(outcome.indicator.measure).toBe('累计值');
  });

  it('uses the province curated shards for monthly CPI', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(provider, { query: '广东CPI' }, 'month', guangdong);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.source).toBe('curated');
    expect(outcome.indicator.cid).toBe('c7b31f465b2b4a40b9999090b03b5a37');
    expect(outcome.indicator.shards?.length).toBe(4);
    expect(outcome.indicator.shards?.[0]?.startYear).toBe(2026);
    expect(outcome.indicator.shards?.[1]?.startYear).toBe(2021);
  });

  it('maps national, province and city scopes to different catalog codes', () => {
    expect(catalogCode('national', 'month')).toBe('1');
    expect(catalogCode('national', 'quarter')).toBe('2');
    expect(catalogCode('national', 'year')).toBe('3');
    expect(catalogCode('province', 'month')).toBe('4');
    expect(catalogCode('province', 'quarter')).toBe('5');
    expect(catalogCode('province', 'year')).toBe('6');
    expect(catalogCode('city', 'month')).toBeUndefined();
    expect(catalogCode('city', 'year')).toBe('8');
    expect(catalogCode('city', 'quarter')).toBeUndefined();
  });

  it('uses the curated fast path for city GDP', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(provider, { query: '广州GDP' }, 'year', guangzhou);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.source).toBe('curated');
    expect(outcome.indicator.cid).toBe('75a85abe58c749e0ad1d85be343e9056');
    expect(outcome.indicator.indicId).toBe('35613910b9ad47e19cf79ae041ccb7ed');
    expect(outcome.indicator.region).toBe('广州市');
    expect(outcome.indicator.regionCode).toBe('440100000000');
  });

  it('resolves a non-curated city indicator through the code=8 tree', async () => {
    const provider = new StaticProvider();
    provider.tree['8:'] = [{ id: 'root', name: '主要城市年度数据', level: 3, isLeaf: false }];
    provider.tree['8:root'] = [
      { id: 'city-pop', name: '人口和就业', level: 4, isLeaf: true, parentId: 'root' },
    ];
    provider.indicators['city-pop'] = [
      indicator('city-pop-ind', 'city-pop', '年末总人口', '年末总人口 (万人)', '万人'),
    ];
    const outcome = await resolveIndicator(provider, { query: '广州人口' }, 'year', guangzhou);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.source).toBe('tree');
    expect(outcome.indicator.cid).toBe('city-pop');
    expect(outcome.indicator.region).toBe('广州市');
  });

  it('rejects city quarterly data with a clear error', async () => {
    const provider = new StaticProvider();
    await expect(
      resolveIndicator(provider, { query: '广州GDP' }, 'quarter', guangzhou),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_ACTION' });
  });

  it('selects the monthly CPI shard set', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(provider, { query: 'CPI同比' }, 'month', national);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.source).toBe('curated');
    expect(outcome.indicator.shards?.length).toBe(4);
    expect(outcome.indicator.measure).toContain('上年同月=100');
  });

  it('selects the annual CPI entry for period=year', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(provider, { query: 'CPI' }, 'year', national);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.unit).toBe('上年=100');
  });

  it('resolves PPI through the curated entry', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(provider, { query: 'PPI' }, 'year', national);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.name).toContain('工业生产者出厂价格指数');
  });

  it('resolves population through the curated entry', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(provider, { query: '人口' }, 'year', national);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.unit).toBe('万人');
  });

  it('uses the curated GDP index entry when the query adds a measure', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(provider, { query: 'GDP指数' }, 'year', national);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.source).toBe('curated');
    expect(outcome.indicator.name).toContain('指数');
    expect(outcome.indicator.displayName).toContain('上年=100');
  });

  it('falls through to search for a non-curated GDP measure', async () => {
    const provider = new StaticProvider();
    provider.searchResult = searchFixture('search-gdp.json');
    const outcome = await resolveIndicator(
      provider,
      { query: '资本形成总额对国内生产总值增长贡献率' },
      'year',
      national,
    );
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.source).toBe('search');
    expect(outcome.indicator.name).toContain('贡献率');
  });

  it('falls back to the catalog tree when search has no usable result', async () => {
    const provider = new StaticProvider();
    provider.tree['3:'] = [{ id: 'root', name: '年度数据', level: 2, isLeaf: false }];
    provider.tree['3:root'] = [
      { id: 'gdp-cat', name: '国内生产总值', level: 3, isLeaf: true, parentId: 'root' },
    ];
    provider.indicators['gdp-cat'] = [
      indicator('gdp-ind', 'gdp-cat', '国内生产总值贡献率', '国内生产总值贡献率 (%)', '%'),
    ];
    const outcome = await resolveIndicator(provider, { query: 'GDP贡献率' }, 'year', national);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.source).toBe('tree');
    expect(outcome.indicator.cid).toBe('gdp-cat');
  });

  it('honours a candidate selection id', async () => {
    const provider = new StaticProvider();
    provider.indicators['cid-1'] = [
      indicator('ind-1', 'cid-1', '国内生产总值', '国内生产总值 (亿元)', '亿元'),
    ];
    const outcome = await resolveIndicator(
      provider,
      { query: 'GDP', indicatorId: 'cid-1:ind-1' },
      'year',
      national,
    );
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.source).toBe('selection');
    expect(outcome.indicator.indicId).toBe('ind-1');
  });

  it('returns candidates when two records are indistinguishable', async () => {
    const provider = new StaticProvider();
    provider.searchResult = {
      records: [
        record({ cid: 'a', indicId: '1', name: '人口数', showName: '人口数 (人)', unit: '人' }),
        record({ cid: 'b', indicId: '2', name: '人口数', showName: '人口数 (人)', unit: '人' }),
      ],
      count: 2,
    };
    const outcome = await resolveIndicator(provider, { query: '人口数' }, 'year', national);
    expect(outcome.kind).toBe('ambiguous');
    if (outcome.kind !== 'ambiguous') return;
    expect(outcome.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('returns suggestions when nothing matches', async () => {
    const provider = new StaticProvider();
    const outcome = await resolveIndicator(
      provider,
      { query: '不存在的指标xyz' },
      'year',
      national,
    );
    expect(outcome.kind).toBe('notFound');
  });

  it('discovers sibling year ranges as shards for tree-resolved series', async () => {
    const provider = new StaticProvider();
    provider.tree['3:'] = [{ id: 'price', name: '价格指数', level: 1, isLeaf: false }];
    provider.tree['3:price'] = [
      {
        id: 'cid-new',
        name: '居民消费价格分类指数 (上年=100) (2021-)',
        level: 2,
        isLeaf: true,
        parentId: 'price',
      },
      {
        id: 'cid-mid',
        name: '居民消费价格分类指数 (上年=100) (2016-2020)',
        level: 2,
        isLeaf: true,
        parentId: 'price',
      },
      {
        id: 'cid-old',
        name: '居民消费价格分类指数 (上年=100) (-2015)',
        level: 2,
        isLeaf: true,
        parentId: 'price',
      },
    ];
    const showName = '居民消费价格指数 (上年=100)';
    for (const [cid, id] of [
      ['cid-new', 'ind-new'],
      ['cid-mid', 'ind-mid'],
      ['cid-old', 'ind-old'],
    ] as const) {
      provider.indicators[cid] = [indicator(id, cid, '居民消费价格指数', showName)];
    }

    const outcome = await resolveIndicator(
      provider,
      { query: '居民消费价格分类指数' },
      'year',
      national,
    );
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.indicator.cid).toBe('cid-new');
    expect(outcome.indicator.shards?.map((shard) => shard.cid)).toEqual([
      'cid-old',
      'cid-mid',
      'cid-new',
    ]);
    expect(outcome.indicator.shards?.map((shard) => shard.startYear)).toEqual([
      undefined,
      2016,
      2021,
    ]);
  });
});

describe('parseShardLabel', () => {
  it('parses open, closed and left-open ranges', () => {
    expect(parseShardLabel('居民消费价格分类指数 (2021-)')).toEqual({
      base: '居民消费价格分类指数',
      startYear: 2021,
    });
    expect(parseShardLabel('居民消费价格分类指数 (2016-2020)')).toEqual({
      base: '居民消费价格分类指数',
      startYear: 2016,
      endYear: 2020,
    });
    expect(parseShardLabel('居民消费价格分类指数 (-2015)')).toEqual({
      base: '居民消费价格分类指数',
      endYear: 2015,
    });
  });

  it('ignores names without a trailing range', () => {
    expect(parseShardLabel('居民消费价格分类指数 (上年=100)')).toBeUndefined();
    expect(parseShardLabel('普通指标')).toBeUndefined();
  });
});
