---
description: Rules for lib/ domain logic
globs: lib/**/*.ts
---

- `lib/share/storage.ts` 是分享存储核心，修改前理解 v2 模型。
- `lib/bgg/` 封装 BoardGameGeek API，搜索入口在 `lib/bgg/search.ts`。
- `lib/subject-kind.ts` 定义类型枚举，`lib/subject-source.ts` 定义内容源。
- 路径别名 `@/*` 映射项目根目录。
