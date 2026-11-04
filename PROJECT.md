# china-nbs 项目书（v0.2 修订版）

> 版本：v0.2  
> 日期：2026-11-03  
> 状态：M2-A/M2-B/M2-C 已实现；160 个 curated、198 条评测用例；MCP 已加入 v0.4.0，0.5.0 扩展覆盖  
> 关联项目：qbot  
> 原始草案：`../china-nbs-project-proposal.md`（v0.1，保留作历史记录）

---

## 0. 摘要

`china-nbs` 是一个把**国家统计局数据发布库**封装成**单一结构化查询入口**的 Node.js 库 + CLI。

对外只暴露一个 `query()` 方法，内部完成关键词搜索、分类树导航、指标解析、口径排序、时间序列查询、分片合并和地区对比。目标用户是 qbot、AI Agent、CLI 用户和 Node 开发者。

相对 v0.1 的核心修正：

1. **库不做自然语言解析**。自然语言 → 参数由 qbot/模型完成；库只接受结构化参数，返回结构化结果。
2. **`query()` 永远返回 `QueryResult` 对象**。文本/表格由 `render(result, format)` 渲染，避免 `format: 'text'` 返回类型不闭合。
3. **歧义必须闭环**。`AMBIGUOUS` 返回 `candidates`，调用方用 `indicatorId` 精确回查。
4. **接口契约以实测为准**。完整 URL、字段、分页、空结果、分片 id 写入 `docs/contracts.md` 和 fixtures。
5. **请求预算按动作定义**。不再承诺“单次查询 ≤ 2/4 个请求”这种与分片冲突的数字。

---

## 1. 背景与问题

### 1.1 数据源

国家统计局数据发布库：`https://data.stats.gov.cn/`

覆盖全国月度/季度/年度、分省、主要城市、港澳台、部门、国际、普查、年鉴等。官方介绍截至 2023 年 8 月有近 7.6 万个指标、超过 1300 万笔数据。

新版数据发布库 2026-03-27 上线，仍处于试运行期。

### 1.2 痛点

1. 没有公开 API 文档；现有接口是前端内部 JSON 接口。
2. 旧 `easyquery.htm?m=QueryData` 已被 WAF 按 URL 拦截（403 `reason:UrlACL`），不能作为 fallback。
3. 新接口分散在搜索、分类树、指标列表、数据查询、省份列表 5 个 endpoint。
4. 指标同名/同义/不同口径（现价/不变价、同比/环比、累计/当季、贡献率/总量、人均）。
5. 月度长序列按年份分片，每个分片有不同 `cid` 和 `indicatorId`。
6. 搜索接口噪声大：`search=GDP` 首屏是贡献率和指数；`search=居民消费价格指数` 只返回年度；月度 CPI 必须走分类树。
7. AI 工具不适合直接暴露 5 个底层接口；应封装成一个 `stats` 工具。

### 1.3 实测结论

- 新接口可用，无需 API Key/Cookie；返回 JSON，但 `Content-Type` 常为 `text/html`。
- 搜索 `/external/query` 可用；`/web/query` 404。
- 分类树 `/external/new/queryIndexTreeAsync` 可用。
- 指标列表 `/external/new/queryIndicatorsByCid` 可用。
- 数据 `/external/stream/esData` 可用；`rootId` 实测固定。
- 省份 `/external/getAllProvince` 返回 34 个地区（含台湾、香港、澳门）。
- `das` 传多个地区时只返回第一个；`compare` 必须按地区逐个请求。

---

## 2. 项目定位

### 2.1 一句话

**用一个结构化查询入口，查中国国家统计局的官方统计数据。**

### 2.2 目标

1. 提供统一 `query()` API，覆盖搜索、时间序列、地区对比、分类浏览。
2. 提供零运行时依赖 CLI。
3. 提供 qbot 适配器，让 qbot 只注册一个 `stats` 工具。
4. 自动处理指标解析、口径排序、时间分片、单位、地区、缺失值。
5. 默认带缓存、限流、重试、超时和清晰错误。
6. MIT 开源，文档和 fixtures 可复用。

### 2.3 非目标

1. 不做 BI 平台或可视化大屏。
2. 不抓取微观数据、非公开数据或需要登录的数据。
3. 不承诺国家统计局接口的长期稳定性或 SLA。
4. 不替代通用网页搜索；新闻、解读、政策原文仍走 `web`。
5. 不批量转售、镜像或商业分发国家统计局数据。
6. v0.1 不做 MCP、Web UI、数据库存储。

---

## 3. 用户与场景

