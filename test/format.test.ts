import { describe, expect, it } from 'vitest';
import { displayWidth, formatNumber, render } from '../src/format.js';
import type { QueryResult } from '../src/types.js';

const source = {
  name: '国家统计局' as const,
  url: 'https://data.stats.gov.cn/' as const,
  retrievedAt: '2026-11-03T00:00:00.000Z',
};

describe('formatNumber', () => {
  it('adds thousands separators and preserves precision', () => {
    expect(formatNumber('1401879.2')).toBe('1,401,879.2');
    expect(formatNumber('99665')).toBe('99,665');
    expect(formatNumber('-1234.50')).toBe('-1,234.50');
  });

  it('keeps missing markers readable', () => {
    expect(formatNumber('—')).toBe('—');
    expect(formatNumber('')).toBe('—');
  });
});

describe('displayWidth', () => {
  it('counts CJK characters as two columns', () => {
    expect(displayWidth('广东')).toBe(4);
    expect(displayWidth('GDP')).toBe(3);
  });
});

describe('render', () => {
  const result: QueryResult = {
    ok: true,
    action: 'series',
    indicator: {
      id: 'cid:ind',
      name: '国内生产总值',
      displayName: '国内生产总值 (亿元)',
      unit: '亿元',
      frequency: 'year',
      region: '全国',
    },
    points: [
      {
        period: '2025',
        periodName: '2025年',
        value: 1401879.2,
        rawValue: '1401879.2',
        display: '1,401,879.2',
        unit: '亿元',
        region: '全国',
      },
    ],
    source,
  };

  it('renders text with source and without internal ids', () => {
    const text = render(result, 'text');
    expect(text).toContain('国家统计局');
    expect(text).toContain('2025年');
    expect(text).toContain('1,401,879.2 亿元');
    expect(text).toContain('来源：国家统计局');
    expect(text).not.toContain('cid:ind');
  });

  it('renders table and json', () => {
    expect(render(result, 'table')).toContain('时间');
    expect(JSON.parse(render(result, 'json')).points[0].value).toBe(1401879.2);
  });
});
