import assert from 'node:assert/strict';
import { query } from '../src/index.js';

async function main() {
  console.log('1/8 search GDP');
  const search = await query({ action: 'search', query: 'GDP', period: 'year', limit: 3 });
  assert.equal(search.ok, true, search.error?.message);
  assert.ok((search.points?.length ?? 0) > 0, 'expected GDP points');
  assert.ok(
    search.points?.every((point) => point.value !== null),
    'expected non-null search points',
  );
  assert.equal(search.source.name, '国家统计局');

  console.log('2/8 series GDP 2020-2025');
  const gdp = await query({
    action: 'series',
    query: 'GDP',
    period: 'year',
    start: 2020,
    end: 2025,
  });
  assert.equal(gdp.ok, true, gdp.error?.message);
  assert.equal(gdp.points?.length, 6, 'expected 6 annual GDP points');
  assert.ok((gdp.points?.at(-1)?.value ?? 0) > 0, 'expected a positive 2025 GDP');

  console.log('3/8 series CPI 2025-01..2025-10');
  const cpi = await query({
    action: 'series',
    query: 'CPI',
    period: 'month',
    start: '2025-01',
    end: '2025-10',
  });
  assert.equal(cpi.ok, true, cpi.error?.message);
  assert.equal(cpi.points?.length, 10, 'expected 10 monthly CPI points');
  assert.ok(
    cpi.points?.every((point) => point.value !== null),
    'expected non-null CPI points',
  );

  console.log('4/8 series 广东 GDP 2025Q1..2026Q3');
  const provinceGdp = await query({
    action: 'series',
    query: 'GDP',
    region: '广东',
    period: 'quarter',
    start: '2025Q1',
    end: '2026Q3',
  });
  assert.equal(provinceGdp.ok, true, provinceGdp.error?.message);
  assert.equal(provinceGdp.points?.length, 7, 'expected 7 province quarterly GDP points');
  assert.equal(provinceGdp.indicator?.region, '广东省');
  assert.ok((provinceGdp.points?.at(-1)?.value ?? 0) > 0);

  console.log('5/8 series 广东 CPI 2025-01..2025-10');
  const provinceCpi = await query({
    action: 'series',
    query: 'CPI',
    region: '广东',
    period: 'month',
    start: '2025-01',
    end: '2025-10',
  });
  assert.equal(provinceCpi.ok, true, provinceCpi.error?.message);
  assert.equal(provinceCpi.points?.length, 10, 'expected 10 province monthly CPI points');
  assert.equal(provinceCpi.indicator?.region, '广东省');
  assert.ok(
    provinceCpi.points?.every((point) => point.value !== null),
    'expected non-null province CPI points',
  );

  console.log('6/8 compare 广东/江苏/浙江 GDP 2025Q1..2025Q4');
  const compare = await query({
    action: 'compare',
    query: 'GDP',
    regions: ['广东', '江苏', '浙江'],
    period: 'quarter',
    start: '2025Q1',
    end: '2025Q4',
  });
  assert.equal(compare.ok, true, compare.error?.message);
  assert.equal(compare.series?.length, 3, 'expected three province series');
  assert.ok(compare.series?.every((series) => series.points.length === 4));

  console.log('7/8 catalog code=3 depth=1');
  const catalog = await query({ action: 'catalog', code: '3', depth: 1 });
  assert.equal(catalog.ok, true, catalog.error?.message);
  assert.ok((catalog.nodes?.length ?? 0) > 0, 'expected catalog nodes');

  console.log('8/8 catalog code=4 depth=1');
  const provinceCatalog = await query({ action: 'catalog', code: '4', depth: 1 });
  assert.equal(provinceCatalog.ok, true, provinceCatalog.error?.message);
  assert.equal(provinceCatalog.nodes?.[0]?.name, '分省月度数据');

  console.log('extra: 广州 GDP 2023-2024');
  const cityGdp = await query({
    action: 'series',
    query: '广州GDP',
    period: 'year',
    start: 2023,
    end: 2024,
  });
  assert.equal(cityGdp.ok, true, cityGdp.error?.message);
  assert.equal(cityGdp.points?.length, 2, 'expected 2 city GDP points');
  assert.equal(cityGdp.indicator?.region, '广州市');

  console.log('extra: 全国居民人均消费支出 2020-2025');
  const consumption = await query({
    action: 'series',
    query: '居民人均消费支出',
    period: 'year',
    start: 2020,
    end: 2025,
  });
  assert.equal(consumption.ok, true, consumption.error?.message);
  assert.equal(consumption.points?.length, 6, 'expected 6 consumption points');

  console.log('smoke ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
