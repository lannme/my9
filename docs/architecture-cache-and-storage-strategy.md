# My9 前后端接口缓存架构 & BGG 数据本地化存储策略

> 生成时间：2026-04-02 | 基于代码库实际分析

---

## 第一部分：现有前后端接口与缓存架构全景

### 1. API 路由总览

| 路由 | 方法 | 职责 | 所在文件 |
|------|------|------|----------|
| `/api/subjects/search` | GET | 桌游搜索（委托 BGG） | `app/api/subjects/search/route.ts` → `lib/bgg/route.ts` |
| `/api/share` | GET | 获取已有分享 | `app/api/share/route.ts` |
| `/api/share` | POST | 创建新分享 | `app/api/share/route.ts` |
| `/api/trends` | GET | 趋势数据查询 | `app/api/trends/route.ts` |
| `/api/stats/share-count` | GET | 分享总数统计 | `app/api/stats/share-count/route.ts` |
| `/api/cron/archive` | GET | 定时归档（运维入口） | `app/api/cron/archive/route.ts` |

### 2. BGG 搜索三层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  bgg-api.ts（底层封装层）                                          │
│  ──────────────────────────────                                  │
│  • BGG XML API2 的全部 11 个端点封装                                │
│  • 使用 fast-xml-parser 将 XML → 类型安全 JS 对象                   │
│  • 15 秒超时控制 + 可选 BGG_APP_TOKEN Bearer 认证                   │
│  • 关键调用: searchItems(), fetchThingItems()                      │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│  search.ts（业务逻辑层）                                           │
│  ──────────────────────────────                                  │
│  • searchBggBoardgames(): 搜索 + 批量获取详情                       │
│    1. searchItems({ query, type: "boardgame" }) → 前 50 条         │
│    2. fetchThingItems(batch, stats:1) → 每批 20 个 ID             │
│    3. 提取: 主名称 / 中文名 / 封面 / 年份 / 类别 / BGG链接            │
│  • buildBggSearchResponse(): 评分排序 → 返回前 20 条                │
│    评分 = 名称匹配(200/120/50) + bayesAvg×10                      │
│          + log(comments)×20 + log(usersRated)×15                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│  route.ts（HTTP 处理层）                                           │
│  ──────────────────────────────                                  │
│  • IP 限流: 10s 窗口 / 8 次上限 / store 最大 20000 条              │
│  • 服务端内存缓存: 3 分钟 TTL / 最大 256 条                         │
│  • Inflight 去重: 同 key 并发共享同一 Promise                       │
│  • CDN Cache-Control: s-maxage=900, stale-while-revalidate=86400 │
└─────────────────────────────────────────────────────────────────┘
```

### 3. 五层缓存体系（搜索链路）

```
用户输入
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│ ① 客户端请求冷却（400ms 内同 key 不重复发请求）                     │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│ ② 客户端 sessionStorage 缓存                                    │
│   • key: my-nine-search-cache:v1                                │
│   • TTL: 15 分钟                                                │
│   • 容量: 最多 192 条                                            │
│   • 水合: 首次搜索时从 sessionStorage 惰性加载                      │
└──────────────────────┬───────────────────────────────────────┘
                       │ cache miss
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ ③ CDN 边缘缓存                                                  │
│   • s-maxage=900（15 分钟）                                      │
│   • stale-while-revalidate=86400（1 天陈旧可用）                  │
│   • 由 Cloudflare CDN 自动管理                                   │
└──────────────────────┬───────────────────────────────────────┘
                       │ cache miss
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ ④ 服务端进程内存缓存                                              │
│   • globalThis.__MY9_BGG_SEARCH_MEMORY__                        │
│   • TTL: 3 分钟 / 容量: 256 条                                   │
│   • 含 inflight 去重 (同 key 并发只发一次 BGG 请求)                 │
│   • 含 IP 速率限制 (10s 内 ≤8 次)                                 │
└──────────────────────┬───────────────────────────────────────┘
                       │ cache miss
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ ⑤ BGG XML API2 远程调用                                          │
│   • /xmlapi2/search → 搜索条目列表                                │
│   • /xmlapi2/thing  → 批量获取详情 (每批20个, 含stats)              │
│   • 超时: 15 秒                                                  │
│   • 每次搜索 = 1 次 search + ceil(min(结果数,50)/20) 次 thing     │
│   • 典型延迟: 2~8 秒（取决于 BGG 响应速度）                         │
└──────────────────────────────────────────────────────────────┘
```

### 4. 其他 API 缓存策略

| API | CDN 缓存 | 服务端缓存 |
|-----|----------|-----------|
| `GET /api/share` | `s-maxage=3600, swr=86400` | 无额外缓存，直读数据库 |
| `GET /api/trends` | 动态 TTL（≤300s，根据上次更新时间计算） | 数据库缓存表 `my9_trends_cache_v1` + 进程内存缓存 |
| `GET /api/stats/share-count` | `s-maxage=300, swr=600` | 无额外缓存 |
| `GET /api/cron/archive` | `no-store` | N/A（运维接口） |

### 5. 数据库模型（Neon PostgreSQL，共 9 张表）

```
┌─────────────────────────────────────────────────────────────┐
│                      核心业务表                                │
├─────────────────────────────────────────────────────────────┤
│  my9_share_registry_v2    分享注册主表（热/冷分层）               │
│  ├── share_id (PK)                                           │
│  ├── kind, creator_name, content_hash (UNIQUE)               │
│  ├── storage_tier ('hot'|'cold')                             │
│  ├── hot_payload (JSONB, 热数据)                              │
│  ├── cold_object_key (R2 对象键, 冷数据)                       │
│  └── created_at, updated_at, last_viewed_at                  │
│                                                              │
│  my9_share_alias_v1       去重别名映射                          │
│  ├── share_id (PK)                                           │
│  └── target_share_id → registry_v2(share_id) FK              │
│                                                              │
│  my9_subject_dim_v1       主题/桌游维度表                       │
│  ├── (kind, subject_id) (PK)                                 │
│  ├── name, localized_name, cover                             │
│  ├── release_year, genres (JSONB)                            │
│  └── updated_at                                              │
├─────────────────────────────────────────────────────────────┤
│                      趋势统计表                                │
├─────────────────────────────────────────────────────────────┤
│  my9_trend_subject_kind_all_v3    全量趋势（kind+subject_id）   │
│  my9_trend_subject_kind_day_v3    按天趋势（+day_key YYYYMMDD） │
│  my9_trend_subject_kind_hour_v3   按小时趋势（+hour_bucket）    │
├─────────────────────────────────────────────────────────────┤
│                      辅助表                                    │
├─────────────────────────────────────────────────────────────┤
│  my9_trends_cache_v1      趋势查询结果缓存                      │
│  my9_share_view_daily_v1  分享页日访问量                         │
│  my9_shares_v1            旧版分享表（只读兜底）                  │
└─────────────────────────────────────────────────────────────┘
```

### 6. 存储层全景

```
┌──────────────┐  ┌───────────────────┐  ┌──────────────────────┐
│ Neon PG      │  │ Cloudflare R2     │  │ CF Analytics Engine  │
│ (PostgreSQL) │  │ (冷存储)           │  │ (访问量追踪)          │
│              │  │                   │  │                      │
│ 9 张表       │  │ shares/v1/        │  │ my9_share_views_v1   │
│ 热数据 JSONB  │  │ {id}.json.gz     │  │ dataset              │
│ 趋势计数     │  │ gzip 压缩          │  │                      │
│ 维度数据     │  │ 30天前自动归档      │  │ → 日汇总回写 PG      │
└──────┬───────┘  └────────┬──────────┘  └──────────┬───────────┘
       │                   │                        │
       └───────────────────┴────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │ CF Workers  │
                    │ (Runtime)   │
                    │             │
                    │ R2 Binding  │
                    │ AE Binding  │
                    │ Cron: 00:05 │
                    └─────────────┘
