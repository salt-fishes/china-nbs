#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { query as defaultQuery } from './index.js';
import type { QueryOptions, QueryResult } from './types.js';

const VERSION = '0.5.0';

export type QueryFn = (options: QueryOptions) => Promise<QueryResult>;

const region = z.string().optional().describe('地区名称，如 全国、广东、广州；默认全国');
const period = z
  .enum(['year', 'quarter', 'month'])
  .optional()
  .describe('数据频率；不填则根据 start/end/关键词推断');
const start = z
  .union([z.string(), z.number()])
  .optional()
  .describe('起始时间，如 2015、2025Q1、2025-01');
const end = z
  .union([z.string(), z.number()])
  .optional()
  .describe('结束时间，如 2025、2025Q4、2025-10');
const indicatorId = z
  .string()
  .optional()
  .describe('候选指标的 cid:indicId，用于 AMBIGUOUS 后的精确回查');

function toolResult(result: QueryResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    isError: !result.ok,
  };
}

/** Create the MCP server without connecting a transport (useful for tests). */
export function createMcpServer(queryFn: QueryFn = defaultQuery): McpServer {
  const server = new McpServer(
    { name: 'china-nbs', version: VERSION },
    {
      instructions:
        '查询中国国家统计局数据发布库。优先用 nbs_series 取时间序列，nbs_search 取最新值。' +
        '如果返回 AMBIGUOUS，把 candidates 展示给用户，选定后用 indicatorId 再查。' +
        '不要编造数值；所有结果都带 source.retrievedAt，引用时注明查询时间。',
    },
  );

  server.registerTool(
    'nbs_search',
    {
      title: '搜索国家统计局指标并返回最新数据',
      description:
        '按关键词搜索指标，返回解析后的指标信息与最近几个数据点。适合回答“最新值是多少”。',
      inputSchema: {
        query: z.string().describe('指标关键词，如 GDP、CPI、广东 GDP、快递业务量'),
        region,
        period,
        limit: z.number().int().min(1).max(50).optional().describe('返回的最新数据点数量，默认 5'),
      },
    },
    async ({ query, region, period, limit }) =>
      toolResult(await queryFn({ action: 'search', query, region, period, limit })),
  );

  server.registerTool(
    'nbs_series',
    {
      title: '查询国家统计局指标时间序列',
      description:
        '按关键词查询一个指标的时间序列，支持全国/分省/主要城市与年/季/月频率。适合趋势、同比、历史对比。',
      inputSchema: {
        query: z.string().describe('指标关键词，如 GDP、CPI、广东 GDP'),
        region,
        period,
        start,
        end,
        maxPoints: z.number().int().min(1).max(1000).optional().describe('最大数据点，默认 240'),
        indicatorId,
      },
    },
    async ({ query, region, period, start, end, maxPoints, indicatorId }) =>
      toolResult(
        await queryFn({
          action: 'series',
          query,
          region,
          period,
          start,
          end,
          maxPoints,
          indicatorId,
        }),
      ),
  );

  server.registerTool(
    'nbs_compare',
    {
      title: '对比多个地区的同一指标',
      description:
        '比较一个指标在多个地区的序列。只支持单指标多地区；多指标请分多次调用。最多 8 个地区。',
      inputSchema: {
        query: z.string().describe('指标关键词，如 GDP、CPI'),
        regions: z.array(z.string()).min(1).max(8).describe('地区列表，如 ["广东","江苏","浙江"]'),
        period,
        start,
        end,
        maxPoints: z.number().int().min(1).max(1000).optional().describe('每个地区最大数据点'),
        indicatorId,
      },
    },
    async ({ query, regions, period, start, end, maxPoints, indicatorId }) =>
      toolResult(
        await queryFn({
          action: 'compare',
          query,
          regions,
          period,
          start,
          end,
          maxPoints,
          indicatorId,
        }),
      ),
  );

  server.registerTool(
    'nbs_catalog',
    {
      title: '浏览国家统计局分类树',
      description:
        '展开分类树节点，用于发现指标所在分类。code：1 全国月、2 全国季、3 全国年、4 分省月、5 分省季、6 分省年、7 城市月价、8 城市年、9 港澳台月。',
      inputSchema: {
        code: z.string().optional().describe('分类 code，默认 3（全国年度）'),
        pid: z.string().optional().describe('父节点 id；空表示根节点'),
        depth: z.number().int().min(1).max(3).optional().describe('展开深度，默认 1'),
      },
    },
    async ({ code, pid, depth }) =>
      toolResult(await queryFn({ action: 'catalog', code, pid, depth })),
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`china-nbs MCP server ${VERSION} running on stdio\n`);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startMcpServer().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
