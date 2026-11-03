import { query, render } from '../src/index.js';

const result = await query({
  action: 'series',
  query: 'CPI',
  period: 'month',
  start: '2025-01',
  end: '2025-10',
});

console.log(render(result, 'table'));