| 用户                  | 需求                                              |
| --------------------- | ------------------------------------------------- |
| qbot / QQ 群机器人    | 群友问 GDP、CPI、人口、省份数据时，直接给官方数值 |
| AI Agent / MCP 客户端 | 通过一个工具查询中国统计数据                      |
| CLI 用户 / 分析师     | 终端快速查数、导出 JSON                           |
| Node 开发者           | 在项目里调用稳定库                                |
| 开源贡献者            | 补充指标别名、测试用例、文档                      |

典型场景：

| 场景         | 输入                                          | 期望输出                    |
| ------------ | --------------------------------------------- | --------------------------- |
| 最新 GDP     | `query: "GDP", period: "year"`                | 2025 年全国 GDP，亿元       |
| GDP 时间序列 | `start: 2015, end: 2025`                      | 11 个年度点                 |
| 月度 CPI     | `query: "CPI", period: "month"`               | 2025-01 至 2025-10 月度同比 |
| 分省对比     | `regions: ["广东","江苏","浙江"], year: 2025` | 三省 GDP                    |
| 人口         | `query: "人口", period: "year"`               | 年末总人口，万人            |
| 分省人口     | `query: "广东人口", period: "year"`           | 广东年末常住人口            |
| 指标探索     | `action: "catalog", code: "3"`                | 分类树                      |

---

## 4. 产品设计

### 4.1 一个入口，四个动作

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

| action    | 作用                        | 主要参数                                       | 版本 |
| --------- | --------------------------- | ---------------------------------------------- | ---- |
| `search`  | 解析指标 + 返回最新几条数据 | `query`、`period`、`region`、`limit`           | v0.1 |
| `series`  | 时间序列                    | `query`、`region`、`start`、`end`、`maxPoints` | v0.1 |
| `compare` | 多地区对比（分省年度）      | `query`、`regions`、`period`、`start/end`      | v0.1 |
| `catalog` | 分类树/指标浏览             | `code`、`pid`、`depth`                         | v0.1 |

说明：

- `search` 实际是“解析 + 最新数据”，不是元数据搜索；元数据浏览用 `catalog`。
- `compare` v0.1 只支持分省年度；全国与分省不能混比。
- `catalog` code：`1` 月度、`2` 季度、`3` 年度、`6` 分省年度。
- 如果未显式传 `region`，会从 query 文本推断省份，例如 `广东GDP`、`广东人口`。

### 4.2 返回结构

```ts
interface QueryResult {
  ok: boolean;
  action: 'search' | 'series' | 'compare' | 'catalog';
  indicator?: IndicatorMeta;
  points?: DataPoint[];
  series?: CompareSeries[];
  candidates?: IndicatorCandidate[];
  nodes?: CatalogNode[];
  source: SourceMeta;
  notes?: string[];
  partial?: boolean;
  error?: QueryError;
}
```

设计原则：

- 数值统一 `number | null`，同时保留 `rawValue` 和单位。
- 不在库里四舍五入；展示时只加千分位。
- 所有结果带 `source` 和 `retrievedAt`。
- 指标不明确返回 `AMBIGUOUS` + 候选，不猜。
- 分片部分失败返回已拿到的数据，`partial: true`，并在 `notes` 说明缺口。

### 4.3 歧义闭环

```ts
const r = await query({ action: 'search', query: '人口', period: 'year' });
if (r.error?.code === 'AMBIGUOUS') {
  const candidate = r.candidates?.[0];
  const precise = await query({
    action: 'series',
    query: '人口',
    period: 'year',
    indicatorId: candidate?.id,
    start: 2020,
    end: 2025,
  });
}
```

- `candidates[].id` 格式：`${cid}:${indicId}`。
- CLI：`--select <序号>` 或 `--select <id>`。
- 文本输出不暴露内部 id；JSON 输出包含。

### 4.4 渲染分离

```ts
render(result, 'text'); // 聊天/终端
render(result, 'table'); // 表格
render(result, 'json'); // 机器可读
```

`query()` 不接受 `format` 影响返回类型；qbot 适配器使用 `render()`。

### 4.5 CLI

```bash
china-nbs search GDP --period year --region 全国
china-nbs series GDP --start 2015 --end 2025
china-nbs series CPI --start 2025-01 --end 2025-10
china-nbs compare GDP --regions 广东,江苏,浙江 --year 2025
china-nbs catalog --code 3 --depth 2
china-nbs search CPI --json
```

退出码：`0` 成功，`1` 参数/不支持，`2` 未找到，`3` 上游错误，`4` 歧义。

### 4.6 qbot 适配

qbot 工具箱从 8 个变成 9 个：

```text
web / recall_history / paper / map / weather /
meituan_travel / hotboard / steam / stats
```

提示词：

