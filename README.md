# china-nbs

[![npm](https://img.shields.io/npm/v/china-nbs)](https://www.npmjs.com/package/china-nbs)
[![license](https://img.shields.io/npm/l/china-nbs)](https://github.com/salt-fishes/china-nbs/blob/main/LICENSE)

用**一个 `query()` 入口**查询中国国家统计局数据发布库的 Node.js 库 + CLI。

> **非国家统计局官方项目。** 数据来源：国家统计局（[data.stats.gov.cn](https://data.stats.gov.cn/)）。  
> 代码使用 MIT License，但 MIT 不覆盖国家统计局数据；请依法、准确使用并注明来源。  
> 新版数据发布库仍处于试运行期，接口可能变化。本项目不绕过 WAF，也不批量镜像或转售数据。

## 特性

- **一个入口**：`query()` 自动完成关键词搜索、分类树导航、指标解析、时间序列查询、分片合并。
- **四个动作**：`search`（最新数据）、`series`（时间序列）、`compare`（分省对比）、`catalog`（分类树）。
- **MCP**：`china-nbs mcp` 通过 stdio 暴露 4 个工具，可直接接入 Claude Desktop、Cursor 等 MCP 客户端。
- **覆盖广**：全国、分省、主要城市；年度、季度、月度；181 个常用指标 curated，其他走分类树兜底。
- **歧义可控**：候选分数接近时返回 `AMBIGUOUS` + 候选列表，可用 `indicatorId` 精确回查，不猜错误指标。
- **口径优先**：默认优先总量/亿元；识别“增速、指数、人均、贡献率、累计、当季、不变价”等口径。
- **分片合并**：自动识别分类树里的跨年份分片（不只 CPI），按时间范围拆分请求、合并、去重、排序。
- **可评测**：219 条评测用例（210 curated + 9 fallback），`npm run eval` 离线测 curated，`npm run eval:live` 测真实解析。
- **零运行时依赖**：Node 22+ 原生 `fetch`；TypeScript 编写，ESM + CJS。
- **对上游友好**：默认串行限流（2 秒间隔）、TTL+LRU 缓存、in-flight 去重、超时、一次重试、NOT_FOUND 负缓存和熔断器。
- **可接代理**：库支持 `fetchImpl` / `dispatcher` 注入；CLI 支持 `--proxy`（可选安装 `undici`）。

## 环境

- Node.js **>= 22**
- 无需 API Key，无需 Cookie
- 数据接口：`https://data.stats.gov.cn/dg/website/publicrelease/web/external`

## 安装

```bash
npm install china-nbs
```

CLI 可直接运行：

```bash
npx china-nbs search GDP
```

本地开发：

```bash
npm install
npm run build
node dist/cli.js search GDP
```

## 快速开始

```ts
import { query, render } from 'china-nbs';

const result = await query({
  action: 'series',
  query: 'GDP',
  region: '全国',
  period: 'year',
  start: 2015,
  end: 2025,
});

console.log(render(result, 'text'));
```

输出：

```text
国家统计局 · 国内生产总值 (亿元)
2015年 全国：702,511.5 亿元
...
2025年 全国：1,401,879.2 亿元
来源：国家统计局（data.stats.gov.cn）
```

`query()` **永远返回结构化 `QueryResult`**；`format` 不改变返回类型。展示用 `render(result, 'text' | 'table' | 'json')`。

## CLI

```bash
# 最新数据
npx china-nbs search GDP --period year --region 全国

# 时间序列
npx china-nbs series GDP --start 2015 --end 2025

# 月度 CPI
npx china-nbs series CPI --start 2025-01 --end 2025-10

# 分省季度 GDP（累计值）
npx china-nbs series GDP --period quarter --region 广东 --start 2025Q1 --end 2026Q3

# 分省月度 CPI
npx china-nbs series CPI --period month --region 广东 --start 2025-01 --end 2025-10

# 主要城市年度数据
npx china-nbs series 广州GDP --start 2020 --end 2024
npx china-nbs compare GDP --regions 广州,深圳 --year 2024

# 常用宏观指标
npx china-nbs series 居民人均消费支出 --start 2020 --end 2025
npx china-nbs series PPI --period month --start 2025-01 --end 2025-10
npx china-nbs series 31个大城市城镇调查失业率 --period month --start 2025-01 --end 2025-10

# 分省对比
npx china-nbs compare GDP --regions 广东,江苏,浙江 --year 2025
npx china-nbs compare GDP --regions 广东,江苏,浙江 --period quarter --start 2025Q1 --end 2025Q4

# 分类树
npx china-nbs catalog --code 3 --depth 2
npx china-nbs catalog --code 4 --depth 2

# JSON 输出
npx china-nbs search CPI --json
```

退出码：

| 码  | 含义                    |
| --- | ----------------------- |
| 0   | 成功                    |
| 1   | 参数错误 / 不支持的动作 |
| 2   | 未找到指标              |
| 3   | 上游错误 / 超时         |
| 4   | 歧义，需要选择候选      |

### 消歧

```bash
npx china-nbs search 人口 --period year --json
# 看 candidates[].id，或直接用序号：
npx china-nbs search 人口 --period year --select 1
```

## MCP

MCP server 通过 stdio 暴露 4 个工具：`nbs_search`、`nbs_series`、`nbs_compare`、`nbs_catalog`。

MCP 依赖是可选的，核心包仍然零运行时依赖：

```bash
npm install -g china-nbs @modelcontextprotocol/sdk zod
china-nbs mcp
```

或者项目内安装：

```bash
npm install china-nbs @modelcontextprotocol/sdk zod
npx china-nbs mcp
```

Claude Desktop / Cursor 配置（stdio）：

```json
{
  "mcpServers": {
    "china-nbs": {
      "command": "china-nbs",
      "args": ["mcp"]
    }
  }
}
```

如果使用 `npx`：

```json
{
  "mcpServers": {
    "china-nbs": {
      "command": "npx",
      "args": ["-y", "china-nbs", "mcp"]
    }
  }
}
```

`npx` 不会自动安装可选 peer 依赖；建议先全局安装 `@modelcontextprotocol/sdk` 和 `zod`，或使用项目内安装。

工具返回结构化 `QueryResult` 的 JSON 文本；`AMBIGUOUS` 会作为 tool error 返回，客户端应展示候选并用 `indicatorId` 重查。详见 [docs/mcp.md](docs/mcp.md)。

## API

### `query(options): Promise<QueryResult>`

| 参数                     | 类型                                             | 说明                                            |
| ------------------------ | ------------------------------------------------ | ----------------------------------------------- |
| `action`                 | `'search' \| 'series' \| 'compare' \| 'catalog'` | 默认 `search`                                   |
| `query`                  | `string`                                         | 指标关键词，如 `GDP`、`CPI`、`广东 GDP`         |
| `region`                 | `string`                                         | 单个地区，默认 `全国`；支持分省和 36 个主要城市 |
| `regions`                | `string[]`                                       | `compare` 用                                    |
| `period`                 | `'year' \| 'quarter' \| 'month'`                 | 不填则按 start/end/关键词推断                   |
| `start` / `end`          | `string \| number`                               | 闭区间；`2015`、`2025Q1`、`2025-01`             |
| `limit`                  | `number`                                         | `search` 最新数据点数量，默认 5                 |
| `maxPoints`              | `number`                                         | `series` 最大数据点，默认 240                   |
| `indicatorId`            | `string`                                         | 候选的 `id`，用于消歧                           |
| `code` / `pid` / `depth` | `string` / `string` / `number`                   | `catalog` 用；`code` 1-9，默认 3                |
| `timeoutMs`              | `number`                                         | 单请求超时，默认 20000                          |
| `totalTimeoutMs`         | `number`                                         | 整次查询超时，默认 45000                        |
| `signal`                 | `AbortSignal`                                    | 调用方取消                                      |
| `noCache`                | `boolean`                                        | 跳过本次缓存                                    |
| `fetchImpl`              | `typeof fetch`                                   | 自定义 fetch，用于代理/网关/测试                |
| `dispatcher`             | `unknown`                                        | undici dispatcher，如 `new ProxyAgent(url)`     |
| `debug` / `logger`       | `boolean` / function                             | 调试日志                                        |

`compare` 只比较**一个指标**在多个地区的序列；需要比较多个指标时请分多次调用，不要在一次 `compare` 里混指标。

### `QueryResult`

```ts
interface QueryResult {
  ok: boolean;
  action: Action;
  indicator?: IndicatorMeta;
  points?: DataPoint[];
  series?: CompareSeries[];
  candidates?: IndicatorCandidate[];
  nodes?: CatalogNode[];
  source: { name: '国家统计局'; url: string; retrievedAt: string };
  notes?: string[];
  partial?: boolean;
  error?: { code: ErrorCode; message: string; retryable: boolean; hint?: string };
}
```

示例：

```ts
const latest = await query({ action: 'search', query: 'GDP', period: 'year' });

const ambiguous = await query({ action: 'search', query: '人口', period: 'year' });
if (ambiguous.error?.code === 'AMBIGUOUS') {
  const choice = ambiguous.candidates?.[0];
  if (choice) {
    const precise = await query({
      action: 'series',
      query: '人口',
      period: 'year',
      indicatorId: choice.id,
      start: 2020,
      end: 2025,
    });
  }
}
```

## 支持范围（v0.4）

| 数据                        | 状态                                                |
| --------------------------- | --------------------------------------------------- |
| 全国年度                    | ✅                                                  |
| 全国季度                    | ✅（GDP 等常用指标；季度 GDP 默认累计值）           |
| 全国月度                    | ✅（CPI/PPI/社零/固投/失业率/财政/M2/M1 等）        |
| 分省年度（code=6）          | ✅（GDP、社零、固投、收入、财政、粮食等）           |
| 分省季度（code=5）          | ✅（GDP、收入、消费、社零增速、建筑业、农林牧渔等） |
| 分省月度（code=4）          | ✅（CPI、PPI、工业、固投、房地产等）                |
| 主要城市年度（code=8）      | ✅（内置 36 个主要城市；GDP curated，其他走分类树） |
| 主要城市月度价格（code=7）  | ⏳ 36/70 城市汇总价格指数，不是单城市数据           |
| 港澳台 / 部门 / 国际 / 普查 | ⏳ 后续                                             |
| MCP server                  | ✅ 内置（需可选安装 SDK/zod）                       |

常用指标 curated 共 **181 个**，覆盖 GDP、CPI、PPI、人口与人口结构、社零、固投、收入、消费、财政、粮食、进出口、工业与工业产品产量、失业率、房地产、建筑业、能源、交通邮电、金融（含月度 M2/M1）、教育、卫生、环境、分行业 PPI、农产品生产价格、网上零售等。

## 评测

```bash
npm run eval        # 离线：只测 curated 快速路径，不请求上游
npm run eval:live   # 在线：curated + search/tree 的真实解析
```

当前评测集 **219 条**：210 条 curated 用例 + 9 条 fallback 用例，覆盖全国/分省/主要城市、年/季/月、总量/累计/增速等口径。离线 curated 为 **210/210 top-1**；在线整体 **219/219 top-1（100.0%）**，其中 fallback 为 **9/9**。评测集在 `scripts/eval-cases.ts`，新增指标时请同时补用例。

## 数据口径

一定要区分：

- **同比**：月度 CPI 常见 `上年同月=100`；年度 `上年=100`。
- **累计 / 当季**：全国季度 GDP 同时存在累计值和当季值；默认 `GDP` 取累计值，`GDP当季` 取当季值。分省季度目前只有累计值和指数，没有当季值。
- **分省 code**：分省年度/季度/月度分别用 `code=6/5/4`；不要把所有分省查询都当成年度。
- **社零**：月度默认取**当期值**；`社零累计` 取累计值，`社零同比/社零增速` 取同比增长。分省季度只有累计增速。
- **固投**：全国年度取亿元总量；全国月度、分省年度/月度只有增速，没有亿元总量。
- **PPI**：月度/年度都是 `上年（同月）=100` 的指数，不是百分比涨跌幅。
- **失业率**：默认月度**城镇调查失业率**；年度**城镇登记失业率**数据截至 2021，且口径不同。
- **城市**：主要城市年度 `code=8`，内置 36 个城市；`code=7` 是 36/70 城市汇总价格指数，不是单城市数据。
- **现价 / 不变价**：默认取现价总量；问“实际增速/不变价”时会降权现价指标。
- **贡献率 / 拉动 / 构成**：只有明确问到时才优先。
- **人均**：只有明确问“人均”时才优先。
- **修订**：GDP 等数据会初步核算、最终核实和修订；结果带 `retrievedAt`，请注明查询时间。

详见 [docs/data-semantics.md](docs/data-semantics.md)。

## 限流与缓存

| 内容     | TTL     |
| -------- | ------- |
| 搜索     | 10 分钟 |
| 时间序列 | 30 分钟 |
| 分类树   | 24 小时 |
| 指标列表 | 24 小时 |
| 省份列表 | 7 天    |

默认串行请求，请求间隔 ≥ 2 秒（加 0–250ms jitter），5xx/429 重试 1 次。连续 5 次可重试失败后熔断 30 秒（可配置），`NOT_FOUND` 结果会做 5 分钟负缓存。详见 [docs/rate-limit.md](docs/rate-limit.md)。

## 代理

库层可以直接注入 `dispatcher`（需要安装 `undici`）：

```ts
import { query } from 'china-nbs';
import { ProxyAgent } from 'undici';

const result = await query({
  query: 'GDP',
  dispatcher: new ProxyAgent('http://127.0.0.1:7890'),
});
```

CLI：

```bash
npm install -g undici
china-nbs search GDP --proxy http://127.0.0.1:7890
```

也可以传自定义 `fetchImpl`，接入公司网关或测试桩。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build
npm run smoke   # 手动跑真实接口，不在 CI 中执行
```

真实接口契约和字段说明见 [docs/contracts.md](docs/contracts.md)。

## License

代码：MIT。  
数据：国家统计局，版权归国家统计局所有；本项目不主张数据版权。  
请勿用本项目批量镜像、转售或商业分发国家统计局数据。
