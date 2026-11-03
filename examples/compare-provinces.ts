import { query, render } from '../src/index.js';

const result = await query({
  action: 'compare',
  query: 'GDP',
  regions: ['广东', '江苏', '浙江'],
  period: 'year',
  start: 2025,
  end: 2025,
});

console.log(render(result, 'text'));