```text
GDP、CPI、PPI、人口、失业率、工业增加值、社会消费品零售总额、
固定资产投资、财政收入、居民收入、分省数据等，优先用 stats；
stats 返回 UPSTREAM_BLOCKED/TIMEOUT 时才回退 web，
并明确说明“统计局数据库暂时没取到”，不要编造数值。
新闻、解读、政策原文仍用 web。
```

### 4.7 MCP（v0.3）

`npx china-nbs mcp`，工具名 `nbs_query`，参数与 `query()` 一致。

MCP SDK 需要额外依赖，不能计入“零运行时依赖”；实现方式二选一：

- optional peer dependency + 独立入口；
- 独立包 `china-nbs-mcp`。

---

## 5. 数据源契约（实测）

完整字段和样例见 `docs/contracts.md`。

### 5.1 完整 URL

Base：

```text
https://data.stats.gov.cn/dg/website/publicrelease/web/external
```

| 功能     | 方法 | 路径                        |
| -------- | ---- | --------------------------- |
| 搜索     | GET  | `/query`                    |
| 分类树   | GET  | `/new/queryIndexTreeAsync`  |
| 指标列表 | GET  | `/new/queryIndicatorsByCid` |
| 数据     | POST | `/stream/esData`            |
| 省份     | GET  | `/getAllProvince`           |

### 5.2 搜索

- 参数：`search`、`pagenum`、`pageSize`、`code`。
- `code=1/2/3` 可用；`code=6` 返回 `count` 但 `data` 为空，分省必须走分类树。
- 同一指标会按年份重复；按 `cid:indic_id` 去重。
- 月度 CPI 不在搜索结果里，必须走分类树。
- `pageSize=50` 可用；不要依赖严格分页。

### 5.3 分类树与指标列表

- `pid=` 空返回根；用 `_id` 继续展开。
- 叶子 `_id` 就是 `cid`。
- `code` 按“范围 × 频率”组合：全国 `1/2/3`，分省 `4/5/6`，主要城市 `7/8`，港澳台 `9`。分省月度/季度已实测确认存在。
- 指标列表字段：`_id`、`_name`、`i_showname`、`du_name`、`dp_name`、`kj1_name`、`daterange_sdate/edate`。
- 分片的指标 id 可能不同（全国/分省 CPI 均已实测 4 组）。

### 5.4 数据

- 请求体：`cid`、`indicatorIds`、`das`、`dts`、`rootId`、`showType`。
- `dts`：`2025YY`、`202603SS`、`202510MM`；区间用 `-`。
- `rootId`：`69c574ab128a44e595cc0b24502b771b`（实测固定）。
- `das` 多地区只返回第一个；`compare` 逐地区请求。
- 未发布值为 `""`；库省略末尾空值。

### 5.5 地区

`/getAllProvince` 返回 34 个地区：31 个省级行政区 + 台湾 + 香港 + 澳门。

`code=4/5/6` 分别对应分省月度、季度、年度；`code=6` 只用于年度。分省月度/季度已实测可查（广东 2026Q3 GDP 累计值、广东 2025-10 CPI）。

主要城市年度 `code=8` 使用标准行政区划码 + `000000`，如广州 `440100000000`；已实测广州 2024 年 GDP。上游只提供 36 个主要城市（4 个直辖市按省级处理 + 32 个地级市），不能靠扩展列表增加城市数据。`code=7` 是 36/70 城市汇总价格指数，不是单城市数据。

### 5.6 兼容性

- 返回 JSON 但 `Content-Type: text/html`，必须直接 parse。
- 403 不重试、不绕过；返回 `UPSTREAM_BLOCKED`。
- 500/429 可重试一次；404 表示路径错误。
- HTTP 200 但 `success: false` / `state != 20000` 按上游错误处理。

---

## 6. 技术方案

### 6.1 技术栈

| 项          | 选择                         |
| ----------- | ---------------------------- |
| 语言        | TypeScript                   |
| 运行时      | Node.js >= 22（原生 fetch）  |
| 包格式      | ESM + CJS                    |
| 构建        | tsup                         |
| 测试        | Vitest                       |
| Lint/Format | Biome                        |
| 运行时依赖  | 0                            |
| CLI         | 原生 process.argv            |
| 发布        | npm + GitHub Releases        |
| CI          | GitHub Actions（Node 22/24） |

### 6.2 模块

