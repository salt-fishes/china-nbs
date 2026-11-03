import { CURATED } from '../src/curated.js';
import { CITIES, PROVINCES } from '../src/regions.js';
import { EVAL_CASES } from './eval-cases.js';

function countBy<T>(items: T[], key: (item: T) => string): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function printTable(title: string, rows: Array<[string, number]>): void {
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  console.log(`\n${title} (${total})`);
  for (const [name, count] of rows) {
    const pct = total === 0 ? 0 : (count / total) * 100;
    console.log(`  ${name.padEnd(18)} ${String(count).padStart(3)}  ${pct.toFixed(1)}%`);
  }
}

const scopeRows = countBy(CURATED, (entry) => entry.regionScope);
const frequencyRows = countBy(CURATED, (entry) => entry.frequency);
const themeRows = countBy(CURATED, (entry) => entry.key.split('-')[0] ?? 'other');
const evalRows = countBy(EVAL_CASES, (testCase) => testCase.category);
const uniqueIds = new Set(CURATED.map((entry) => `${entry.cid}:${entry.indicId}`));
const sharded = CURATED.filter((entry) => (entry.shards?.length ?? 0) > 0);
const shardCount = sharded.reduce((sum, entry) => sum + (entry.shards?.length ?? 0), 0);

console.log('china-nbs coverage report');
console.log('========================');
console.log(`curated entries: ${CURATED.length}`);
console.log(`unique cid:indicId: ${uniqueIds.size}`);
console.log(`sharded entries: ${sharded.length} (${shardCount} shards)`);
console.log(`provinces: ${PROVINCES.length}`);
console.log(`cities: ${CITIES.length} (+ 4 municipalities as provinces = ${CITIES.length + 4})`);
console.log(`evaluation cases: ${EVAL_CASES.length}`);

printTable('By scope', scopeRows);
printTable('By frequency', frequencyRows);
printTable('By theme (key prefix)', themeRows);
printTable('Eval cases by category', evalRows);

const scoped = new Set(CURATED.map((entry) => `${entry.regionScope}/${entry.frequency}`));
console.log('\nScope × frequency combinations:');
for (const scope of ['national', 'province', 'city']) {
  const periods = ['year', 'quarter', 'month'].filter((period) => scoped.has(`${scope}/${period}`));
  console.log(`  ${scope.padEnd(10)} ${periods.join(', ') || '-'}`);
}
