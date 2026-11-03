import { query, render } from '../src/index.js';

const result = await query({
  action: 'search',
  query: 'GDP',
  period: 'year',
  region: '全国',
  limit: 5,
});

console.log(render(result, 'text'));