| 模块                   | 职责                                                |
| ---------------------- | --------------------------------------------------- |
| `src/index.ts`         | `query()`、参数校验、action 分发、总超时            |
| `src/client.ts`        | HTTP、超时、重试、串行限流、JSON 解析               |
| `src/cache.ts`         | TTL + LRU + in-flight 去重                          |
| `src/rate-limiter.ts`  | 串行限流队列（跨 query 共享）                       |
| `src/provider.ts`      | Provider 接口                                       |
| `src/nbs-provider.ts`  | 国家统计局 Provider 实现（含搜索字段映射/单位提取） |
| `src/catalog.ts`       | 分类树展开                                          |
| `src/catalog-codes.ts` | 范围 × 频率 → code 映射                             |
| `src/resolver.ts`      | 关键词 → cid + indicId，排序/歧义/树回退            |
| `src/curated.ts`       | 常用指标快速路径                                    |
| `src/aliases.ts`       | 别名、停用词、口径词                                |
| `src/regions.ts`       | 34 个分省 + 36 个主要城市、别名、文本推断           |
| `src/series.ts`        | dts 解析、分片选择、合并、缺失值                    |
| `src/compare.ts`       | 多地区对比                                          |
| `src/format.ts`        | text/table/json 渲染                                |
| `src/errors.ts`        | 错误码、hint、retryable                             |
| `src/types.ts`         | 公共类型                                            |
| `src/cli.ts`           | CLI                                                 |

### 6.3 指标解析

顺序：

1. `indicatorId` 选择；
2. curated 快速路径（精确匹配，避免“GDP指数”误命中“GDP”）；
3. 搜索 + 本地排序；
4. 分类树回退；
5. 返回 `NOT_FOUND` + 建议。

排序因子：

- 名称匹配（完全/包含/关键词）；
- 频率（年/季/月）和 `type_value`；
- 地区（全国/分省）；
- 口径（增速/指数/人均/贡献率/累计/当季/不变价）；
- 默认偏好（非价格指标优先亿元/元；价格指数优先 `=100`）；
- 新鲜度。

阈值：

- 最高分 ≥ 80 且领先 ≥ 10 → 直接解析；
- 最高分 ≥ 60 且领先 ≥ 20 → 直接解析；
- 只有单一候选且 ≥ 45 → 直接解析；
- 最高分 ≥ 30 → `AMBIGUOUS`，返回前 3；
- 否则 `NOT_FOUND`。

已内置 curated **160 个**，覆盖：

- 国民经济核算：全国/分省/城市 GDP、建筑业总产值
- 人口就业：人口、出生率/死亡率/自然增长率、总抚养比、城镇调查失业率、31 大城市失业率、青年失业率、平均工资
- 价格：CPI、PPI、恩格尔系数
- 居民收支：居民人均可支配收入/消费支出、城镇居民收入、农村居民收入（全国/分省/季度）
- 消费投资：社零（年度/月度当期/累计/同比）、固投（年度总量/月度增速）、房地产投资、商品房销售面积/额
- 财政贸易：一般公共预算收支、地方财政收支、进出口/出口/进口
- 农业能源：粮食、夏粮、农林牧渔总产值、一次能源生产总量、能源消费总量、发电量、原煤/原油产量
- 工业：规上工业增加值、工业企业营业收入/利润、水泥/粗钢/钢材/汽车/手机/集成电路产量
- 交通邮电：旅客/货物运输量、旅客/货物周转量、快递量/收入、移动电话用户、宽带接入用户
- 金融：年度 M2、金融机构各项存款/贷款；月度 M2/M1 期末值与 M2 同比
- 教育：普通高等学校数、本专科在校生、高校专任教师
- 卫生：医疗卫生机构数、卫生技术人员、床位、卫生总费用
- 环境：供水总量、生活垃圾清运量/无害化处理率、造林总面积
- 价格细分：煤炭、油气、黑色金属矿、汽车、计算机通信电子制造业 PPI
- 城市：36 个主要城市年度 GDP

新增指标时优先补 curated + `scripts/eval-cases.ts` 用例；长尾指标仍走搜索/分类树。

通用解析改进（M2-B）：

- 查询先清洗日期/地区/停用词，再做完整名称匹配，避免“夏收粮食产量”被“粮食产量”抢走。
- 增加限定词评分（城镇/农村、税收/支出、利润/营业收入、夏收/秋收、房地产、进出口等）。
- 分类树支持 `code=4/5/6/8`，按提示词扩展分支，并对叶子做 n-gram 亲和度排序，最多取 5 个叶子取指标。
- 搜索结果不确定时，如果 query 有类别提示，继续走分类树；树结果优先于宽泛搜索候选。

### 6.4 分片

- 每个 `Shard` 有独立 `cid`、`indicId`、`startYear/endYear`。
- 按查询范围与分片范围求交集，逐片请求。
- 合并、按时间排序、去重；末尾空值省略。
- 某片失败：返回其余数据，`partial: true`，`notes` 说明。
- CPI 月度 4 个分片已内置（全国与分省各一套 `cid` / `indicId`）；其他指标先走单 cid，后续补充。

