# 国家统计局新版接口契约（实测）

> 实测日期：2026-11-03  
> 环境：Node.js 24 / Windows，本地网络  
> 结论：新版接口可用、无需 API Key/Cookie；返回 JSON，但 `Content-Type` 常为 `text/html`，不要按 content-type 判断。

## 1. 完整 URL

Base URL：

```text
https://data.stats.gov.cn/dg/website/publicrelease/web/external
```

| 功能 | 方法 | 完整路径 | 关键参数 |
|---|---|---|---|
| 关键词搜索 | GET | `/query` | `search`、`pagenum`、`pageSize`、`code` |
| 分类树 | GET | `/new/queryIndexTreeAsync` | `pid`、`code` |
| 指标列表 | GET | `/new/queryIndicatorsByCid` | `cid`、`dt`、`name` |
| 数据查询 | POST | `/stream/esData` | `cid`、`indicatorIds`、`das`、`dts`、`rootId` |
| 省份列表 | GET | `/getAllProvince` | 无 |

注意：

- 搜索的完整 URL 是 `.../external/query`，**不是** `.../web/query`（后者实测 404）。
- 旧 EasyQuery `easyquery.htm?m=QueryData` 实测 403（WAF `reason:UrlACL`），不作为 fallback。
- `rootId` 实测固定为 `69c574ab128a44e595cc0b24502b771b`；如果未来变化，从首页/响应中重新获取。
- 请求头建议：`User-Agent`（浏览器 UA）、`Referer: https://data.stats.gov.cn/`、`X-Requested-With: XMLHttpRequest`。实测不带 Cookie 也可以。

## 2. 搜索 `/query`

### 请求

```text
GET /query?search=GDP&pagenum=1&pageSize=50&code=3
```

`code`：

| code | 数据 | 实测 |
|---|---|---|
| `1` | 全国月度 | 可用；搜索质量一般，CPI 月度用分类树更可靠 |
| `2` | 全国季度 | 可用 |
| `3` | 全国年度 | 可用 |
| `4` | 分省月度 | 搜索未验证；分省请走分类树 |
| `5` | 分省季度 | 搜索未验证；分省请走分类树 |
| `6` | 分省年度 | `count` 有值但 `data` 为空，不能依赖；分省请走分类树 |

`pageSize` 实测 50 可用；`pageSize=2` 会返回多于 2 条，不要假设严格分页。

### 响应

```json
{
  "data": {
    "types": [{ "name": "年度数据", "code": "3", "dtType": "YY" }],
    "data": [
      {
        "explain": null,
        "indic_id": "7dc6a2ee6c614960b7059991e0cc4d96",
        "ek": "db8e5a86c08246e79b1b11251927e740",
        "type_text": "年度数据",
        "show_name": "国内生产总值 (亿元) ",
        "i": "...",
        "type_value": "3",
        "da_name": "全国",
        "dt": "2025",
        "dt_name": "2025年",
        "treeinfo_globalid": "69c...",
        "i_name": "国内生产总值",
        "dt_type": "YY",
        "da": "000000000000",
        "value": "1401879.2",
        "ek_name": "国内生产总值",
        "cid": "f7fd25aaad184414875632cf2327da60"
      }
    ],
    "count": 426
  },
  "success": true,
  "state": 20000,
  "message": "成功"
}
```

关键字段：

| 字段 | 说明 |
|---|---|
| `indic_id` | 指标 id，数据查询时放进 `indicatorIds` |
| `cid` | 数据集/目录 id，数据查询时作为 `cid` |
| `i_name` | 指标名（可能为 `null`，尤其是同指标的历史期） |
| `show_name` | 展示名，含单位/口径，如 `国内生产总值 (亿元)` |
| `dt_type` | `YY` 年、`SS` 季、`MM` 月 |
| `dt` / `dt_name` | API 时间码 / 中文时间 |
| `da` / `da_name` | 地区码 / 地区名 |
| `value` | 最新值字符串；可能为空 |
| `type_value` | 1 月、2 季、3 年、6 分省年 |

实测特征：

- 同一指标会按连续年份重复出现（例如 2024、2025 各一条），`i_name` 可能只有最新一条非空。解析时按 `cid:indic_id` 去重，保留最新 `dt` 和非空名称。
- `search=GDP` 返回 426 条（2026-11-03），前几条是“贡献率/指数”，不是 GDP 总量；必须做本地排序。
- 库只取第一页（默认 `pageSize=50`）并配合 curated/分类树回退；不会为了一个关键词翻完 43 页。
- `search=居民消费价格指数&code=3` 返回 237 条，都是年度；月度 CPI 不在搜索结果里，需走分类树。
- `search=CPI&code=1` 会返回 PMI 价格指数等噪声，不能用它解析月度 CPI。

## 3. 分类树 `/new/queryIndexTreeAsync`

### 请求

```text
GET /new/queryIndexTreeAsync?pid=&code=3
GET /new/queryIndexTreeAsync?pid=884c062607104a91967b22742537f44f&code=3
```

