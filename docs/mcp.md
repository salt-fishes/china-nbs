# MCP Server

`china-nbs` 提供一个基于 stdio 的 MCP server，把查询能力暴露成 4 个工具。核心包仍然零运行时依赖；MCP 相关依赖是可选的。

## 安装

```bash
npm install -g china-nbs @modelcontextprotocol/sdk zod
china-nbs mcp
```

或项目内：

```bash
npm install china-nbs @modelcontextprotocol/sdk zod
npx china-nbs mcp
```

也可以直接运行独立入口：

```bash
npx china-nbs-mcp
```

> `npx china-nbs mcp` 不会自动安装可选 peer 依赖。缺少依赖时 CLI 会提示安装 `@modelcontextprotocol/sdk` 和 `zod`。

## 客户端配置

Claude Desktop / Cursor（stdio）：

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

## 工具

| 工具 | 作用 | 主要参数 |
|---|---|---|
| `nbs_search` | 搜索指标并返回最新数据点 | `query`、`region`、`period`、`limit` |
| `nbs_series` | 查询一个指标的时间序列 | `query`、`region`、`period`、`start`、`end`、`maxPoints`、`indicatorId` |
| `nbs_compare` | 对比多个地区的同一指标 | `query`、`regions`、`period`、`start`、`end`、`maxPoints`、`indicatorId` |
| `nbs_catalog` | 浏览分类树 | `code`、`pid`、`depth` |

`period` 支持 `year`、`quarter`、`month`。`region` 支持全国、34 个分省和官方 36 个主要城市。

`nbs_compare` 只支持**单指标多地区**；多指标请分多次调用，最多 8 个地区。

## 返回格式

每个工具返回 `QueryResult` 的 JSON 文本，例如：

```json
{
  "ok": true,
  "action": "series",
  "indicator": {
    "displayName": "国内生产总值 (亿元)",
    "frequency": "year",
    "region": "全国"
  },
  "points": [
    { "period": "2025", "value": 1401879.2, "unit": "亿元" }
  ],
  "source": {
    "name": "国家统计局",
    "url": "https://data.stats.gov.cn/",
    "retrievedAt": "2026-11-04T00:00:00.000Z"
  }
}
```

失败时 `isError: true`，内容仍是结构化错误：

```json
{
  "ok": false,
  "error": {
    "code": "AMBIGUOUS",
    "message": "找到多个可能的指标",
    "retryable": false
  },
  "candidates": [
    { "id": "cid:indicId", "displayName": "..." }
  ]
}
```

遇到 `AMBIGUOUS` 时，客户端应把 `candidates` 展示给用户，选定后把 `candidates[].id` 作为 `indicatorId` 再调用 `nbs_series` 或 `nbs_compare`。

## 限制

- 只支持 stdio transport，不内置 HTTP/SSE server。
- 数据来自国家统计局公开接口，受上游限流和试运行期稳定性影响。
- 不承诺覆盖全部 7.6 万个指标；长尾指标走搜索/分类树，可能返回 `AMBIGUOUS` 或 `NOT_FOUND`。
- 不要用 MCP server 做批量镜像、转售或绕过 WAF。