```

### 7. 数据生命周期

```
创建分享 (POST /api/share)
    │
    ├─→ my9_share_registry_v2  (hot_payload=JSONB, storage_tier='hot')
    ├─→ my9_share_alias_v1     (如果内容哈希重复，创建别名指向已有分享)
    ├─→ my9_subject_dim_v1     (UPSERT 桌游维度数据)
    └─→ my9_trend_*_v3        (递增 all/day/hour 趋势计数)

读取分享 (GET /api/share)
    │
    ├─→ v2 registry 查询 → hot: 直接返回 hot_payload
    │                     → cold: 从 R2 下载并 gunzip
    ├─→ alias 解析（如果原 ID 是别名，重定向到 canonical）
    ├─→ v1 fallback（如果 v2 没找到且 V1_FALLBACK_ENABLED）
    └─→ memory fallback（如果数据库不可用且 MEMORY_FALLBACK_ENABLED）

每日归档 (Cron 00:05 北京时间)
    │
    ├─→ 热数据 → R2 冷存储 (30天前的分享)
    ├─→ 清理过期 day/hour 趋势行
    └─→ Analytics Engine → my9_share_view_daily_v1 (回刷访问量)
```

---

## 第二部分：BGG 数据本地化存储策略

### 1. 问题分析

#### 当前痛点

| 痛点 | 详情 |
|------|------|
| **响应慢** | BGG XML API 单次搜索需 2~8s（1 次 search + 2~3 次 thing 批量请求） |
| **频率限制** | BGG 有隐性速率限制，高并发下容易 429/超时 |
| **数据冗余获取** | 每次搜索都需实时拉取 thing 详情，但桌游元数据（名称/年份/评分/排名）变化极慢 |
| **缓存短命** | 服务端内存缓存仅 3 分钟，Worker 重启后丢失 |

#### 你的 CSV 数据

```
id, name, yearpublished, rank, bayesaverage, average, usersrated,
is_expansion, abstracts_rank, cgs_rank, childrensgames_rank,
familygames_rank, partygames_rank, strategygames_rank,
thematic_rank, wargames_rank
```

这份数据覆盖了 BGG 全量桌游列表，包含搜索和排序所需的核心字段。

#### 当前搜索使用到的字段

从 `search.ts` 和 `bgg-api.ts` 分析，搜索链路实际使用的字段为：

| 用途 | 字段 | 来源 |
|------|------|------|
| 展示名称 | `name` (primary) | `/thing` → name[type=primary] |
| 中文名 | `localizedName` | `/thing` → name[type=alternate] 中文匹配 |
| 封面图 | `cover` | `/thing` → image / thumbnail |
| 发行年份 | `releaseYear` | `/thing` → yearpublished |
| 类别 | `genres` | `/thing` → link[type=boardgamecategory] 前3个 |
| BGG 链接 | `storeUrls.bgg` | 由 ID 拼接 |
| **排序用** bayesAverage | `ratings.bayesaverage` | `/thing` → statistics.ratings |
| **排序用** usersRated | `ratings.usersrated` | `/thing` → statistics.ratings |
| **排序用** numComments | `ratings.numcomments` | `/thing` → statistics.ratings |

### 2. 存储策略设计

#### 整体方案：新建 `my9_bgg_boardgame_v1` 本地目录表 + 搜索优先走本地

```
┌─────────────────────────────────────────────────────────────────┐
│                    数据导入流程（一次性 + 定期更新）                   │
│                                                                  │
│  CSV 全量数据 ──→ import 脚本 ──→ my9_bgg_boardgame_v1 (Neon PG)  │
│                                                                  │
│  BGG /thing API ─→ enrich 脚本 ──→ 补充 cover / 中文名 / genres    │
│  (增量、按需)                                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    搜索流程（改造后）                                │
│                                                                  │
│  用户搜索 "卡坦岛"                                                 │
│      │                                                           │
│      ▼                                                           │
│  ① 查询 my9_bgg_boardgame_v1（本地 PG 全文搜索）                    │
│      │  WHERE name ILIKE '%catan%'                               │
│      │     OR localized_name ILIKE '%卡坦%'                       │
│      │  ORDER BY bayes_average DESC                              │
│      │  LIMIT 20                                                 │
│      │                                                           │
│      ├── 命中 → 直接返回（<50ms）                                   │
│      │                                                           │
│      └── 未命中或结果不足 → ② 回退 BGG API（现有逻辑）                │
│          └── 获取结果后回写到本地表（enrichment）                     │
└─────────────────────────────────────────────────────────────────┘
```

#### 2.1 新建数据库表 `my9_bgg_boardgame_v1`

```sql
CREATE TABLE IF NOT EXISTS my9_bgg_boardgame_v1 (
    -- 基础标识
    bgg_id          TEXT PRIMARY KEY,         -- BGG 桌游 ID (来自 CSV: id)
    name            TEXT NOT NULL,            -- 英文主名称 (来自 CSV: name)
    localized_name  TEXT,                     -- 中文名 (需从 BGG /thing alternate name 补充)

    -- CSV 直接可导的字段
    year_published  INT,                      -- 发行年份 (CSV: yearpublished)
    bgg_rank        INT,                      -- BGG 总排名 (CSV: rank)
    bayes_average   REAL NOT NULL DEFAULT 0,  -- 贝叶斯均分 (CSV: bayesaverage)
    average         REAL NOT NULL DEFAULT 0,  -- 用户均分 (CSV: average)
    users_rated     INT NOT NULL DEFAULT 0,   -- 评分人数 (CSV: usersrated)
    is_expansion    BOOLEAN DEFAULT FALSE,    -- 是否扩展包 (CSV: is_expansion)

    -- 分类排名 (CSV 中的各类排名字段)
    abstracts_rank      INT,                  -- 抽象游戏排名
    cgs_rank            INT,                  -- 定制游戏排名
    childrensgames_rank INT,                  -- 儿童游戏排名
    familygames_rank    INT,                  -- 家庭游戏排名
    partygames_rank     INT,                  -- 派对游戏排名
    strategygames_rank  INT,                  -- 策略游戏排名
    thematic_rank       INT,                  -- 主题游戏排名
    wargames_rank       INT,                  -- 战棋排名

    -- 需要从 BGG /thing API 补充的字段（增量 enrich）
    cover           TEXT,                     -- 封面图 URL
    thumbnail       TEXT,                     -- 缩略图 URL
    genres          JSONB,                    -- 类别标签 (boardgamecategory)
    description     TEXT,                     -- 简介

    -- 搜索优化
    name_search     TEXT GENERATED ALWAYS AS (lower(name)) STORED,

    -- 元数据
    csv_imported_at BIGINT,                   -- CSV 导入时间戳
    api_enriched_at BIGINT,                   -- BGG API 补充时间戳
    updated_at      BIGINT NOT NULL           -- 最后更新时间
);

