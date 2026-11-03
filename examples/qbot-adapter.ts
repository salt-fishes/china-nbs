import { query, render } from '../src/index.js';

/**
 * qbot adapter sketch. Register one tool named `stats`.
 *
 * The model turns the user's natural language into these fields; the library
 * only handles structured queries. Always render text for chat output, and
 * surface AMBIGUOUS candidates to the user instead of guessing.
 */
export async function statsTool(args: {
  query: string;
  region?: string;
  period?: 'year' | 'quarter' | 'month';
  start?: string;
  end?: string;
  limit?: number;
}): Promise<string> {
  const result = await query({
    action: 'search',
    query: args.query,
    region: args.region ?? '全国',
    period: args.period,
    start: args.start,
    end: args.end,
    limit: args.limit ?? 5,
  });

  if (!result.ok && result.error?.code === 'AMBIGUOUS') {
    const names = result.candidates?.map(
      (candidate, index) => `${index + 1}. ${candidate.displayName}`,
    );
    return `找到多个可能的指标：\n${names?.join('\n')}\n请回复序号，我再查具体数据。`;
  }

  return render(result, 'text');
}