### 6.5 请求预算与延迟

| 动作                        | 典型请求数 |
| --------------------------- | ---------- |
| `search`（curated）         | 1          |
| `search`（搜索）            | 2          |
| `series`（全国/分省单分片） | 1–2        |
| `series`（CPI 4 分片）      | 4–5        |
| `series`（主要城市年度）    | 1–3        |
| `compare`（3 省，年/季）    | 3–4        |

默认 2 秒串行间隔；4 分片约 8–12 秒。延迟目标：

- 缓存命中 < 10ms；
- 单请求 0.2–1.5s；
- 2 请求 2–4s；
- 4 分片 8–12s。

不再承诺 P50 < 1.5s / P95 < 5s；真实目标按动作和缓存命中率衡量。

### 6.6 缓存与限流

| 内容     | TTL     |
| -------- | ------- |
| 搜索     | 10 分钟 |
| 时间序列 | 30 分钟 |
| 分类树   | 24 小时 |
| 指标列表 | 24 小时 |
| 省份列表 | 7 天    |

- 进程内 Map，最多 200 条，LRU 淘汰。
- 不落盘。
- 串行限流 + 0–250ms jitter。
- 5xx/429/网络错误重试 1 次；403 不重试。
- 单请求 20s，整次查询 45s。

### 6.7 错误处理

| 错误码                  | 场景             | 处理                 |
| ----------------------- | ---------------- | -------------------- |
| `NOT_FOUND`             | 搜索无结果       | 返回建议             |
| `AMBIGUOUS`             | 多个指标分数接近 | 返回前 3 候选        |
| `INVALID_RANGE`         | 时间范围不合法   | 提示格式             |
| `INVALID_ARGUMENT`      | 参数/地区错误    | 提示可用值           |
| `UNSUPPORTED_ACTION`    | 未知 action 等   | 说明可用动作         |
| `RATE_LIMITED`          | 本地限流         | 等待                 |
| `UPSTREAM_BLOCKED`      | 403/WAF          | 不重试，提示回退 web |
| `UPSTREAM_RATE_LIMITED` | 429              | 重试 1 次            |
| `UPSTREAM_ERROR`        | 5xx / 业务失败   | 重试 1 次            |
| `TIMEOUT`               | 超时             | 重试 1 次            |
| `ABORTED`               | 调用方取消       | 不重试               |
| `PARSE_ERROR`           | JSON/结构变化    | 记录摘要，提示改版   |

所有错误带 `retryable` 和 `hint`。

---

## 7. API 设计

### 7.1 QueryOptions

```ts
interface QueryOptions {
  action?: 'search' | 'series' | 'compare' | 'catalog'; // 默认 search
  query?: string;
  region?: string; // 默认 全国；也可从 query 文本推断
  regions?: string[]; // compare
  period?: 'year' | 'quarter' | 'month';
  start?: string | number;
  end?: string | number;
  limit?: number; // search 最新点，默认 5
  maxPoints?: number; // series 最大点，默认 240
  timeoutMs?: number; // 默认 20000
  totalTimeoutMs?: number; // 默认 45000
  signal?: AbortSignal;
  indicatorId?: string; // cid:indicId
  code?: string; // catalog 1-9：全国月/季/年、分省月/季/年、城市、港澳台
  pid?: string; // catalog
  depth?: number; // catalog 1..3
  noCache?: boolean;
  debug?: boolean;
  logger?: (message: string, detail?: unknown) => void;
}
```

### 7.2 示例

```ts
// 最新
await query({ action: 'search', query: 'GDP', period: 'year' });

// 序列
await query({
  action: 'series',
  query: 'GDP',
  region: '全国',
  period: 'year',
  start: 2015,
  end: 2025,
});

// 分省对比
await query({
  action: 'compare',
  query: 'GDP',
  regions: ['广东', '江苏', '浙江'],
  period: 'year',
  start: 2025,
  end: 2025,
});

// 分类树
await query({ action: 'catalog', code: '3', depth: 2 });
```

### 7.3 时间格式

| 频率 | 输入      | 输出      |
| ---- | --------- | --------- |
| 年   | `2015`    | `2015`    |
| 季   | `2025Q1`  | `2025Q1`  |
| 月   | `2025-01` | `2025-01` |

`retrievedAt` 为 ISO 8601 UTC。

---

## 8. 仓库结构

```text
china-nbs/
├─ src/ (18 modules)
├─ test/ (6 test files + fixtures)
├─ scripts/smoke.ts
├─ scripts/eval.ts
├─ scripts/eval-cases.ts
├─ examples/
├─ docs/contracts.md
├─ docs/data-semantics.md
├─ docs/rate-limit.md
├─ docs/evaluation.md
├─ .github/workflows/ci.yml
├─ package.json / tsconfig.json / tsup.config.ts / vitest.config.ts / biome.json
├─ README.md / CONTRIBUTING.md / CHANGELOG.md / LICENSE / PROJECT.md
```

