# My9 — Agent 快速指南

Next.js 16 App Router 项目，部署到 Cloudflare Workers（via OpenNext）。数据库 Neon PostgreSQL，冷存储 Cloudflare R2。

## 常用命令

```bash
npm install          # 安装依赖（Node 20.9+）
npm run dev          # 开发服务器 http://localhost:3000
npm run build        # 生产构建
npm run lint         # ESLint
npm run test:e2e     # Playwright E2E（端口 3001）
npm run cf:deploy    # 构建 + 部署到 Cloudflare Workers
```

## 关键约束

- 端口 `3000` 保留给开发者，Agent 不得占用；自动化测试用 `3001`。
- 不要删除 `.next` 目录；E2E 使用独立的 `.next-e2e`。
- TypeScript strict 模式，路径别名 `@/*`。
- Tailwind CSS + `cn()` 合并类名（`lib/utils.ts`）。
- PascalCase 组件名；`components/ui/` 下文件名小写。
- 严禁提交密钥。

## 项目结构

- `app/page.tsx` — 首页入口
- `app/[kind]/page.tsx` — 填写页
- `app/[kind]/s/[shareId]/page.tsx` — 分享只读页
- `app/trends/page.tsx` — 趋势页
- `app/api/` — API 路由
- `app/components/` — 业务组件（`My9V3App.tsx`、`v3/*`）
- `components/` — 复用组件（`layout/`、`share/`、`subject/`、`ui/`）
- `lib/bgg/` — BoardGameGeek 搜索
- `lib/share/` — 分享存储（`storage.ts`、`trends.ts`、`archive.ts`）
- `lib/utils.ts` — 工具函数
- `utils/image/exportShareImage.ts` — 分享图导出
- `tests/` — Playwright E2E
- `scripts/` — 迁移/归档/构建脚本
- `worker.js` — Cloudflare Workers 入口
- `wrangler.jsonc` — Workers 配置

## 测试

```bash
npm run test:e2e     # 运行所有 E2E
```

交互变更更新 `tests/v3-interaction.spec.ts`；布局问题补截图到 `screenshot/`。

## 环境变量

在 `.env.local` 配置（勿提交）：

```bash
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
BANGUMI_ACCESS_TOKEN=
BANGUMI_USER_AGENT=
NEON_DATABASE_PGHOST_UNPOOLED=
NEON_DATABASE_PGUSER=
NEON_DATABASE_PGPASSWORD=
NEON_DATABASE_PGDATABASE=
R2_ENDPOINT=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
CRON_SECRET=
```
