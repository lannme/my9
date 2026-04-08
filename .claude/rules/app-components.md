---
description: Rules for app/ and components/ directories
globs: app/**/*.tsx,app/**/*.ts,components/**/*.tsx,components/**/*.ts
---

- PascalCase 组件文件名；`components/ui/` 下文件名小写。
- 使用 `cn()` from `lib/utils.ts` 合并 Tailwind 类名。
- `app/components/` 放业务组件；`components/` 放跨页面复用组件。
- 新增 UI 组件参考 `components/ui/button.tsx` 的 CVA + Slot 模式。
- App Router：页面用 `page.tsx`，API 用 `route.ts`。