---

## 9. 里程碑

### M0：项目书（2026-11-03）✅

- 调研新旧接口
- 确认数据源可用
- 确定工具形态

### M1：v0.1 MVP（2026-11-03）✅

- 项目初始化、TypeScript、tsup、Vitest、Biome
- `client.ts`：fetch、超时、重试、串行限流、缓存
- `resolver.ts`：curated + 搜索排序 + 树回退 + 歧义
- `series.ts`：年度/季度/月度，CPI 4 分片合并
- `compare.ts`：分省年度
- `catalog.ts`：分类树
- `format.ts`：text/table/json
- CLI：search/series/compare/catalog
- 36 个单元/集成测试
- 接口契约文档、fixtures、README

**验收（已通过）：**

```bash
node dist/cli.js search GDP --period year
# 2025 年 1,401,879.2 亿元

node dist/cli.js series GDP --start 2015 --end 2025
# 11 个年度点

node dist/cli.js series CPI --start 2025-01 --end 2025-10
# 10 个月度点

node dist/cli.js compare GDP --regions 广东,江苏,浙江 --year 2025
# 3 个省，2025 年数值

node dist/cli.js catalog --code 3 --depth 2
# 年度分类树
```

### M2：v0.2 地区与分片完善（2–3 天）

**M2-A（分省月/季）✅ 已完成：**

- 分省月度/季度 `code=4/5` 接入，`resolver` / `compare` 不再拦截
- 分省季度 GDP（累计值）curated
- 分省月度 CPI 4 个分片 curated
- `catalog` 支持 `code=1-9`
- 新增 10 个测试

**M2-B（指标覆盖）✅ 已完成：**

- curated 从 10 个扩到 **160 个**
- 覆盖社零、固投、收入、消费、财政、粮食、进出口、工业、失业率、房地产、建筑业、能源、交通邮电、金融、教育、卫生、环境、分行业 PPI、网上零售等
- 新增 36 个主要城市年度（`code=8`）和城市 GDP curated
- 通用解析：完整名称匹配、限定词评分、分类树提示词扩展、叶子 n-gram 排序
- 评测集 **198 条**：189 条 curated + 9 条 fallback；curated 100%，fallback top-1 9/9
- 新增 7 个测试（M2-B 结束时总计 53 个）

**M2-C 已完成：**

- 通用分片发现：分类树叶子带年份范围时，自动查找同父节点的兄弟分片并按指标名匹配
- `compare` 明确为**单指标多地区**；多指标请分多次调用
- NOT_FOUND 负缓存（5 分钟）
- 熔断器（连续 5 次可重试失败，冷却 30 秒，可配置）
- 代理注入：库层 `fetchImpl` / `dispatcher`，CLI `--proxy`（可选 `undici`）
- 港澳台/部门/国际/普查数据仍受上游可用性限制，未纳入
- 新增 5 个测试（总计 58 个）

### M3：v0.3 / v0.4 开源发布

- ✅ MCP server：`china-nbs mcp` / `china-nbs-mcp`，4 个工具，stdio transport
- ✅ npm 发布（0.3.0 已发布；0.4.0 待发布）
- ✅ README 完整版、示例、徽章
- ⏳ provenance / GitHub Release / Issue 模板 / 月度 smoke cron

### M4：v1.0 稳定版

- API 冻结
- 覆盖 20+ 常用指标
- 英文 README
- 社区反馈修复
- 性能与稳定性优化

---

## 10. 测试与验收

### 10.1 单元/集成测试

固定 fixture，不依赖线上：

- 搜索排序：GDP/CPI/人口/省份
- 歧义处理：GDP 总量 vs 贡献率 vs 人均
- 分片合并：CPI 2025-01–10、2025/2026 边界、部分失败
- 分省季度 GDP、分省月度 CPI 分片、分省 compare
- 主要城市年度 GDP curated、城市分类树兜底
- 地区映射：广东/江苏/浙江/广州；从 query 推断省份/城市
- 格式化：文本、表格、JSON
- 错误处理：403、500、非 JSON、业务失败
- 缓存：同 key 只请求一次
- 类型/参数：catalog 非法 code、NOT_FOUND、AMBIGUOUS
- 覆盖率：189 条 curated + 9 条 fallback 用例

当前：63 个测试 + 189 条 curated 评测全部通过；9 条 fallback 在线 top-1 9/9。

### 10.2 真实接口冒烟

