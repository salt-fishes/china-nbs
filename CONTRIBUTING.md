# Contributing

欢迎补充指标别名、fixtures 和文档。这个项目最容易出错的地方不是代码，而是**口径**和**上游契约**。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build
npm run eval     # 离线评测 curated
npm run smoke    # 手动跑真实接口
```

## 添加一个常用指标

1. 用真实接口确认 `cid` 和 `indicatorId`（见 `docs/contracts.md`）。
2. 在 `src/curated.ts` 增加一个 `CuratedEntry`：
   - `aliases` 只放**完整等价**的说法；不要把 `GDP指数` 这样的限定词放进去。
   - `frequency`、`regionScope`、`measure` 要和指标实际口径一致。
   - 分片指标在 `shards` 中写清每个分片的 `cid`、`indicId`、起止年份。
3. 在 `test/fixtures/` 放固定响应；测试不要依赖线上接口。
4. 在 `test/resolver.test.ts` 或 `test/series.test.ts` 增加断言。
5. 在 `scripts/eval-cases.ts` 增加至少一条查询用例（`expectedKey`）。
6. 更新 `docs/data-semantics.md`（如果涉及口径）和 `CHANGELOG.md`。

## 添加一个别名

- 别名表在 `src/aliases.ts`。
- 只加真正等价的缩写，例如 `社零` → `社会消费品零售总额`。
- 有口径差异的词（同比/累计/当季/不变价/人均/贡献率）不要互相映射。

## 修改解析/排序

- 先加 fixture，再改 `scoreRecord`。
- 任何新的“默认偏好”都要有测试，尤其是：
  - GDP 总量 vs 贡献率/指数/人均/不变价
  - CPI 年度 vs 月度
  - 人口总数 vs 男性/女性/城镇/乡村
- 不确定时返回 `AMBIGUOUS`，不要猜。

## 上游礼貌

- 不要提高默认并发；不要移除 2 秒间隔。
- 不要加“绕过 WAF/换 IP/伪造 Cookie”的逻辑。
- 403 不重试；429/5xx 最多重试一次。
- 新增请求前先考虑缓存和请求预算。

## PR 检查

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run eval`
- [ ] 如涉及真实接口，手动跑过 `npm run smoke`
- [ ] 文档/CHANGELOG 已更新
