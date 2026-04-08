---
description: Rules for tests and E2E
globs: tests/**/*.spec.ts,playwright.config.ts
---

- E2E 框架：Playwright（`playwright.config.ts`）。
- 测试端口 `3001`，通过 `scripts/playwright-webserver.cjs` 启动。
- 交互测试写在 `tests/v3-interaction.spec.ts`。
- 布局测试写在 `tests/layout-mobile-fill.spec.ts`。
- 不要占用或清理端口 `3000`。