`npm run smoke`，手动执行，不在 CI 中跑：

1. 搜索 GDP，断言非空、无非空值；
2. GDP 2020–2025，断言 6 个点；
3. CPI 2025-01–10，断言 10 个点；
4. 广东 GDP 2025Q1–2026Q3，断言 7 个点；
5. 广东 CPI 2025-01–10，断言 10 个点；
6. 广东/江苏/浙江 2025Q1–Q4 GDP，断言 3 条序列；
7. 分类树 code=3，断言节点非空；
8. 分类树 code=4，断言根节点为分省月度数据；
9. 广州 GDP 2023–2024，断言 2 个点、地区为广州市；
10. 全国居民人均消费支出 2020–2025，断言 6 个点。

**不硬编码具体数值**；数值只放在 fixture。

### 10.2b 覆盖率评测

`npm run eval` 离线测 curated，`npm run eval:live` 测真实解析：

```text
curated fast path: 159 cases
top-1: 189/189 (100.0%)
top-3: 189/189 (100.0%)

live resolver: 168 cases
top-1: 198/198 (100.0%)
top-3: 198/198 (100.0%)
fallback: 9/9
```

评测集覆盖全国/分省/主要城市、年/季/月、总量/累计/增速，并单独保留 9 条非 curated fallback 用例来测搜索/分类树。详见 `docs/evaluation.md`。

### 10.3 qbot 验收

- `stats` 工具注册成功，工具箱 9 个。
- “2025 年中国 GDP 是多少” → 1,401,879.2 亿元（或官方修订后数值）。
- “今年 1 到 10 月 CPI” → 月度序列。
- “广东 2025 年 GDP” → 145,846.8 亿元（或修订后）。
- 403/超时 → 明确说“数据库暂时没取到”，不编造。
- 不影响现有 8 个工具。

---

## 11. 开源与发布

- GitHub：`china-nbs`，默认分支 `main`。
- License：MIT（代码）；数据版权归国家统计局。
- README 顶部声明：非官方项目，接口可能变化。
- npm：`china-nbs`（发布前查重）；从 `0.1.0` 开始；changesets 管理版本。
- CI：Node 22/24，`npm ci`、lint、typecheck、test、build。
- 文档：README、`docs/contracts.md`、`docs/data-semantics.md`、`docs/rate-limit.md`、CHANGELOG、CONTRIBUTING。

---

## 12. 风险与合规

### 12.1 技术风险

| 风险              | 影响         | 对策                                         |
| ----------------- | ------------ | -------------------------------------------- |
| 接口改版          | 查询失败     | provider 抽象、contracts、fixtures、冒烟测试 |
| WAF 拦截          | 403          | 串行、2s 间隔、缓存、不重试、回退 web        |
| 试运行期不稳定    | 5xx          | 重试、超时、明确错误                         |
| 搜索噪声          | 选错指标     | curated + 排序 + 歧义候选                    |
| 分片复杂          | 长序列缺失   | 分片合并、部分结果、notes                    |
| 数据修订          | 数值变化     | `retrievedAt`、提示初步数                    |
| 月度 CPI 搜索缺失 | 解析失败     | 分类树回退 + curated                         |
| `code=6` 搜索为空 | 分省解析失败 | 直接走分类树                                 |

### 12.2 合规风险

- 国家统计局服务条款允许下载和使用已发布统计数据，要求依法、准确使用并注明来源。
- 英文 FAQ 明确“not for commerce purpose”。
- 本项目定位为非商业开源工具；README 和输出都注明“来源：国家统计局”。
- 不批量镜像、不转售、不删除来源标识。
- 不抓取非公开数据、不绕过登录/WAF。
- 代码 License 只覆盖代码，不覆盖数据。
- 不使用国家统计局徽标/网站标识作为 Logo。

---

## 13. 成功指标

### 13.1 功能指标

- 常用指标查询准确率 ≥ 95%（GDP、CPI、人口、失业率、社零、固投、收入、省份数据）
- 时间序列覆盖最近 10 年
- 分省数据覆盖 34 个地区（含港澳台）；主要城市年度覆盖 36 个
- `AMBIGUOUS` 能给出可选候选，而不是瞎猜
- 覆盖率：160 个 curated；189 条 curated + 9 条 fallback 评测；curated 100%，整体在线 100.0%

准确率如何测：`scripts/eval-cases.ts` 维护 198 条用例，标注期望 `cid:indicId` 或 curated key，统计 top-1/top-3；其中 9 条专门测非 curated 的搜索/分类树。新增指标必须补用例。

### 13.2 性能指标

- 缓存命中 < 10ms
- 单请求 P50 < 1.5s，P95 < 5s
- 4 分片月度序列 < 15s
- 连续查询不触发 WAF