`pid` 为空返回该 `code` 的根节点；再用根节点 `_id` 作为 `pid` 展开。

### 响应

```json
{
  "data": [
    {
      "name": "国民经济核算",
      "type": "catalog",
      "isLeaf": false,
      "treeinfo_pid": "884c062607104a91967b22742537f44f",
      "treeinfo_level": 3,
      "treeinfo_globalid": "69c...884c....xxxx",
      "sdate": null,
      "edate": null,
      "_id": "bf4fb427305c4d7ba5a00562c8a4a621"
    }
  ],
  "success": true,
  "state": 20000,
  "message": "成功"
}
```

关键字段：

| 字段 | 说明 |
|---|---|
| `_id` | 节点 id；叶子节点的 `_id` 就是指标列表的 `cid` |
| `name` | 节点名 |
| `isLeaf` | 是否叶子 |
| `treeinfo_pid` | 父节点 id |
| `treeinfo_level` | 层级 |
| `sdate` / `edate` | 分片起止年份；月/季分片也有 |

实测根节点：

| code | 根节点 | `_id` |
|---|---|---|
| 1 | 月度数据 | `fc982599aa684be7969d7b90b1bd0e84` |
| 2 | 季度数据 | `a94b8b7365a94874968cabbe392cf679` |
| 3 | 年度数据 | `884c062607104a91967b22742537f44f` |
| 4 | 分省月度数据 | `f4c6cd795fea436c807163397dd36b98` |
| 5 | 分省季度数据 | `854f819b04104191a5ae2f2cba270e6c` |
| 6 | 分省年度数据 | `c4d82af16c3d4f0cb4f09d4af7d5888e` |
| 7 | 主要城市月度价格 | `327ecbb2e6b14c669da1e99e39faa24c` |
| 8 | 主要城市年度数据 | `2d06bab01494417e9052ef0f8d93e23e` |
| 9 | 港澳台月度数据 | `bbf7c2c592a140e295423bc2e7f5cd36` |

**`code` 按“范围 × 频率”组合，而不是只按频率：**

| 范围 | 月度 | 季度 | 年度 |
|---|---|---|---|
| 全国 | 1 | 2 | 3 |
| 分省 | 4 | 5 | 6 |
| 主要城市 | 7（36/70 城汇总价格） | — | 8 |
| 港澳台 | 9 | — | — |

这意味着 `code=6` 只能用于分省年度；分省月度/季度必须用 `code=4/5`。搜索接口对 `code=4/5` 的行为尚未验证，分省仍应优先走分类树。

主要城市年度 `code=8` 使用标准行政区划码 + `000000` 作为 `das`，例如广州 `440100000000`（实测 2024 年 GDP 可查）。`code=7` 的指标是“36 个城市居民消费价格分类指数”，是汇总指数，不是单城市 CPI。

## 4. 指标列表 `/new/queryIndicatorsByCid`

### 请求

```text
GET /new/queryIndicatorsByCid?cid=809d2522b0fe4be89142650341b19083&dt=&name=
```

### 响应

```json
{
  "data": {
    "total": 13,
    "list": [
      {
        "_id": "4ae9047687934a6390984c21d6ddab96",
        "_name": "居民消费价格指数",
        "i_showname": "居民消费价格指数 (上年同月=100) ",
        "du_name": "%",
        "dp": "1",
        "dp_name": "本期",
        "kj1_name": "上年同月=100",
        "catalogid": "809d2522b0fe4be89142650341b19083",
        "daterange_sdate": "2021-01-01 00:00:00",
        "daterange_edate": "2025-01-01 00:00:00"
      }
    ]
  },
  "success": true,
  "state": 20000,
  "message": "成功"
}
```

关键字段：

| 字段 | 说明 |
|---|---|
| `_id` | 指标 id，数据查询时放进 `indicatorIds` |
| `_name` | 指标名 |
| `i_showname` | 展示名，含口径/单位 |
| `du_name` | 单位（可能是 `无`） |
| `dp` / `dp_name` | 当季/累计等维度 |
| `kj1_name` / `kj2_name` / `kj3_name` | 口径，如 `上年同月=100` |
| `catalogid` | 数据集 id，通常等于请求的 `cid` |
| `daterange_sdate` / `daterange_edate` | 指标覆盖范围 |

注意：分片的指标 id **可能不同**。例如月度 CPI：

| 分片 | cid | 指标 id |
|---|---|---|
| 2026- | `5c7452825c7c4dcba391db5ca7f335c5` | `53180dfb9c14411ba4b762307c85920c` |
| 2021–2025 | `809d2522b0fe4be89142650341b19083` | `4ae9047687934a6390984c21d6ddab96` |
| 2016–2020 | `9d4eec43537742a7ab5d63db97fa2f51` | `e5c318ffdbbc4d38898e52b52267eb25` |
| –2015 | `954cfd7597e34b919ec71caf6aeead51` | `4c1065dd4e984b25a21190c843551697` |

## 5. 数据 `/stream/esData`

### 请求

