import { describe, expect, it } from 'vitest';
import { queryWithProvider } from '../src/index.js';
import type { SearchRecord } from '../src/types.js';
import { StaticProvider, seriesFixture } from './helpers.js';

function providerWithGdp(): StaticProvider {
  const provider = new StaticProvider();
  provider.series['f7fd25aaad184414875632cf2327da60'] = seriesFixture('series-gdp.json');
  return provider;
}

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

describe('queryWithProvider', () => {
  it('runs a series query', async () => {
    const result = await queryWithProvider(providerWithGdp(), {
      action: 'series',
      query: 'GDP',
      period: 'year',
      start: 2015,
      end: 2025,
    });
    expect(result.ok).toBe(true);
    expect(result.action).toBe('series');
    expect(result.points).toHaveLength(11);
    expect(result.points?.at(-1)?.value).toBe(1401879.2);
    expect(result.indicator?.displayName).toContain('国内生产总值');
  });

  it('runs a search query with the latest non-null points', async () => {
    const provider = providerWithGdp();
    provider.series['f7fd25aaad184414875632cf2327da60'] = [
      ...seriesFixture('series-gdp.json'),
      {
        code: '2026YY',
        name: '2026年',
        values: [
          {
            id: '7dc6a2ee6c614960b7059991e0cc4d96',
            name: '国内生产总值',
            showName: '国内生产总值 (亿元)',
            unit: '亿元',
            value: '',
            region: '000000000000',
            regionName: '全国',
          },
        ],
      },
    ];
    const result = await queryWithProvider(provider, {
      action: 'search',
      query: 'GDP',
      period: 'year',
      limit: 3,
    });
    expect(result.ok).toBe(true);
    expect(result.points).toHaveLength(3);
    expect(result.points?.every((point) => point.value !== null)).toBe(true);
    expect(result.points?.at(-1)?.period).toBe('2025');
  });

  it('runs a compare query', async () => {
    const provider = providerWithGdp();
    provider.series['6f8fbd415cbc40ffa7ecb7fd917f2598'] = [
      {
        code: '2025YY',
        name: '2025年',
        values: [
          {
            id: 'aff57de5ee994283974705914fbed246',
            name: '国内生产总值',
            showName: '地区生产总值 (亿元)',
            unit: '亿元',
            value: '145846.8',
            region: '440000000000',
            regionName: '广东省',
          },
        ],
      },
    ];
    const result = await queryWithProvider(provider, {
      action: 'compare',
      query: 'GDP',
      regions: ['广东', '江苏', '浙江'],
      period: 'year',
      start: 2025,
      end: 2025,
    });
    expect(result.ok).toBe(true);
    expect(result.series).toHaveLength(3);
    expect(result.series?.every((series) => series.points.length === 1)).toBe(true);
  });

  it('runs a province quarterly series', async () => {
    const provider = new StaticProvider();
    provider.series['44ecf9ea21884caea5451c35e9c08fff:440000000000'] = [
      {
        code: '202501SS',
        name: '2025年第一季度',
        values: [
          {
            id: 'dc168397231c49f391ee9e11966de389',
            name: '地区生产总值',
            showName: '地区生产总值累计值 (亿元)',
            unit: '亿元',
            value: '33528',
            region: '440000000000',
            regionName: '广东省',
          },
        ],
      },
      {
        code: '202502SS',
        name: '2025年第二季度',
        values: [
          {
            id: 'dc168397231c49f391ee9e11966de389',
            name: '地区生产总值',
            showName: '地区生产总值累计值 (亿元)',
            unit: '亿元',
            value: '68724',
            region: '440000000000',
            regionName: '广东省',
          },
        ],
      },
    ];
    const result = await queryWithProvider(provider, {
      action: 'series',
      query: 'GDP',
      region: '广东',
      period: 'quarter',
      start: '2025Q1',
      end: '2025Q2',
    });
    expect(result.ok).toBe(true);
    expect(result.indicator?.displayName).toContain('地区生产总值累计值');
    expect(result.indicator?.region).toBe('广东省');
    expect(result.points).toHaveLength(2);
    expect(result.points?.at(-1)?.value).toBe(68724);
  });

  it('runs a province quarterly compare', async () => {
    const provider = new StaticProvider();
    const values: Record<string, [string, string]> = {
      '440000000000': ['广东省', '145847'],
      '320000000000': ['江苏省', '142351'],
      '330000000000': ['浙江省', '94545'],
    };
    for (const [code, [name, value]] of Object.entries(values)) {
      provider.series[`44ecf9ea21884caea5451c35e9c08fff:${code}`] = [
        {
          code: '202504SS',
          name: '2025年第四季度',
          values: [
            {
              id: 'dc168397231c49f391ee9e11966de389',
              name: '地区生产总值',
              showName: '地区生产总值累计值 (亿元)',
              unit: '亿元',
              value,
              region: code,
              regionName: name,
            },
          ],
        },
      ];
    }
    const result = await queryWithProvider(provider, {
      action: 'compare',
      query: 'GDP',
      regions: ['广东', '江苏', '浙江'],
      period: 'quarter',
      start: '2025Q4',
      end: '2025Q4',
    });
    expect(result.ok).toBe(true);
    expect(result.series).toHaveLength(3);
    expect(result.series?.map((series) => series.points[0]?.value)).toEqual([
      145847, 142351, 94545,
    ]);
  });

  it('runs a province monthly CPI compare', async () => {
    const provider = new StaticProvider();
    const values: Record<string, [string, string]> = {
      '440000000000': ['广东省', '100.3'],
      '320000000000': ['江苏省', '100.1'],
      '330000000000': ['浙江省', '100.4'],
    };
    for (const [code, [name, value]] of Object.entries(values)) {
      provider.series[`c7b31f465b2b4a40b9999090b03b5a37:${code}`] = [
        {
          code: '202510MM',
          name: '2025年10月',
          values: [
            {
              id: 'a2713908ee9a4a86a6e1bf90a6c1df68',
              name: '居民消费价格指数',
              showName: '居民消费价格指数 (上年同月=100)',
              unit: '%',
              value,
              region: code,
              regionName: name,
            },
          ],
        },
      ];
    }
    const result = await queryWithProvider(provider, {
      action: 'compare',
      query: 'CPI',
      regions: ['广东', '江苏', '浙江'],
      period: 'month',
      start: '2025-10',
      end: '2025-10',
    });
    expect(result.ok).toBe(true);
    expect(result.series).toHaveLength(3);
    expect(result.series?.map((series) => series.points[0]?.value)).toEqual([100.3, 100.1, 100.4]);
  });

  it('expands a province monthly catalog tree', async () => {
    const provider = new StaticProvider();
    provider.tree['4:'] = [{ id: 'root', name: '分省月度数据', level: 3, isLeaf: false }];
    provider.tree['4:root'] = [
      { id: 'price', name: '价格指数', level: 4, isLeaf: false, parentId: 'root' },
    ];
    const result = await queryWithProvider(provider, {
      action: 'catalog',
      code: '4',
      depth: 2,
    });
    expect(result.ok).toBe(true);
    expect(result.nodes?.map((node) => node.name)).toEqual(['分省月度数据', '价格指数']);
  });

  it('runs a city annual series through code=8', async () => {
    const provider = new StaticProvider();
    provider.series['75a85abe58c749e0ad1d85be343e9056:440100000000'] = [
      {
        code: '2025YY',
        name: '2025年',
        values: [
          {
            id: '35613910b9ad47e19cf79ae041ccb7ed',
            name: '地区生产总值',
            showName: '地区生产总值 (当年价格) (亿元)',
            unit: '亿元',
            value: '31032.5',
            region: '440100000000',
            regionName: '广州市',
          },
        ],
      },
    ];
    const result = await queryWithProvider(provider, {
      action: 'series',
      query: '广州GDP',
      period: 'year',
      start: 2025,
      end: 2025,
    });
    expect(result.ok).toBe(true);
    expect(result.indicator?.region).toBe('广州市');
    expect(result.points).toHaveLength(1);
    expect(result.points?.[0]?.value).toBe(31032.5);
  });

  it('runs a city compare through code=8', async () => {
    const provider = new StaticProvider();
    for (const [code, name, value] of [
      ['440100000000', '广州市', '31032.5'],
      ['440300000000', '深圳市', '34606.4'],
    ] as const) {
      provider.series[`75a85abe58c749e0ad1d85be343e9056:${code}`] = [
        {
          code: '2025YY',
          name: '2025年',
          values: [
            {
              id: '35613910b9ad47e19cf79ae041ccb7ed',
              name: '地区生产总值',
              showName: '地区生产总值 (当年价格) (亿元)',
              unit: '亿元',
              value,
              region: code,
              regionName: name,
            },
          ],
        },
      ];
    }
    const result = await queryWithProvider(provider, {
      action: 'compare',
      query: 'GDP',
      regions: ['广州', '深圳'],
      period: 'year',
      start: 2025,
      end: 2025,
    });
    expect(result.ok).toBe(true);
    expect(result.series).toHaveLength(2);
    expect(result.series?.map((series) => series.region)).toEqual(['广州市', '深圳市']);
  });

  it('infers a province from the query text', async () => {
    const provider = new StaticProvider();
    provider.series['6f8fbd415cbc40ffa7ecb7fd917f2598'] = [
      {
        code: '2025YY',
        name: '2025年',
        values: [
          {
            id: 'aff57de5ee994283974705914fbed246',
            name: '国内生产总值',
            showName: '地区生产总值 (亿元)',
            unit: '亿元',
            value: '145846.8',
            region: '440000000000',
            regionName: '广东省',
          },
        ],
      },
    ];
    const result = await queryWithProvider(provider, {
      action: 'search',
      query: '广东GDP',
      period: 'year',
      limit: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.indicator?.region).toBe('广东省');
  });

  it('expands a catalog tree', async () => {
    const provider = new StaticProvider();
    provider.tree['3:'] = [{ id: 'root', name: '年度数据', level: 2, isLeaf: false }];
    provider.tree['3:root'] = [
      { id: 'gdp', name: '国民经济核算', level: 3, isLeaf: false, parentId: 'root' },
    ];
    const result = await queryWithProvider(provider, {
      action: 'catalog',
      code: '3',
      depth: 2,
    });
    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes?.[1]?.name).toBe('国民经济核算');
  });

  it('returns AMBIGUOUS with candidates', async () => {
    const provider = new StaticProvider();
    provider.searchResult = {
      records: [
        record({ cid: 'a', indicId: '1', name: '人口数', showName: '人口数 (人)', unit: '人' }),
        record({ cid: 'b', indicId: '2', name: '人口数', showName: '人口数 (人)', unit: '人' }),
      ],
      count: 2,
    };
    const result = await queryWithProvider(provider, {
      action: 'search',
      query: '人口数',
      period: 'year',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('AMBIGUOUS');
    expect(result.candidates?.length).toBe(2);
  });

  it('returns NOT_FOUND with suggestions', async () => {
    const result = await queryWithProvider(new StaticProvider(), {
      action: 'search',
      query: '完全不存在xyz',
      period: 'year',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(result.error?.details).toHaveProperty('suggestions');
  });

  it('rejects an invalid catalog code', async () => {
    const result = await queryWithProvider(new StaticProvider(), {
      action: 'catalog',
      code: '99',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_ARGUMENT');
  });
});
