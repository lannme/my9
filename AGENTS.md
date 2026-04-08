# 仓库指南（My9）

本指南面向贡献者与自动化代理，目标是与当前代码库实践保持一致。

## 项目结构与模块组织

- `app/page.tsx`：首页（类型选择入口）。
- `app/[kind]/page.tsx`：填写页。
- `app/[kind]/s/[shareId]/page.tsx`：分享只读页。
- `app/trends/page.tsx`：趋势页。
- `app/api/`：API 路由（`share/`、`subjects/`、`trends/`、`cron/`、`stats/`）。
- `app/components/`：主业务组件（`My9V3App.tsx`、`My9ReadonlyApp.tsx`、`TrendsClientPage.tsx`、`v3/*`）。
- `components/layout/`：布局组件（`SiteFooter.tsx`）。
- `components/share/`：分享相关组件（`ShareLinkDialog.tsx`、`ShareImagePreviewDialog.tsx`、`SharePlatformActions.tsx`）。
- `components/subject/`：条目组件（`SubjectKindIcon.tsx`）。
- `components/ui/`：基础 UI 组件（`button.tsx`、`dialog.tsx`、`input.tsx`）。
- `components/GoogleAnalytics.tsx`：GA 注入。
- `lib/bgg/`：BoardGameGeek 搜索与 API 封装（`search.ts`、`bgg-api.ts`、`local-search.ts`、`route.ts`）。
- `lib/share/`：分享存储领域逻辑（`storage.ts`、`trends.ts`、`trends-query.ts`、`archive.ts`、`cold-storage.ts`、`view-stats.ts`、`types.ts`）。
- `lib/search/query.ts`：通用搜索查询处理。
- `lib/subject-kind.ts`：类型定义与映射。
- `lib/subject-source.ts`：内容源定义。
- `lib/utils.ts`：工具函数（含 `cn()` 类名合并）。
- `lib/site-url.ts`：站点 URL 解析。
- `utils/image/exportShareImage.ts`：分享图导出。
- `tests/v3-interaction.spec.ts`：主交互 E2E 用例。
- `tests/layout-mobile-fill.spec.ts`：移动端布局 E2E 用例。
- `docs/`：运维与排障文档（`share-storage-v2-ops.md`、`content-source-contribution.md`、`cloudflare-auto-deploy.md` 等）。
- `scripts/`：迁移/归档/校验/构建脚本。
- `worker.js`：Cloudflare Workers 入口（含 Cron 调度）。
- `wrangler.jsonc`：Cloudflare Workers 配置。
- `open-next.config.ts`：OpenNext Cloudflare 构建配置。
- `next.config.mjs`：Next.js 配置。
- `tailwind.config.js`：Tailwind CSS 配置。
- `tsconfig.json`：TypeScript 配置（strict 模式，路径别名 `@/*`）。
- `playwright.config.ts`：Playwright 配置。
- `eslint.config.mjs`：ESLint flat config。
- `components.json`：shadcn/ui 组件配置。

## 构建、开发与测试命令

常用开发流程：

```bash
npm install          # 安装依赖（建议 Node 20.9+）
npm run dev          # 本地开发（默认 http://localhost:3000）
npm run build        # 生产构建
npm start            # 启动生产构建产物
npm run lint         # 运行 ESLint
npm run test:e2e     # 运行 Playwright E2E
```

Cloudflare Workers 部署：

```bash
npm run cf:verify-access   # 只读核验 Cloudflare token/zone/routes/R2 对齐
npm run cf:build           # 执行 OpenNext Cloudflare 构建（输出 .open-next/）
npm run cf:build:test      # 按 wrangler.jsonc 的 env.test 生成测试域产物
npm run cf:preview         # 先构建，再通过 Wrangler 本地预览 Worker
npm run cf:deploy          # 先构建，再部署到 Cloudflare Workers
npm run cf:deploy:test     # 构建并部署到 my9test.shatranj.space
```

运维脚本：

```bash
node scripts/migrate-shares-v1-to-v2.mjs       # v1 迁移到 v2 存储模型
node scripts/verify-shares-v2-migration.mjs     # 校验迁移覆盖率
node scripts/rebuild-trends-kind-v3.mjs         # 重建 kind 粒度趋势表
node scripts/archive-shares-cold.mjs            # 归档 30 天前热数据到 R2
```

仓库以 `npm` + `package-lock.json` 为准，避免切换包管理器引发锁文件噪音。

## Agent 端口与测试约定（强约束）

- `3000` 端口保留给开发者手动调试，自动化代理不得占用、停止或清理该端口进程。
- 自动化测试统一使用 `3001`。
- Playwright 通过 `scripts/playwright-webserver.cjs` 启动：
  - 使用独立构建目录 `.next-e2e`
  - 启动端口 `3001`
- 不要删除或覆盖开发者本地使用的 `.next`。

## 代码风格与实现约定

