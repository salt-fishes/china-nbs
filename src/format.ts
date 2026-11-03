import type { DataPoint, Format, QueryResult } from './types.js';

const EMPTY_VALUES = new Set(['', '—', '--', '-', 'null', 'None', 'nan', 'NaN']);

/** Preserve the raw precision while adding thousands separators to the integer part. */
export function formatNumber(raw: string): string {
  const text = raw.trim();
  if (EMPTY_VALUES.has(text)) return '—';
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return text;
  const sign = match[1] ?? '';
  const integer = match[2] ?? '';
  const decimal = match[3];
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${decimal === undefined ? '' : `.${decimal}`}`;
}

/** Display width for terminal alignment; CJK characters count as 2 columns. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x20000 && code <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const current = displayWidth(text);
  const gap = Math.max(0, width - current);
  return align === 'right' ? `${' '.repeat(gap)}${text}` : `${text}${' '.repeat(gap)}`;
}

function renderPoints(points: DataPoint[], region?: string): string[] {
  return points.map((point) => {
    const where = point.region ?? region ?? '';
    const unit = point.unit ? ` ${point.unit}` : '';
    return `${point.periodName}${where ? ` ${where}` : ''}：${point.display}${unit}`;
  });
}

function renderText(result: QueryResult): string {
  const lines: string[] = [];
  const source = result.source;

  if (!result.ok) {
    lines.push(`查询失败：${result.error?.message ?? '未知错误'}`);
    if (result.error?.hint) lines.push(`提示：${result.error.hint}`);
    if (result.candidates && result.candidates.length > 0) {
      lines.push('候选指标：');
      result.candidates.forEach((candidate, index) => {
        const unit = candidate.unit ? ` (${candidate.unit})` : '';
        lines.push(`  ${index + 1}. ${candidate.displayName || candidate.name}${unit}`);
      });
      lines.push('用 --json 查看候选 id，或加 --select <序号> 重新查询。');
    }
    return lines.join('\n');
  }

  if (result.action === 'catalog') {
    lines.push('国家统计局 · 分类树');
    for (const node of result.nodes ?? []) {
      lines.push(
        `${'  '.repeat(Math.max(0, node.level - 1))}- ${node.name}${node.isLeaf ? '' : ' /'}`,
      );
    }
    if (result.notes?.length) lines.push(...result.notes.map((note) => `注：${note}`));
    lines.push(`来源：${source.name}（data.stats.gov.cn）`);
    return lines.join('\n');
  }

  if (result.action === 'compare' && result.series?.length) {
    lines.push(
      `国家统计局 · ${result.indicator?.displayName ?? result.indicator?.name ?? '地区对比'}`,
    );
    for (const series of result.series) {
      lines.push('');
      lines.push(`${series.region}：`);
      lines.push(...renderPoints(series.points, series.region));
    }
    if (result.notes?.length) lines.push(...result.notes.map((note) => `注：${note}`));
    lines.push('');
    lines.push(`来源：${source.name}（data.stats.gov.cn）`);
    return lines.join('\n');
  }

  const title = result.indicator?.displayName ?? result.indicator?.name ?? '查询结果';
  lines.push(`国家统计局 · ${title}`);
  if (result.points?.length) {
    lines.push(...renderPoints(result.points));
  } else {
    lines.push('没有找到数据。');
  }
  if (result.notes?.length) lines.push(...result.notes.map((note) => `注：${note}`));
  lines.push(`来源：${source.name}（data.stats.gov.cn）`);
  lines.push(`获取时间：${source.retrievedAt}`);
  return lines.join('\n');
}

function renderTable(result: QueryResult): string {
  const rows: DataPoint[] = [];
  if (result.action === 'compare' && result.series?.length) {
    for (const series of result.series) rows.push(...series.points);
  } else {
    rows.push(...(result.points ?? []));
  }

  if (rows.length === 0) return renderText(result);

  const headers = ['时间', '地区', '数值', '单位'];
  const table = rows.map((point) => [
    point.periodName || point.period,
    point.region ?? '',
    point.display,
    point.unit ?? '',
  ]);
  const widths = headers.map((header, index) =>
    Math.max(displayWidth(header), ...table.map((row) => displayWidth(row[index] ?? ''))),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => pad(cell, widths[index] ?? 0, index === 2 ? 'right' : 'left'))
      .join('  ');
  const separator = widths.map((width) => '─'.repeat(width)).join('  ');

  return [
    line(headers),
    separator,
    ...table.map((row) => line(row)),
    '',
    `来源：${result.source.name}（data.stats.gov.cn）`,
  ].join('\n');
}

/** Render a QueryResult. The core query() always returns structured data. */
export function render(result: QueryResult, format: Format = 'text'): string {
  if (format === 'json') return JSON.stringify(result, null, 2);
  if (format === 'table') return renderTable(result);
  return renderText(result);
}
