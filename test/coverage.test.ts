import { describe, expect, it } from 'vitest';
import { EVAL_CASES } from '../scripts/eval-cases.js';
import { CURATED, findCurated } from '../src/curated.js';

describe('coverage evaluation set', () => {
  it('resolves every curated case through the fast path', () => {
    const failures: string[] = [];
    for (const testCase of EVAL_CASES) {
      if (!testCase.expectedKey) continue;
      const entry = findCurated(testCase.query, testCase.period, testCase.scope);
      if (entry?.key !== testCase.expectedKey) {
        failures.push(
          `${testCase.query} [${testCase.period}/${testCase.scope}] -> ${entry?.key ?? 'NOT_CURATED'} (expected ${testCase.expectedKey})`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps the evaluation set broad and the curated keys unique', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(70);
    expect(EVAL_CASES.every((testCase) => testCase.expectedKey || testCase.expectedId)).toBe(true);
    const keys = CURATED.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
