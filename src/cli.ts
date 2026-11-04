#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { query, render } from './index.js';
import type { Format, QueryOptions, QueryResult } from './types.js';

const VERSION = '0.5.0';

const HELP = `china-nbs ${VERSION}
用一句关键词查询国家统计局官方数据。

用法：
  china-nbs search <指标> [选项]
  china-nbs series <指标> [选项]
  china-nbs compare <指标> --regions 广东,江苏,浙江 [选项]
  china-nbs catalog [选项]
  china-nbs mcp

示例：
  china-nbs search GDP --period year --region 全国
  china-nbs series GDP --start 2015 --end 2025
  china-nbs series GDP --period quarter --region 广东 --start 2025Q1 --end 2026Q3
  china-nbs series CPI --start 2025-01 --end 2025-10
  china-nbs series CPI --period month --region 广东 --start 2025-01 --end 2025-10
  china-nbs compare GDP --regions 广东,江苏,浙江 --year 2025
  china-nbs compare GDP --regions 广东,江苏,浙江 --period quarter --start 2025Q1 --end 2025Q4
  china-nbs catalog --code 3 --depth 2
  china-nbs mcp
  china-nbs search CPI --json

选项：
  --period <year|quarter|month>  频率；不填则按 start/end/关键词推断
  --region <地区>                单个地区，默认全国
  --regions <a,b,c>              compare 用，逗号分隔
  --start <时间>                 起始时间，如 2015、2025Q1、2025-01
  --end <时间>                   结束时间
  --year <年份>                  compare 用，等价于 --start/--end 同一年
  --limit <n>                    search 返回的最新数据点数量，默认 5
  --max-points <n>               series 最大数据点，默认 240
  --select <id|序号>             从歧义候选中选择；序号从 1 开始
  --code <1-9>                   catalog 分类：1 全国月、2 全国季、3 全国年、4 分省月、5 分省季、6 分省年、7 城市月价、8 城市年、9 港澳台月；默认 3
  --pid <节点id>                 catalog 父节点
  --depth <1|2|3>                catalog 展开深度，默认 1
  --json                         输出 JSON
  --table                        输出表格
  --no-cache                     跳过本次缓存
  --debug                        输出请求日志到 stderr
  --timeout <ms>                 单请求超时，默认 20000
  --total-timeout <ms>           整次查询超时，默认 45000
  --proxy <url>                  使用 HTTP(S) 代理；需要额外安装 undici
  -h, --help                     显示帮助
  -v, --version                  显示版本

退出码：0 成功，1 参数错误，2 未找到，3 上游错误，4 歧义。
`;

interface ParsedCli {
  command: string;
  query: string;
  options: QueryOptions;
  format: Format;
  select?: string;
  proxy?: string;
}

function parseInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new Error(`${name} 需要整数，收到：${value}`);
  }
  return number;
}

