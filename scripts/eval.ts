import { NbsClient } from '../src/client.js';
import { CURATED, findCurated } from '../src/curated.js';
import { NbsProviderImpl } from '../src/nbs-provider.js';
import { resolveRegion } from '../src/regions.js';
import { resolveIndicator } from '../src/resolver.js';
import type { Period } from '../src/types.js';
import { EVAL_CASES, type EvalCase } from './eval-cases.js';

interface Result {
  testCase: EvalCase;
  top1: boolean;
  top3: boolean;
  actual: string;
}

function curatedId(key: string): string | undefined {
  const entry = CURATED.find((item) => item.key === key);
  return entry ? `${entry.cid}:${entry.indicId}` : undefined;
}

function expectedId(testCase: EvalCase): string | undefined {
  if (testCase.expectedKey) return curatedId(testCase.expectedKey);
  return testCase.expectedId;
}

function offline(): Result[] {
  const results: Result[] = [];
  for (const testCase of EVAL_CASES) {
    if (!testCase.expectedKey) continue;
    const entry = findCurated(
      testCase.query,
      testCase.period,
      testCase.scope === 'national'
        ? 'national'
        : testCase.scope === 'province'
          ? 'province'
          : 'city',
    );
    const actual = entry ? `${entry.cid}:${entry.indicId}` : 'NOT_CURATED';
    const expected = curatedId(testCase.expectedKey);
    results.push({
      testCase,
      top1: actual === expected,
      top3: actual === expected,
      actual,
    });
  }
  return results;
}

async function live(): Promise<Result[]> {
  const client = new NbsClient({});
  const provider = new NbsProviderImpl(client);
  const results: Result[] = [];
  for (const testCase of EVAL_CASES) {
    const regionName =
      testCase.scope === 'national' ? '全国' : testCase.scope === 'city' ? '广州' : '广东';
    const region = resolveRegion(regionName);
    if (!region) throw new Error(`Unknown region: ${regionName}`);
    const outcome = await resolveIndicator(
      provider,
      { query: testCase.query },
      testCase.period as Period,
      region,
    );
    const expected = expectedId(testCase);
    if (outcome.kind === 'resolved') {
      const actual = `${outcome.indicator.cid}:${outcome.indicator.indicId}`;
      results.push({
        testCase,
        top1: actual === expected,
        top3: actual === expected,
        actual,
      });
    } else if (outcome.kind === 'ambiguous') {
      const ids = outcome.candidates.map((candidate) => candidate.id);
      results.push({
        testCase,
        top1: false,
        top3: expected !== undefined && ids.includes(expected),
        actual: `AMBIGUOUS(${ids.join(', ')})`,
      });
    } else {
      results.push({
        testCase,
        top1: false,
        top3: false,
        actual: 'NOT_FOUND',
      });
    }
  }
  return results;
}

function summarize(label: string, results: Result[]): number {
  const total = results.length;
  const top1 = results.filter((result) => result.top1).length;
  const top3 = results.filter((result) => result.top3).length;
  console.log(`\n${label}: ${total} cases`);
  console.log(`top-1: ${top1}/${total} (${((top1 / total) * 100).toFixed(1)}%)`);
  console.log(`top-3: ${top3}/${total} (${((top3 / total) * 100).toFixed(1)}%)`);

  const byCategory = new Map<string, Result[]>();
  for (const result of results) {
    const list = byCategory.get(result.testCase.category) ?? [];
    list.push(result);
    byCategory.set(result.testCase.category, list);
  }
  for (const [category, list] of [...byCategory.entries()].sort()) {
    const ok = list.filter((result) => result.top1).length;
    console.log(`  ${category}: ${ok}/${list.length}`);
  }

  const failures = results.filter((result) => !result.top1);
  if (failures.length > 0) {
    console.log('\nfailures:');
    for (const failure of failures) {
      console.log(`  - ${failure.testCase.query} [${failure.testCase.period}]`);
      console.log(`    expected: ${expectedId(failure.testCase) ?? '(none)'}`);
      console.log(`    actual:   ${failure.actual}`);
    }
  }
  return failures.length;
}

const liveMode = process.argv.includes('--live');
const results = liveMode ? await live() : offline();
const failures = summarize(liveMode ? 'live resolver' : 'curated fast path', results);
process.exitCode = failures === 0 ? 0 : 1;