-- 搜索索引：支持 name 和 localized_name 的模糊搜索
CREATE INDEX IF NOT EXISTS bgg_boardgame_name_trgm_idx
    ON my9_bgg_boardgame_v1 USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bgg_boardgame_locname_trgm_idx
    ON my9_bgg_boardgame_v1 USING gin (localized_name gin_trgm_ops)
    WHERE localized_name IS NOT NULL;

-- 排序索引：按 BGG 排名和评分排序
CREATE INDEX IF NOT EXISTS bgg_boardgame_rank_idx
    ON my9_bgg_boardgame_v1 (bgg_rank ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS bgg_boardgame_bayes_idx
    ON my9_bgg_boardgame_v1 (bayes_average DESC);

-- 过滤索引：排除扩展包
CREATE INDEX IF NOT EXISTS bgg_boardgame_base_rank_idx
    ON my9_bgg_boardgame_v1 (bgg_rank ASC NULLS LAST)
    WHERE is_expansion = FALSE;
```

> **注意**：`gin_trgm_ops` 依赖 `pg_trgm` 扩展，Neon PostgreSQL 已内置支持，需执行：
> ```sql
> CREATE EXTENSION IF NOT EXISTS pg_trgm;
> ```

#### 2.2 数据导入脚本设计 (`scripts/import-bgg-csv.mjs`)

```
执行方式: node scripts/import-bgg-csv.mjs --file ./data/bgg-boardgames.csv

流程:
1. 读取 CSV 文件 (使用 csv-parse 或逐行解析)
2. 批量 UPSERT 到 my9_bgg_boardgame_v1
   - batch size: 500 行/批
   - ON CONFLICT (bgg_id) DO UPDATE SET ...
   - 只更新 CSV 中包含的字段，不覆盖 cover/localized_name/genres 等已 enrich 的字段
3. 记录: 总行数、新增数、更新数、耗时
```

**字段映射**：

| CSV 列 | DB 字段 | 转换 |
|---------|---------|------|
| `id` | `bgg_id` | `TEXT` |
| `name` | `name` | 直接映射 |
| `yearpublished` | `year_published` | `INT`, 0/空 → NULL |
| `rank` | `bgg_rank` | `INT`, 0/空/"Not Ranked" → NULL |
| `bayesaverage` | `bayes_average` | `REAL`, 默认 0 |
| `average` | `average` | `REAL`, 默认 0 |
| `usersrated` | `users_rated` | `INT`, 默认 0 |
| `is_expansion` | `is_expansion` | `BOOLEAN`, 1→TRUE, 0→FALSE |
| `abstracts_rank` ~ `wargames_rank` | 同名字段 | `INT`, 0/空 → NULL |

#### 2.3 增量 Enrich 脚本设计 (`scripts/enrich-bgg-details.mjs`)

```
执行方式: node scripts/enrich-bgg-details.mjs [--limit 1000] [--rank-max 5000]

目标: 为本地表中缺少 cover / localized_name / genres 的热门桌游补充 BGG /thing 详情

流程:
1. 查询需要 enrich 的记录:
   SELECT bgg_id FROM my9_bgg_boardgame_v1
   WHERE api_enriched_at IS NULL
     AND is_expansion = FALSE
     AND (bgg_rank IS NOT NULL AND bgg_rank <= :rankMax)
   ORDER BY bgg_rank ASC NULLS LAST
   LIMIT :limit

2. 分批调用 BGG /thing API (每批 20 个 ID, 间隔 2 秒):
   fetchThingItems({ id: batchIds, type: "boardgame", stats: 0 })

3. 提取并更新:
   - cover: thing.image || thing.thumbnail
   - thumbnail: thing.thumbnail
   - localized_name: 从 alternate name 中提取中文名 (复用 search.ts 的 isChinese 逻辑)
   - genres: boardgamecategory link 前 3 个
   - description: thing.description (可选)

4. 回写:
   UPDATE my9_bgg_boardgame_v1
   SET cover = :cover, localized_name = :name, genres = :genres,
       api_enriched_at = :now, updated_at = :now
   WHERE bgg_id = :id

5. 遵守 BGG 速率限制: 每批间隔 ≥ 2 秒
```

**优先级策略**：
- 第一轮：rank ≤ 2000 的核心桌游（约 100 批 × 2s = ~4 分钟）
- 第二轮：rank ≤ 10000 的热门桌游（按需执行）
- 长尾：用户搜索命中但未 enrich 的桌游，实时回写

#### 2.4 改造后的搜索架构

```typescript
// 新增: lib/bgg/local-search.ts

// 本地搜索函数 (优先路径)
async function searchLocalBoardgames(query: string): Promise<LocalSearchResult> {
  // 1. pg_trgm 模糊搜索 name + localized_name
  // 2. 按 similarity score + bayes_average 排序
  // 3. 排除扩展包 (is_expansion = FALSE)
  // 4. LIMIT 20
  // 5. 如果 cover 缺失，标记需要 enrich
}

// 改造: lib/bgg/route.ts → handleBggSearchRequest

// 搜索策略:
// ① 优先查本地表 → 命中且结果充足(≥5条) → 直接返回
// ② 本地结果不足 → 同时发起 BGG API 搜索（现有逻辑）
// ③ BGG API 返回后，异步回写到本地表（enrich 缺失字段）
// ④ 合并本地 + BGG 结果，去重后返回
```

**搜索 SQL 示例**：

```sql
-- 英文搜索 (pg_trgm 模糊匹配)
SELECT bgg_id, name, localized_name, year_published,
       cover, thumbnail, genres, bayes_average, users_rated,
       similarity(name, $1) AS sim
FROM my9_bgg_boardgame_v1
WHERE (name % $1 OR localized_name % $1)
  AND is_expansion = FALSE
ORDER BY sim DESC, bayes_average DESC
LIMIT 20;

-- 中文搜索 (ILIKE 前缀/包含匹配)
SELECT bgg_id, name, localized_name, year_published,
       cover, thumbnail, genres, bayes_average, users_rated
FROM my9_bgg_boardgame_v1
WHERE localized_name ILIKE '%' || $1 || '%'
  AND is_expansion = FALSE
ORDER BY bayes_average DESC
LIMIT 20;
```

### 3. 缓存策略优化

#### 3.1 引入数据库级搜索缓存表（可选）

当前搜索缓存仅在进程内存中（3 分钟 TTL，Worker 重启丢失）。可以复用趋势缓存的思路，新建搜索缓存表：

```sql
CREATE TABLE IF NOT EXISTS my9_bgg_search_cache_v1 (
    cache_key   TEXT PRIMARY KEY,     -- "bgg:search:{normalized_query}"
    kind        TEXT NOT NULL,
    payload     JSONB NOT NULL,       -- SubjectSearchResponse 序列化
    expires_at  BIGINT NOT NULL,
    created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS bgg_search_cache_expires_idx
    ON my9_bgg_search_cache_v1 (expires_at);
```

**缓存策略**：
- TTL: 24 小时（桌游元数据变化极慢）
- 缓存 key: `bgg:search:v1:{normalizedQuery}`
- 读取路径: 进程内存(3min) → 数据库缓存(24h) → 本地搜索/BGG API
- 过期清理: 随归档 cron 一起执行

> **评估**: 引入本地桌游表后，本地搜索已足够快（<50ms），这张缓存表的收益可能不大。建议先不建，后续如果发现 PG 搜索延迟高再引入。

#### 3.2 优化后的缓存层级

```
用户搜索
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│ ① 客户端冷却 (400ms) + sessionStorage 缓存 (15min, 192条)      │
│   【不变】                                                      │
└──────────────────────┬───────────────────────────────────────┘
                       │ miss
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ ② CDN 缓存 (s-maxage=900, swr=86400)                           │
│   【不变】                                                      │
└──────────────────────┬───────────────────────────────────────┘
                       │ miss
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ ③ 服务端进程内存缓存 (3min, 256条, inflight去重)                  │
│   【不变】                                                      │
└──────────────────────┬───────────────────────────────────────┘
                       │ miss
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ ④ ★ 本地 PG 桌游表搜索 (my9_bgg_boardgame_v1)     ← 新增      │
│   • pg_trgm 模糊搜索 (<50ms)                                   │
│   • 数据来源: CSV 导入 + BGG API 增量 enrich                     │
│   • 命中 ≥5 条 → 直接返回                                       │
│   • 命中 <5 条 → 继续走 ⑤                                      │
└──────────────────────┬───────────────────────────────────────┘
                       │ 结果不足
                       ▼
┌──────────────────────────────────────────────────────────────┐
│ ⑤ BGG XML API 远程调用（现有逻辑，作为兜底）                       │
│   • 搜索结果异步回写到本地表（自动 enrich）                         │
└──────────────────────────────────────────────────────────────┘
```

### 4. 实施路线图

#### Phase 1：数据导入（基础可用）

| 步骤 | 工作内容 | 预估复杂度 |
|------|----------|-----------|
| 1.1 | 创建 `my9_bgg_boardgame_v1` 表（加入 `ensureSchema()`） | 低 |
| 1.2 | 编写 `scripts/import-bgg-csv.mjs` 导入脚本 | 中 |
| 1.3 | 执行 CSV 全量导入 | 低 |

#### Phase 2：本地搜索（核心价值）

| 步骤 | 工作内容 | 预估复杂度 |
|------|----------|-----------|
| 2.1 | 新增 `lib/bgg/local-search.ts` 本地搜索模块 | 中 |
| 2.2 | 改造 `lib/bgg/route.ts`，本地优先 + BGG 兜底 | 中 |
| 2.3 | 搜索命中 BGG API 后异步回写本地表 | 低 |

#### Phase 3：数据补充（体验提升）

| 步骤 | 工作内容 | 预估复杂度 |
|------|----------|-----------|
| 3.1 | 编写 `scripts/enrich-bgg-details.mjs` 补充脚本 | 中 |
| 3.2 | 执行 rank ≤ 2000 的核心桌游 enrich | 低 |
| 3.3 | 按需扩展 enrich 范围 | 低 |

#### Phase 4：持续更新（长期维护）

| 步骤 | 工作内容 | 预估复杂度 |
|------|----------|-----------|
| 4.1 | 定期重导 CSV（每月/每季度更新排名） | 低 |
| 4.2 | 新建桌游自动 enrich（搜索时按需） | 已在 Phase 2 完成 |

### 5. 容量与成本评估

| 指标 | 估算 |
|------|------|
| BGG 全量桌游数 | ~150,000 条（含扩展包） |
| 每行大小（CSV 字段） | ~200 bytes |
| 每行大小（含 enrich） | ~500 bytes |
| 本地表总体积 | ~75 MB（全量 CSV）→ ~35 MB（排除扩展包） |
| enrich 后追加 | ~40 MB（cover URLs + genres JSON） |
| Neon Free Tier | 512 MB 存储，完全够用 |
| pg_trgm 索引开销 | ~20-40 MB（name + localized_name） |
| **总计** | ≤ 150 MB，远低于 Neon 免费额度 |

### 6. 与现有 `my9_subject_dim_v1` 的关系

现有 `my9_subject_dim_v1` 表存储的是**用户选入九宫格的桌游**维度数据，仅在创建分享时写入，数据量小（仅用户实际选过的桌游）。

新建的 `my9_bgg_boardgame_v1` 是**全量 BGG 桌游目录**，用于搜索。两者定位不同：

```
my9_bgg_boardgame_v1          my9_subject_dim_v1
────────────────────           ─────────────────
全量 BGG 桌游目录              用户选入九宫格的桌游
~150K 行                       ~数千行（随使用增长）
用于搜索                        用于趋势展示
CSV 导入 + API enrich          分享创建时自动写入
独立维护                        随分享流程维护
```

搜索命中后，如果用户最终选择该桌游创建分享，现有逻辑会自动写入 `subject_dim_v1`，无需额外改动。

---

## 附录：关键文件索引

| 文件 | 职责 |
|------|------|
| `lib/bgg/bgg-api.ts` | BGG XML API2 全部 11 个端点封装 |
| `lib/bgg/search.ts` | BGG 搜索业务逻辑（搜索+排序+名称处理） |
| `lib/bgg/route.ts` | BGG 搜索 HTTP 处理（缓存+限流+CDN） |
| `app/api/subjects/search/route.ts` | 搜索 API 路由入口 |
| `lib/share/storage.ts` | 数据库连接、9 张表 schema、存储操作 |
| `lib/share/cold-storage.ts` | R2 冷存储存取 |
| `lib/share/view-stats.ts` | Analytics Engine 访问量追踪与汇总 |
| `lib/share/types.ts` | ShareSubject / SubjectSearchResponse 等类型 |
| `lib/subject-kind.ts` | SubjectKind 定义（当前仅 "boardgame"） |
| `lib/subject-source.ts` | SubjectSource 定义（当前仅 "bgg"） |
| `app/components/My9V3App.tsx` | 前端搜索触发、客户端缓存、分享创建 |
| `app/components/v3/SearchDialog.tsx` | 搜索弹窗 UI |

---

## 第三部分：资深架构师审查意见

> 以下从**可靠性、可观测性、安全性、可测试性、可扩展性**五个维度对上述系统设计进行审查，
> 并给出具体改进建议与测试方案。

### 审查 1：可靠性与容错

#### 1.1 BGG 搜索管道缺少重试与熔断

**现状**：`searchBggBoardgames` → `searchItems` / `fetchThingItems` 调用链无 try/catch、无重试。
`fetchBggXml` 仅有 15s 超时，网络抖动或 BGG 短暂 5xx 直接失败。整个管道唯一有重试的是
`fetchCollectionWithRetry`（且仅针对 202 状态码），搜索链路未受益。

**风险**：BGG API 响应不稳定时（尤其跨太平洋网络），单次超时即导致用户看到 "搜索失败"。

**建议**：

```
改进 A — 搜索层 Thing 批量请求增加单批重试

  searchBggBoardgames 中的 fetchThingItems 循环:
  当前: for 循环逐批 await，任一批失败整体中断
  改进: 每批失败时重试 1 次 (间隔 1s)，仍失败则跳过该批(降级返回部分结果)
  效果: 避免因单批 BGG 超时导致整个搜索失败

改进 B — 引入本地搜索后,BGG API 层加入简易熔断

  在 route.ts 的 SearchMemoryStore 中新增:
    bggErrorCount: number      // 连续错误计数
    bggCircuitOpenUntil: number // 熔断恢复时间戳

  逻辑:
    连续 3 次 BGG 请求失败 → 熔断 60s，期间直接跳过 BGG 回退
    有本地搜索兜底后，熔断期间用户体验不受影响
    熔断到期后 → 半开状态,允许 1 个请求通过测试
```

#### 1.2 `searchBggBoardgames` 批量请求的串行瓶颈

**现状**：Thing 详情请求是串行的 `for` 循环（每批 20 个 ID），50 个搜索结果需要 3 批串行请求。

**建议**：引入本地表后，此问题自然缓解（本地搜索不需要 Thing API）。
但 BGG 兜底路径仍建议改为 `Promise.allSettled` 并行 + 单批超时：

```typescript
// 改前: 串行
for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
  const result = await fetchThingItems(...);  // 阻塞
}

// 改后: 受控并行 (最多 2 个并发)
const batches = chunk(allIds, BATCH_SIZE);
for (let i = 0; i < batches.length; i += 2) {
  const slice = batches.slice(i, i + 2);
  const results = await Promise.allSettled(
    slice.map(batch => fetchThingItems({ id: batch.join(","), ... }))
  );
  // 成功的批次合入 thingMap，失败的跳过
}
```

#### 1.3 本地搜索层的数据库故障降级

**现状文档设计**：本地搜索命中 ≥5 条 → 直接返回，<5 条 → 回退 BGG API。
但**未考虑本地 PG 查询本身失败的情况**（如 Neon 超时、连接池满）。

**建议**：在 `local-search.ts` 中添加 try/catch，PG 查询失败时透明回退到 BGG API：

```
搜索路径(容错版):
  ① 尝试本地 PG 搜索
     ├── 成功且 ≥5 条 → 返回
     ├── 成功但 <5 条 → 走 ②
     └── 失败(PG 异常) → 走 ②，并记录 warn 日志
  ② BGG API 搜索(现有逻辑)
     └── 成功后异步回写本地表(不阻塞响应)
```

#### 1.4 V1 兜底层的静默异常吞没

**现状**：`tryGetShareFromV1`、`tryListSharesFromV1`、`tryCountSharesFromV1` 的 catch 块
完全不记录日志，异常被静默吞掉。

**风险**：v1 表结构损坏、权限问题等持续性错误无法被发现。

**建议**：至少在 catch 中加采样日志（如前 5 次全记录，之后每 100 次记录一次），
与 `checkSearchRateLimit` 中的日志采样策略保持一致。

---

### 审查 2：可观测性

#### 2.1 缺少结构化日志与指标

**现状**：整个搜索管道仅在限流触发时有 `console.warn` 输出。缓存命中率、BGG API 延迟、
搜索结果数量等关键指标没有任何记录。

**建议**：

```
关键指标（建议至少记录 console.log 供 Worker 日志采集）:

搜索链路:
  - bgg.search.local_hit: 本地搜索命中次数
  - bgg.search.local_miss: 本地搜索未命中/不足
  - bgg.search.api_call: BGG API 实际调用次数
  - bgg.search.api_latency_ms: BGG API 响应耗时
  - bgg.search.api_error: BGG API 错误次数
  - bgg.search.cache_hit: 内存缓存命中次数
  - bgg.search.cache_miss: 内存缓存未命中次数

数据质量:
  - bgg.enrich.missing_cover: 搜索结果中缺少封面的数量
  - bgg.enrich.backfill: 异步回写触发次数

日志格式示例:
  console.log(JSON.stringify({
    event: "bgg_search",
    query, kind, source: "local"|"api"|"mixed",
    resultCount, latencyMs, cacheHit: boolean
  }));
```

#### 2.2 CSV 导入脚本缺少校验报告

**建议**：`import-bgg-csv.mjs` 执行完成后应输出详细报告：

```
[import-bgg-csv] 导入完成
  总行数: 148,237
  新增:   12,451
  更新:   135,786
  跳过(无效): 0
  耗时:   42s
  数据校验:
    - name 为空: 0 行
    - bgg_id 重复: 0 行
    - bayes_average > 10: 0 行 (异常值检查)
    - year_published < 1800: 3 行 (待人工确认)
```

---

### 审查 3：安全性

#### 3.1 pg_trgm SQL 注入风险

**现状文档设计**使用 ILIKE 拼接用户输入：

```sql
WHERE localized_name ILIKE '%' || $1 || '%'
```

**评估**：如果使用 Neon 的参数化查询（`$1` 占位符），这里实际是安全的。
但需要确认实现时使用的是参数绑定而非字符串拼接。

**建议**：在实现 `local-search.ts` 时，**强制使用 Neon tagged template SQL**（与现有
`storage.ts` 的模式一致），禁止手动拼接 SQL 字符串。同时对用户输入做长度限制
（如搜索词 ≤ 100 字符）和特殊字符转义（LIKE 的 `%` 和 `_`）。

#### 3.2 CSV 导入的数据完整性校验

**建议**：导入脚本应验证：
- `bgg_id` 为纯数字字符串（BGG ID 格式）
- `name` 非空且长度 ≤ 500
- `bayesaverage` / `average` 在 0~10 范围内
- `is_expansion` 为 0 或 1
- 排名字段为正整数或 NULL

异常行应跳过并记录，而非终止整个导入。

---

### 审查 4：可扩展性

#### 4.1 pg_trgm 在 150K 行规模下的性能评估

**现状设计**：使用 `gin_trgm_ops` 索引进行模糊搜索。

**评估**：
- 150K 行对 pg_trgm GIN 索引完全没有压力，查询应在 10~50ms 内完成。
- 但 `similarity()` 函数在 `ORDER BY` 中使用时需要全表扫描（GIN 索引仅加速 `WHERE` 中的 `%` 操作符）。

**建议**：
- 搜索 SQL 的 `WHERE` 子句使用 `%` 操作符（走索引），`ORDER BY` 中可以用 `similarity()`（只对过滤后的小结果集排序）。
- 设置合理的 `pg_trgm.similarity_threshold`（默认 0.3，可调至 0.2 提高召回率）。
- 中文搜索 `ILIKE` 无法走 trgm 索引（CJK 字符的 trigram 效果差），考虑对 `localized_name` 额外建立普通 B-tree 索引用于前缀匹配，或使用 `ILIKE` 时限定 `bgg_rank <= 10000` 缩小扫描范围。

#### 4.2 异步回写的幂等性

**建议**：BGG API 兜底搜索结果回写本地表时，应使用 `INSERT ... ON CONFLICT DO UPDATE`，
确保多个并发搜索请求不会产生冲突错误。回写应使用 fire-and-forget 模式（不 await），
避免阻塞响应。

#### 4.3 `ensureSchema` 中新表的建表位置

**建议**：`my9_bgg_boardgame_v1` 的 `CREATE TABLE` 应加入 `storage.ts` 的 `ensureSchema()`
函数中，与现有 9 张表统一管理。但考虑到 `pg_trgm` 扩展需要 `CREATE EXTENSION`，应在建表前执行：

```typescript
await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
```

注意：Neon 的 `CREATE EXTENSION` 需要数据库 owner 权限，预先在 Neon Console 中执行更稳妥。

#### 4.4 数据新鲜度与版本管理

**建议**：在 `my9_bgg_boardgame_v1` 表中新增 `data_version` 字段（如 `"csv_2026Q2"`），
便于追踪数据来源批次。定期重导 CSV 时，可通过 `data_version` 识别未被最新批次覆盖的陈旧记录。

---

### 审查 5：当前文档设计遗漏

#### 5.1 搜索结果合并策略不够明确

**现状**：文档提到 "合并本地 + BGG 结果，去重后返回"，但未定义：
- 去重 key 是什么？（应为 `bgg_id`）
- 重复时以哪个来源为准？（应以 BGG API 为准，因为数据更新鲜）
- 合并后如何重排序？（应使用统一的 `scoreCandidate` 评分函数）

**建议明确**：

```
合并策略:
  1. 以 bgg_id 为去重键
  2. 同一 ID 同时出现在本地和 BGG 结果中 → 采用 BGG 版本(更新鲜)
  3. 合并后统一使用 scoreCandidate() 重排序
  4. 截取前 20 条返回
```

#### 5.2 未考虑 CSV 中 "Not Ranked" 等非数字值的处理

**建议**：BGG CSV 导出中 `rank` 字段可能为 `"Not Ranked"`、空字符串、或 `0`。导入脚本的
字段映射表虽然提到了 `0/空/"Not Ranked" → NULL`，但需要确保实现中覆盖所有 edge case。

#### 5.3 Enrich 脚本的断点续传

**建议**：参照 `migrate-shares-v1-to-v2.mjs` 的 checkpoint 机制，enrich 脚本也应支持
断点续传（记录上次处理到的 `bgg_rank`），便于因 BGG 限流中断后恢复。

---

## 第四部分：测试方案

### 1. 单元测试方案

> 当前项目无单元测试框架。建议引入 **Vitest**（与 Next.js + TypeScript 生态最契合，
> 配置简单，原生 ESM 支持），配置文件 `vitest.config.ts`，测试文件放在各模块同目录下
> `*.test.ts`。

#### 1.0 Vitest 初始化

```bash
npm install -D vitest
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/bgg/**', 'lib/share/**', 'lib/search/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
});
```

`package.json` 新增脚本:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

#### 1.1 `lib/bgg/search.ts` 单元测试

| 测试用例 | 验证点 |
|----------|--------|
| `isChinese("卡坦岛") → true` | 中文字符正确识别 |
| `isChinese("カタン") → false` | 日文假名排除 |
| `isChinese("카탄") → false` | 韩文排除 |
| `isChinese("Catan") → false` | 纯拉丁字母排除 |
| `isChinese("卡坦岛(Catan)") → true` | 混合文本以 CJK 为准 |
| `cleanChineseName("卡坦岛 (Catan)") → "卡坦岛"` | 尾部拉丁括号清除 |
| `cleanChineseName("卡坦岛 (2020)") → "卡坦岛"` | 尾部年份括号清除 |
| `cleanChineseName("卡坦岛") → "卡坦岛"` | 无括号原样返回 |
| `extractYear("2020") → 2020` | 正常年份 |
| `extractYear("0") → undefined` | 异常年份 |
| `extractYear(null) → undefined` | 空值 |
| `resolveName([primary, alternate_cn]) → { primary, chineseName }` | 名称解析 |
| `resolveName([primary_only]) → { primary, chineseName: "" }` | 无中文名 |
| `extractGenres([category1, category2, mechanic1]) → [cat1, cat2]` | 仅取 boardgamecategory |
| `scoreCandidate("catan", exact_match, high_stats) > scoreCandidate("catan", partial_match, low_stats)` | 评分排序正确性 |
| `scoreCandidate("", any_subject, any_stats) → 0` | 空查询返回 0 |
| `buildBggSearchResponse 结果按 score 降序` | 排序验证 |
| `buildBggSearchResponse 限制 ≤ 20 条` | 截断验证 |
| `buildBggSearchResponse 空查询返回 noResultQuery` | 空结果语义 |

#### 1.2 `lib/bgg/route.ts` 单元测试

| 测试用例 | 验证点 |
|----------|--------|
| `toSearchCacheKey("boardgame", "Catan") → "boardgame:catan"` | 缓存 key 标准化 |
| `parseForwardedFor("1.2.3.4, 5.6.7.8") → "1.2.3.4"` | 取第一个 IP |
| `parseForwardedFor("") → null` | 空值处理 |
| `getClientIp(带 x-forwarded-for) → 正确 IP` | 多头部优先级 |
| `getClientIp(无任何头部) → null` | 无 IP 场景 |
| 同一 IP 在 10s 内发 8 次请求 → 前 8 次不限流 | 窗口内允许 |
| 同一 IP 第 9 次请求 → limited=true | 超限触发 |
| 10s 窗口过期后 → 重置计数 | 窗口滑动 |
| 无 IP 请求 → 不限流 | 无 IP 豁免 |
| `getCachedSearchResult` 首次调用 → 执行 searchBggBoardgames | 缓存未命中 |
| `getCachedSearchResult` 3 分钟内再次调用 → 不执行实际搜索 | 缓存命中 |
| `getCachedSearchResult` 3 分钟后调用 → 重新执行搜索 | 缓存过期 |
| 两个并发 `getCachedSearchResult` 同 key → 只调用一次 searchBggBoardgames | inflight 去重 |
| 超过 256 条缓存 → FIFO 淘汰最旧条目 | 缓存容量上限 |
| `handleBggSearchRequest(空 query)` → 200 + 空结果 | 空查询优雅处理 |
| `handleBggSearchRequest(正常 query)` → 200 + 带 Cache-Control | 正常响应头 |
| `handleBggSearchRequest(限流)` → 429 + Retry-After 头 | 限流响应 |
| `handleBggSearchRequest(BGG 抛异常)` → 500 + ok:false + no-store | 错误降级 |

#### 1.3 `lib/bgg/local-search.ts` 单元测试（新增模块）

| 测试用例 | 验证点 |
|----------|--------|
| 精确匹配 "Catan" → 结果包含 Catan 且排在第一 | 精确匹配优先 |
| 模糊匹配 "Cata" → 结果包含 Catan | pg_trgm 模糊 |
| 中文搜索 "卡坦" → 结果包含卡坦岛 | 中文 ILIKE |
| 搜索扩展包名称 → 结果排除扩展包 (is_expansion=FALSE) | 过滤逻辑 |
| 搜索无匹配词 → 空结果 | 空结果语义 |
| 结果按 similarity + bayes_average 排序 | 排序验证 |
| 返回结果 ≤ 20 条 | 限制验证 |
| PG 连接失败 → 抛出异常（由调用方处理降级） | 异常传播 |
| 结果中 cover 为 null 的条目被标记需要 enrich | enrich 标记 |

#### 1.4 CSV 导入逻辑单元测试

| 测试用例 | 验证点 |
|----------|--------|
| 正常行解析 → 所有字段正确映射 | 字段映射 |
| `rank = "Not Ranked"` → `bgg_rank = NULL` | 特殊值处理 |
| `rank = ""` → `bgg_rank = NULL` | 空值处理 |
| `rank = "0"` → `bgg_rank = NULL` | 零值处理 |
| `yearpublished = "0"` → `year_published = NULL` | 零年份 |
| `is_expansion = "1"` → `true` | 布尔转换 |
| `is_expansion = "0"` → `false` | 布尔转换 |
| `bayesaverage = "7.89"` → `7.89` | 浮点解析 |
| `bayesaverage = ""` → `0` | 空值默认 |
| `name = ""` → 跳过该行 | 无效行过滤 |
| `bgg_id = "abc"` → 跳过该行 (非纯数字) | ID 格式校验 |

#### 1.5 `lib/share/storage.ts` 关键函数单元测试（补充现有缺口）

| 测试用例 | 验证点 |
|----------|--------|
| `toBeijingHourBucket` 正确转换时区 | 时区计算 |
| `trendCacheKey` 格式正确含版本号 | 缓存 key 格式 |
| `ensureSchema` 成功后不重复执行 | Promise 缓存 |
| `ensureSchema` 失败后重置,允许重试 | 恢复机制 |
| `createContentHash` 相同内容 → 相同哈希 | 哈希幂等 |
| `createContentHash` 不同内容 → 不同哈希 | 哈希区分度 |
| `compactPayloadToGames` 正确还原 | 序列化往返 |

---

### 2. 集成测试方案

> 需要真实 Neon 数据库连接，建议使用独立的测试数据库或 schema。

#### 2.1 本地搜索端到端集成测试

```
前置条件: 测试数据库中有 100 条已知测试数据

测试流程:
  1. 执行 ensureSchema() → 建表成功
  2. 插入 100 条测试桌游数据(含已知 name/localized_name/rank)
  3. 执行 searchLocalBoardgames("Catan") → 验证结果正确
  4. 执行 searchLocalBoardgames("卡坦") → 验证中文搜索
  5. 验证结果排序: bayes_average 更高的排前面
  6. 验证扩展包被过滤
  7. 清理测试数据
```

#### 2.2 搜索降级链路集成测试

```
场景 A: 本地搜索充足
  Mock: PG 返回 10 条结果
  预期: 不调用 BGG API，直接返回本地结果

场景 B: 本地搜索不足
  Mock: PG 返回 2 条结果
  Mock: BGG API 返回 15 条结果
  预期: 合并去重后返回 ≤20 条，BGG 异步回写本地表

场景 C: 本地搜索失败
  Mock: PG 抛出连接异常
  Mock: BGG API 正常
  预期: 回退 BGG API，正常返回结果

场景 D: 全部失败
  Mock: PG 异常 + BGG API 超时
  预期: 返回 500 + ok:false + 空结果集
```

---

### 3. Playwright E2E 测试补充方案

> 基于现有 `tests/v3-interaction.spec.ts` 的 mock 架构扩展。

#### 3.1 搜索相关 E2E 测试补充

| 测试用例 | 验证点 |
|----------|--------|
| 搜索 API 返回 429 → 界面显示 "请求过于频繁" 提示 | 限流 UI 反馈 |
| 搜索 API 返回 500 → 界面显示 "搜索失败" 而非白屏 | 错误 UI 兜底 |
| 搜索 API 超时 (模拟 >15s) → 界面显示加载超时提示 | 超时 UI |
| 搜索返回含缺失封面的结果 → 界面正常渲染(默认占位图) | 缺失字段容错 |
| 搜索结果中 localizedName 为空 → 仅显示英文名 | 可选字段 |

#### 3.2 本地搜索引入后的对比 E2E 测试

```
测试: "本地搜索比 BGG API 显著更快"
  1. Mock 本地搜索路径返回结果 (延迟 50ms)
  2. 验证搜索结果在 500ms 内渲染完毕
  3. 验证结果格式与现有 BGG 结果一致(name/cover/year/genres)
```

---

### 4. 压力测试方案

> 建议使用 **k6**（Go 编写，适合 HTTP API 压力测试），或 **autocannon**（Node.js 生态）。

#### 4.1 搜索 API 压力测试

```javascript
// k6 脚本: tests/load/search-api.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const searchLatency = new Trend('search_latency_ms');

const SEARCH_QUERIES = [
  'Catan', 'Pandemic', 'Ticket to Ride', 'Azul', 'Wingspan',
  '卡坦', '瘟疫危机', 'root', 'brass', 'terraforming mars',
  'gloomhaven', 'spirit island', 'ark nova', 'dune imperium',
  'seven wonders', 'dominion', 'scythe', 'everdell', 'parks',
];

export const options = {
  scenarios: {
    // 场景 1: 基线性能 (10 VU, 2 分钟)
    baseline: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      startTime: '0s',
    },
    // 场景 2: 阶梯加压 (10→50 VU, 5 分钟)
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '1m', target: 20 },
        { duration: '1m', target: 30 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 0 },
      ],
      startTime: '2m',
    },
    // 场景 3: 突发峰值 (0→100 VU, 30 秒)
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 100 },
        { duration: '20s', target: 100 },
        { duration: '10s', target: 0 },
      ],
      startTime: '8m',
    },
  },
  thresholds: {
    // 性能基线指标
    'search_latency_ms': ['p95 < 500', 'p99 < 2000'],  // 本地搜索 p95 < 500ms
    'errors': ['rate < 0.05'],                           // 错误率 < 5%
    'http_req_duration': ['p95 < 3000'],                 // 含 BGG 回退 p95 < 3s
  },
};

export default function () {
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  const url = `http://localhost:3001/api/subjects/search?q=${encodeURIComponent(query)}&kind=boardgame`;

  const start = Date.now();
  const res = http.get(url);
  searchLatency.add(Date.now() - start);

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response has items': (r) => {
      const body = JSON.parse(r.body);
      return body.ok === true && Array.isArray(body.items);
    },
    'response time < 3s': (r) => r.timings.duration < 3000,
  });

  errorRate.add(!success);
  sleep(0.5 + Math.random());  // 0.5~1.5s 间隔，模拟真实用户
}
```

#### 4.2 搜索缓存穿透压力测试

```javascript
// tests/load/cache-penetration.js
// 目的: 验证缓存层在高并发下的保护效果

export const options = {
  scenarios: {
    // 相同查询并发 (验证 inflight 去重)
    same_query_burst: {
      executor: 'per-vu-iterations',
      vus: 50,          // 50 个并发
      iterations: 1,    // 每个 VU 只发 1 次
      maxDuration: '10s',
    },
  },
  thresholds: {
    'http_req_duration': ['p95 < 1000'],
  },
};

export default function () {
  // 所有 VU 搜索完全相同的词
  const res = http.get(
    'http://localhost:3001/api/subjects/search?q=catan&kind=boardgame'
  );
  check(res, { 'status is 200': (r) => r.status === 200 });
}

// 预期: 50 个并发请求中, 仅 1 个实际穿透到后端搜索
// (内存缓存或 inflight 去重生效)
```

#### 4.3 限流保护压力测试

```javascript
// tests/load/rate-limit.js
// 目的: 验证 IP 限流在高频请求下正确触发

export const options = {
  scenarios: {
    rapid_fire: {
      executor: 'per-vu-iterations',
      vus: 1,           // 单用户
      iterations: 20,   // 20 次请求
      maxDuration: '5s',
    },
  },
};

export default function () {
  const res = http.get(
    'http://localhost:3001/api/subjects/search?q=test&kind=boardgame'
  );
  // 前 8 次应返回 200，第 9 次起应返回 429
  if (__ITER < 8) {
    check(res, { 'under limit → 200': (r) => r.status === 200 });
  } else {
    check(res, {
      'over limit → 429': (r) => r.status === 429,
      'has Retry-After': (r) => r.headers['Retry-After'] !== undefined,
    });
  }
}
```

#### 4.4 数据库连接压力测试

```javascript
// tests/load/db-stress.js
// 目的: 验证 Neon Serverless 在并发下的连接稳定性

export const options = {
  scenarios: {
    mixed_load: {
      executor: 'constant-vus',
      vus: 30,
      duration: '3m',
    },
  },
  thresholds: {
    'http_req_duration': ['p95 < 1000'],
    'errors': ['rate < 0.02'],
  },
};

export default function () {
  const actions = [
    () => http.get('http://localhost:3001/api/trends?period=all&kind=boardgame&view=overall'),
    () => http.get('http://localhost:3001/api/stats/share-count'),
    () => http.get(`http://localhost:3001/api/subjects/search?q=${randomQuery()}&kind=boardgame`),
  ];
  const action = actions[Math.floor(Math.random() * actions.length)];
  const res = action();
  check(res, { 'not 5xx': (r) => r.status < 500 });
  sleep(0.3);
}
```

#### 4.5 CSV 导入性能基准

```
测试: 导入 150K 行 CSV 的性能基准
  环境: 本地 → Neon PostgreSQL (网络延迟 ~50ms)
  批次: 500 行/批
  预期:
    - 150,000 / 500 = 300 批
    - 每批 UPSERT 延迟 ~100ms
    - 总耗时 ≈ 30~60s
  关注指标:
    - 峰值内存占用 (应 < 200MB)
    - Neon 写入 throughput (行/秒)
    - 失败批次数 (应为 0)
```

---

### 5. 压力测试执行方式与自动化

```bash
# 安装 k6
brew install k6

# 运行搜索 API 压力测试
k6 run tests/load/search-api.js

# 运行缓存穿透测试
k6 run tests/load/cache-penetration.js

# 运行限流测试
k6 run tests/load/rate-limit.js

# 运行数据库混合压力测试
k6 run tests/load/db-stress.js
```

建议在 `package.json` 中添加:
```json
"test:load": "k6 run tests/load/search-api.js",
"test:load:cache": "k6 run tests/load/cache-penetration.js",
"test:load:ratelimit": "k6 run tests/load/rate-limit.js"
```

---

### 6. 测试覆盖率目标

| 模块 | 当前覆盖 | 目标覆盖 | 说明 |
|------|----------|----------|------|
| `lib/bgg/search.ts` | 0% (无单元测试) | ≥ 90% | 纯函数多，易测试 |
| `lib/bgg/route.ts` | 0% (E2E 间接覆盖) | ≥ 80% | 缓存/限流逻辑需重点覆盖 |
| `lib/bgg/local-search.ts` (新增) | N/A | ≥ 85% | 新模块建设时同步补充 |
| `lib/share/storage.ts` | 0% (E2E 间接覆盖) | ≥ 60% | 工具函数优先,DB 操作用集成测试 |
| CSV 导入脚本 | N/A | ≥ 80% | 字段转换逻辑必须覆盖 |
| **整体 lib/** | 0% | ≥ 70% | 阶段性目标 |

---

### 审查总结

| 维度 | 评级 | 核心发现 |
|------|------|----------|
| **可靠性** | ⚠️ 中等 | BGG 搜索无重试/熔断;批量请求串行瓶颈;本地搜索降级路径未设计 |
| **可观测性** | ❌ 不足 | 仅限流有日志;缺少结构化指标;缓存命中率不可见 |
| **安全性** | ✅ 良好 | 参数化查询基本安全;需注意 LIKE 通配符转义和输入长度限制 |
| **可测试性** | ❌ 不足 | 零单元测试;E2E 全部 mock 后端;无性能基准 |
| **可扩展性** | ✅ 良好 | 150K 行对 PG 无压力;表设计合理;与现有表独立 |

**最高优先级改进**:
1. 引入 Vitest + `lib/bgg/search.ts` 单元测试（纯函数，最容易开始）
2. 本地搜索模块的数据库故障降级设计
3. BGG API 层简易熔断（引入本地搜索后实施）
4. 搜索链路结构化日志（至少 console.log JSON）
