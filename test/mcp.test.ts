import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createMcpServer, type QueryFn } from '../src/mcp.js';
import type { QueryOptions, QueryResult } from '../src/types.js';

const source = {
  name: '国家统计局' as const,
  url: 'https://data.stats.gov.cn/' as const,
  retrievedAt: '2026-11-04T00:00:00.000Z',
};

function success(action: QueryResult['action']): QueryResult {
  return {
    ok: true,
    action,
    source,
    indicator: {
      id: 'cid:ind',
      name: '国内生产总值',
      displayName: '国内生产总值 (亿元)',
      unit: '亿元',
      frequency: 'year',
      region: '全国',
    },
    points: [
      {
        period: '2025',
        periodName: '2025年',
        value: 1401879.2,
        rawValue: '1401879.2',
        display: '1,401,879.2',
        unit: '亿元',
        region: '全国',
      },
    ],
  };
}

async function connect(queryFn: QueryFn) {
  const server = createMcpServer(queryFn);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'china-nbs-test', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

describe('MCP server', () => {
  it('lists the four NBS tools', async () => {
    const { client, server } = await connect(async (options) =>
      success(options.action ?? 'search'),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['nbs_search', 'nbs_series', 'nbs_compare', 'nbs_catalog']),
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('passes series arguments through and returns JSON text', async () => {
    const calls: QueryOptions[] = [];
    const { client, server } = await connect(async (options) => {
      calls.push(options);
      return success('series');
    });
    try {
      const result = await client.callTool({
        name: 'nbs_series',
        arguments: { query: 'GDP', period: 'year', start: 2020, end: 2025 },
      });
      expect(result.isError).toBe(false);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(JSON.parse(text)).toMatchObject({ ok: true, action: 'series' });
      expect(calls[0]).toMatchObject({
        action: 'series',
        query: 'GDP',
        period: 'year',
        start: 2020,
        end: 2025,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('marks AMBIGUOUS results as tool errors', async () => {
    const { client, server } = await connect(async () => ({
      ok: false,
      action: 'series',
      source,
      error: {
        code: 'AMBIGUOUS',
        message: '找到多个可能的指标',
        retryable: false,
      },
    }));
    try {
      const result = await client.callTool({
        name: 'nbs_search',
        arguments: { query: '人口数' },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
      expect(JSON.parse(text).error.code).toBe('AMBIGUOUS');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('passes compare regions through', async () => {
    const calls: QueryOptions[] = [];
    const { client, server } = await connect(async (options) => {
      calls.push(options);
      return success('compare');
    });
    try {
      await client.callTool({
        name: 'nbs_compare',
        arguments: { query: 'GDP', regions: ['广东', '江苏'], period: 'year' },
      });
      expect(calls[0]).toMatchObject({
        action: 'compare',
        query: 'GDP',
        regions: ['广东', '江苏'],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