function parseArgs(argv: string[]): ParsedCli | { help: true } | { version: true } {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  if (argv.includes('--version') || argv.includes('-v')) return { version: true };

  const command = argv[0];
  if (!command) return { help: true };
  const known = new Set(['search', 'series', 'compare', 'catalog', 'mcp']);
  if (!known.has(command)) {
    throw new Error(`未知命令：${command}`);
  }

  const options: QueryOptions = { action: command as QueryOptions['action'] };
  const positional: string[] = [];
  let format: Format = 'text';
  let select: string | undefined;
  let proxy: string | undefined;

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (!arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }

    const next = (): string | undefined => {
      index += 1;
      return argv[index];
    };

    switch (arg) {
      case '--period': {
        const value = next();
        if (value !== 'year' && value !== 'quarter' && value !== 'month') {
          throw new Error('--period 只支持 year、quarter、month');
        }
        options.period = value;
        break;
      }
      case '--region':
        options.region = next();
        break;
      case '--regions':
        options.regions = (next() ?? '')
          .split(/[,，]/)
          .map((item) => item.trim())
          .filter(Boolean);
        break;
      case '--start':
        options.start = next();
        break;
      case '--end':
        options.end = next();
        break;
      case '--year': {
        const value = next();
        options.start = value;
        options.end = value;
        break;
      }
      case '--limit':
        options.limit = parseInteger(next(), '--limit');
        break;
      case '--max-points':
        options.maxPoints = parseInteger(next(), '--max-points');
        break;
      case '--select':
        select = next();
        break;
      case '--code':
        options.code = next();
        break;
      case '--pid':
        options.pid = next();
        break;
      case '--depth':
        options.depth = parseInteger(next(), '--depth');
        break;
      case '--timeout':
        options.timeoutMs = parseInteger(next(), '--timeout');
        break;
      case '--total-timeout':
        options.totalTimeoutMs = parseInteger(next(), '--total-timeout');
        break;
      case '--proxy':
        proxy = next();
        break;
      case '--json':
        format = 'json';
        break;
      case '--table':
        format = 'table';
        break;
      case '--text':
        format = 'text';
        break;
      case '--no-cache':
        options.noCache = true;
        break;
      case '--debug':
        options.debug = true;
        break;
      default:
        throw new Error(`未知选项：${arg}`);
    }
  }

  const queryText = positional.join(' ').trim();
  if (command !== 'catalog' && command !== 'mcp' && !queryText) {
    throw new Error(`${command} 需要一个指标关键词，例如 GDP、CPI、广东 GDP`);
  }

  return {
    command,
    query: queryText,
    options: { ...options, query: queryText || undefined },
    format,
    select,
    ...(proxy === undefined ? {} : { proxy }),
  };
}

async function loadProxyDispatcher(proxyUrl: string): Promise<unknown> {
  try {
    const undici = (await import('undici')) as { ProxyAgent: new (url: string) => unknown };
    return new undici.ProxyAgent(proxyUrl);
  } catch (error) {
    throw new Error('使用 --proxy 需要先安装 undici：npm install -g undici（或安装到当前项目）', {
      cause: error,
    });
  }
}

function exitCode(result: QueryResult): number {
  if (result.ok) return 0;
  switch (result.error?.code) {
    case 'INVALID_ARGUMENT':
    case 'INVALID_RANGE':
    case 'UNSUPPORTED_ACTION':
      return 1;
    case 'NOT_FOUND':
      return 2;
    case 'AMBIGUOUS':
      return 4;
    default:
      return 3;
  }
}

async function runQuery(parsed: ParsedCli): Promise<QueryResult> {
  if (!parsed.select) return query(parsed.options);

  const first = await query(parsed.options);
  if (parsed.select.includes(':')) {
    return query({ ...parsed.options, indicatorId: parsed.select });
  }

  const index = Number(parsed.select);
  if (!Number.isInteger(index) || index < 1) {
    throw new Error('--select 需要候选序号（从 1 开始）或 candidate id');
  }
  const candidate = first.candidates?.[index - 1];
  if (!candidate) {
    return first;
  }
  return query({ ...parsed.options, indicatorId: candidate.id });
}

/** CLI entry point; exported for tests. */
export async function run(argv: string[]): Promise<number> {
  let parsed: ParsedCli;
  try {
    const result = parseArgs(argv);
    if ('help' in result) {
      process.stdout.write(HELP);
      return 0;
    }
    if ('version' in result) {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    parsed = result;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
    return 1;
  }

  if (parsed.command === 'mcp') {
    try {
      const { startMcpServer } = await import('./mcp.js');
      await startMcpServer();
      return 0;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') {
        process.stderr.write('MCP 依赖未安装。请运行：npm install @modelcontextprotocol/sdk zod\n');
        return 1;
      }
      throw error;
    }
  }

  if (parsed.proxy) {
    try {
      parsed.options.dispatcher = await loadProxyDispatcher(parsed.proxy);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  try {
    const result = await runQuery(parsed);
    process.stdout.write(`${render(result, parsed.format)}\n`);
    return exitCode(result);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