```json
POST /stream/esData
{
  "cid": "f7fd25aaad184414875632cf2327da60",
  "indicatorIds": ["7dc6a2ee6c614960b7059991e0cc4d96"],
  "daCatalogId": "",
  "das": [{ "text": "全国", "value": "000000000000" }],
  "showType": "1",
  "dts": ["2015YY-2025YY"],
  "rootId": "69c574ab128a44e595cc0b24502b771b"
}
```

`dts`：

| 频率 | 单点 | 区间 |
|---|---|---|
| 年度 | `2025YY` | `2015YY-2025YY` |
| 季度 | `202603SS` | `202501SS-202603SS` |
| 月度 | `202510MM` | `202501MM-202510MM` |

### 响应

```json
{
  "data": [
    {
      "code": "2025YY",
      "name": "2025年",
      "values": [
        {
          "_id": "7dc6a2ee6c614960b7059991e0cc4d96",
          "_name": "国内生产总值",
          "i_showname": "国内生产总值 (亿元) ",
          "du_name": "亿元",
          "value": "1401879.2",
          "da": "000000000000",
          "da_name": "全国",
          "dp": "1",
          "catalogid": "f7fd25aaad184414875632cf2327da60"
        }
      ]
    }
  ],
  "success": true,
  "state": 20000,
  "message": "成功"
}
```

实测：

- `dts` 返回按时间倒序；库会重新排序。
- 未发布的时间点会返回 `value: ""`，库会省略末尾空值。
- `das` 传多个地区时，实测**只返回第一个地区**；`compare` 因此对每个地区单独发请求。
- 省份码来自 `/getAllProvince`，如广东省 `440000000000`、江苏省 `320000000000`、浙江省 `330000000000`。
- 分省月度/季度使用同一 `/stream/esData` 请求体，只是 `cid` / `indicatorIds` 来自 `code=4/5` 分类树的叶子。
- 分省季度 GDP 只有累计值（如广东 2026Q3 = 111,091 亿元），没有当季值。
- `showType: "1"` 可以工作；`daCatalogId` 为空可以工作。

## 6. 省份 `/getAllProvince`

```json
{
  "data": [
    { "text": "北京市", "value": "110000000000" },
    { "text": "广东省", "value": "440000000000" },
    { "text": "台湾省", "value": "710000000000" },
    { "text": "香港特别行政区", "value": "810000000000" },
    { "text": "澳门特别行政区", "value": "820000000000" }
  ],
  "success": true,
  "state": 20000,
  "message": "成功"
}
```

实测共 **34** 个地区（31 个省级行政区 + 台湾 + 香港 + 澳门），不是 31 个。

主要城市不在这个接口里；`code=8` 的城市年度数据使用标准行政区划码 + `000000`（如广州 `440100000000`）。上游只提供 36 个主要城市（4 个直辖市按省级处理 + 32 个地级市），不能靠扩展列表增加城市数据。

## 7. 错误响应

- `403`：WAF 拦截，HTML 或空响应。不要重试、不要换 IP 绕过。
- `404`：路径错误（例如 `/web/query`）。
- `500`：Spring Boot 风格 JSON：

```json
{
  "timestamp": "2026-11-03T09:06:42.212+00:00",
  "path": "/dg/website/publicrelease/web/external/stream/esData",
  "status": 500,
  "error": "Internal Server Error",
  "message": "",
  "requestId": "c3b8d023-5419594"
}
```

- `429`：限流；等待后重试。
- HTTP 200 但 `success: false` 或 `state != 20000`：按上游错误处理。

## 8. 已验证样例

| 查询 | 结果 |
|---|---|
| 全国 GDP 年度 2015–2025 | 11 个点；2025 = 1,401,879.2 亿元 |
| 全国 GDP 季度 2025Q1–2026Q3 | 累计值/当季值均可查 |
| 全国 CPI 月度 2025-01–2025-10 | 10 个点；100.5 → 100.2 |
| 广东 GDP 年度 2020–2025 | 2025 = 145,846.8 亿元 |
| 广东 GDP 季度 2024Q1–2026Q3（code=5） | 累计值；2026Q3 = 111,091 亿元 |
| 广东 CPI 月度 2025-01–2025-10（code=4） | 10 个点；2025-10 = 100.3 |
| 全国社会消费品零售总额 2015–2025 | 2025 = 501,202.4 亿元 |
| 全国固定资产投资（不含农户）2015–2025 | 2025 = 485,186.47 亿元 |
| 全国居民人均可支配收入 2015–2025 | 2025 = 43,377 元 |
| 江苏 GDP 2025 | 142,351.5 亿元 |
| 浙江 GDP 2025 | 94,545.0 亿元 |
| 年度分类树 code=3 | 28 个一级分类 |
| 分类树 code=4/5/7/8/9 | 分省月度/季度、主要城市、港澳台均确认存在 |
| 省份列表 | 34 个地区 |

> 数值会随官方修订变化；测试中的精确值用于固定 fixture，线上冒烟测试只断言结构和“最新年份存在”。