### 13.3 开源指标

- GitHub CI 全绿
- npm 可安装、CLI 可运行
- 新用户 5 分钟跑通
- 至少 3 个真实使用案例（qbot + CLI + 1 个外部项目）

---

## 14. 资源与成本

| 项           | 成本                              |
| ------------ | --------------------------------- |
| 开发         | 1 人，M1 约 1–2 天，完整版 5–8 天 |
| 服务器       | 0，公共接口                       |
| 数据库       | 0，进程内缓存                     |
| npm / GitHub | 免费                              |
| 维护         | 每月检查接口和冒烟测试            |

---

## 15. 待确认问题

1. 分省月度/季度 `code=4/5` 已确认；是否在 v0.2 一并支持主要城市（`7/8`）和港澳台（`9`）？
2. compare 是否支持多指标？当前只支持多地区。
3. MCP 用 optional peer 还是独立包？
4. npm 包名 `china-nbs` 是否可用？是否需要 scope？
5. 第一版是否直接发布 npm，还是先 GitHub 源码 + 本地引用？
6. README 先中文，还是中英双语？
7. 是否需要 CSV 导出？
8. qbot 部署环境（Node 版本、并发、群规模）需要补充，以便校准限流。

---

## 附录 A：接口速查

```text
Base: https://data.stats.gov.cn/dg/website/publicrelease/web/external

GET  /query?search=GDP&pagenum=1&pageSize=50&code=3
GET  /new/queryIndexTreeAsync?pid=&code=3
GET  /new/queryIndicatorsByCid?cid=<cid>&dt=&name=
POST /stream/esData
GET  /getAllProvince
```

数据请求体：

```json
{
  "cid": "<cid>",
  "indicatorIds": ["<indicatorId>"],
  "daCatalogId": "",
  "das": [{ "text": "全国", "value": "000000000000" }],
  "showType": "1",
  "dts": ["2015YY-2025YY"],
  "rootId": "69c574ab128a44e595cc0b24502b771b"
}
```

`code`：

| code | 数据             |
| ---- | ---------------- |
| 1    | 全国月度         |
| 2    | 全国季度         |
| 3    | 全国年度         |
| 4    | 分省月度         |
| 5    | 分省季度         |
| 6    | 分省年度         |
| 7    | 主要城市月度价格 |
| 8    | 主要城市年度     |
| 9    | 港澳台月度       |

## 附录 B：已实测数据

```text
全国 GDP 年度
2025：1,401,879.2 亿元
2024：1,348,066.2 亿元
2023：1,294,271.7 亿元
2022：1,234,029.4 亿元
2021：1,173,823.0 亿元
2020：1,034,867.6 亿元

广东 GDP 年度
2025：145,846.8 亿元
2024：141,488.9 亿元
2023：137,905.4 亿元

江苏 GDP 2025：142,351.5 亿元
浙江 GDP 2025：94,545.0 亿元

全国 CPI 月度（上年同月=100）
2025-10：100.2
2025-09：99.7
2025-08：99.6
2025-07：100.0
2025-01：100.5

全国年末总人口
2025：140,489 万人
2024：140,828 万人

广东年末常住人口
2025：12,859 万人

广东 GDP 季度（累计值）
2026Q3：111,091 亿元
2025Q4：145,847 亿元

广东 CPI 月度（上年同月=100）
2025-10：100.3
2025-01：100.5

全国社会消费品零售总额
2025：501,202.4 亿元

全国固定资产投资（不含农户）
2025：485,186.47 亿元

全国居民人均可支配收入
2025：43,377 元
```

> 数值会随官方修订变化；fixtures 用于精确断言，线上 smoke 只断言结构。

## 附录 C：M2 实现状态

| 项                       | 状态                    |
| ------------------------ | ----------------------- |
| `query()` + 4 actions    | ✅                      |
| 搜索排序 + 歧义候选      | ✅                      |
| `indicatorId` 消歧       | ✅                      |
| 全国年度/季度/月度       | ✅                      |
| 分省年度/季度/月度       | ✅                      |
| 主要城市年度（36 个）    | ✅                      |
| CPI 4 分片合并           | ✅                      |
| 160 个 curated           | ✅                      |
| 159 curated + 9 fallback | ✅                      |
| 63 个测试                | ✅                      |
| 接口契约文档 + fixtures  | ✅                      |
| 通用分片发现             | ✅ 0.3.0                |
| compare 多指标           | ✅ 明确只做单指标多地区 |
| 港澳台/部门/国际/普查    | ⏳ 后续                 |
| MCP                      | ⏳ M3                   |
| npm 发布                 | ⏳ M3                   |