- 语言：TypeScript（`strict`），路径别名 `@/*`（见 `tsconfig.json`）。
- 样式：Tailwind CSS（`tailwind.config.js`）；使用 `cn(...)` 合并类名（定义在 `lib/utils.ts`）。
- 组件与文件命名遵循现有风格（PascalCase 组件，`components/ui/` 下文件名小写）。
- 优先做最小改动，保持当前交互与文案风格一致。

## 测试实践（当前状态）

- 本仓库已配置 Playwright（`playwright.config.ts`）。
- 新增/修改交互时，优先补充或更新 `tests/v3-interaction.spec.ts`。
- 涉及布局问题时，可补截图验证（保存到 `screenshot/`）。

## 环境变量与外部服务

在 `.env.local`（勿提交）中配置：

```bash
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
BANGUMI_ACCESS_TOKEN=
BANGUMI_USER_AGENT=
NEON_DATABASE_PGHOST_UNPOOLED=    # 或 NEON_DATABASE_PGHOST
NEON_DATABASE_PGUSER=
NEON_DATABASE_PGPASSWORD=         # 或 NEON_DATABASE_POSTGRES_PASSWORD
NEON_DATABASE_PGDATABASE=         # 或 NEON_DATABASE_POSTGRES_DATABASE
R2_ENDPOINT=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
CRON_SECRET=                      # 生产环境建议必配
```

可选变量：

- `NEON_DATABASE_PGPORT`、`NEON_DATABASE_PGSSLMODE`（默认 `require`）
- `MY9_ALLOW_MEMORY_FALLBACK=1`：临时放开内存 fallback（生产默认禁用）
- `MY9_ENABLE_V1_FALLBACK=0`：关闭 v1 读取兜底（默认开启；迁移稳定后再关闭）
- `MY9_TRENDS_24H_SOURCE=day|hour`：趋势数据源（默认 `day`）
- `R2_REGION=auto`
- `MY9_ANALYTICS_ACCOUNT_ID`、`MY9_ANALYTICS_API_TOKEN`
- `MY9_SHARE_VIEW_ROLLUP_DAYS`（默认 `2`）
- `MY9_ARCHIVE_OLDER_THAN_DAYS`（默认 `30`）、`MY9_ARCHIVE_BATCH_SIZE`（默认 `500`）、`MY9_ARCHIVE_CLEANUP_TREND_DAYS`（默认 `190`，勿低于 `180`）
- `NEXT_PUBLIC_GA_ID`、`NEXT_PUBLIC_SITE_URL`、`SITE_URL`

Cloudflare Workers 生产部署还需在 `wrangler.jsonc` 中绑定：`MY9_COLD_STORAGE`（R2）、`MY9_SHARE_VIEW_ANALYTICS`（Analytics Engine）、`ASSETS`。

Cloudflare 部署认证统一使用 account token，不再使用全局 `CLOUDFLARE_API_KEY`。

分享图封面当前通过 `wsrv.nl` 在前端拉取并绘制；修改该链路时需评估跨域与流量成本影响。

严禁提交任何真实密钥（Neon/R2/CRON）。若误泄露，必须立即旋转并更新环境变量。

## 分享存储 v2 运维

- 迁移脚本默认读取 `my9_shares_v1`，并写入 `my9_share_registry_v2` / `my9_share_alias_v1` / `my9_subject_dim_v1`；当前趋势表需通过重建脚本单独重建到 `my9_trend_subject_kind_*_v3`。
- 迁移完成后先执行校验脚本；仅当 `missing_count=0` 且 `orphan_alias_count=0` 才允许考虑关闭 v1 兜底。
- 日常归档由 Cloudflare Workers Cron 调度 `worker.js` 中的 `scheduled()`，当前配置在 `wrangler.jsonc`（`5 16 * * *`，即北京时间 `00:05`，每天一次）。
- 同一个 daily cron 还会把 Workers Analytics Engine 中最近 `MY9_SHARE_VIEW_ROLLUP_DAYS` 个已闭合自然日的分享页访问量汇总回写到 `my9_share_view_daily_v1`。
- `app/api/cron/archive/route.ts` 继续保留为手动运维入口；生产环境建议始终使用 `CRON_SECRET`。
- 生产切换顺序：`v2 优先 + v1 兜底` -> 全量迁移与校验 -> 关闭兜底 -> 稳定观察后再删除 v1 表。

## 提交与 PR 建议

- 提交信息简短、祈使/现在时，聚焦单一改动。
- PR 说明建议包含：改动范围、复现/验证步骤、必要截图、环境变量变更。

## 新增内容源贡献（必读）

- 以 iTunes 接入为样本，新增内容源时统一遵循 `docs/content-source-contribution.md`。
- 涉及新增/切换内容源的 PR，说明中至少要覆盖：kind 与 source 路由关系、搜索实现、分享存储兼容、前端外链与归因、测试结果。
