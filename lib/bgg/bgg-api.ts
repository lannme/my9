/**
 * BoardGameGeek XML API2 完整封装
 *
 * 官方文档: https://boardgamegeek.com/wiki/page/BGG_XML_API2
 *
 * BGG XML API2 基础地址: https://boardgamegeek.com/xmlapi2
 *
 * 本文件覆盖 BGG XML API2 的全部 11 个公开端点:
 *  1. Thing Items   (/thing)      — 获取桌游、扩展、设计师等条目详情
 *  2. Family Items  (/family)     — 获取系列/家族条目
 *  3. Forum List    (/forumlist)  — 获取某条目或家族的论坛列表
 *  4. Forum         (/forum)      — 获取论坛内的帖子列表
 *  5. Thread        (/thread)     — 获取帖子的文章详情
 *  6. User          (/user)       — 获取用户信息
 *  7. Guild         (/guild)      — 获取公会信息
 *  8. Plays         (/plays)      — 获取游戏记录
 *  9. Collection    (/collection) — 获取用户收藏
 * 10. Hot           (/hot)        — 获取热门条目
 * 11. Search        (/search)     — 搜索条目
 *
 * 所有接口均返回 XML，本文件统一使用 fast-xml-parser 解析为 JS 对象。
 * 调用方可直接使用解析后的类型安全的结构体。
 */

import { XMLParser } from "fast-xml-parser";

// ─── 常量与配置 ───────────────────────────────────────────────

/** BGG XML API2 基础 URL */
const BGG_API_BASE = "https://boardgamegeek.com/xmlapi2";

/** 可选的 BGG 应用 Token（用于提升速率限制） */
const BGG_APP_TOKEN = process.env.BGG_APP_TOKEN ?? "";

/** 默认请求超时时间（毫秒） */
const DEFAULT_TIMEOUT_MS = 15_000;

/** XML 解析器实例（全局复用） */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "_text",
});

// ─── 通用工具函数 ─────────────────────────────────────────────

/** 将可能为单个值或数组的字段统一转为数组 */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 构造 BGG API 请求头（含可选的 Bearer Token 认证） */
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "text/xml",
  };
  if (BGG_APP_TOKEN) {
    headers["Authorization"] = `Bearer ${BGG_APP_TOKEN}`;
  }
  return headers;
}

/**
 * 通用 BGG XML API 请求函数
 *
 * @param path - API 路径（以 / 开头，如 "/thing?id=174430"）
 * @param timeoutMs - 超时时间（毫秒），默认 15 秒
 * @returns 解析后的 JS 对象
 */
async function fetchBggXml<T = unknown>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BGG_API_BASE}${path}`, {
      headers: authHeaders(),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`BGG API error: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    return xmlParser.parse(xml) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 将参数对象序列化为 URL 查询字符串（自动跳过 undefined/null 值）
 *
 * @param params - 键值对参数
 * @returns 以 ? 开头的查询字符串，或空字符串
 */
function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return entries.length > 0 ? `?${entries.join("&")}` : "";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  类型定义
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── Thing 类型 (/thing) ──────────────────────────────────────

/**
 * Thing 条目类型（BGG 中可查询的对象类型）
 *
 * - boardgame: 桌游
 * - boardgameexpansion: 桌游扩展
 * - boardgameaccessory: 桌游配件
 * - videogame: 电子游戏
 * - rpgitem: 角色扮演游戏条目
 * - rpgissue: RPG 期刊
 */
export type BggThingType =
  | "boardgame"
  | "boardgameexpansion"
  | "boardgameaccessory"
  | "videogame"
  | "rpgitem"
  | "rpgissue";

/** Thing 名称字段 */
export interface BggName {
  type?: string;
  sortindex?: string;
  value?: string;
}

/** Thing 链接字段（设计师、艺术家、出版商、分类、机制等） */
export interface BggLink {
  type?: string;
  id?: string;
  value?: string;
  inbound?: string;
}

/** 投票结果单项 */
export interface BggPollResultItem {
  value?: string;
  numvotes?: string;
}

/** 投票结果（含建议人数范围） */
export interface BggPollResult {
  numplayers?: string;
  result?: BggPollResultItem | BggPollResultItem[];
}

/** 投票（如最佳人数、语言依赖度、玩家年龄） */
export interface BggPoll {
  name?: string;
  title?: string;
  totalvotes?: string;
  results?: BggPollResult | BggPollResult[];
}

/** 评分统计信息 */
export interface BggRatings {
  usersrated?: { value?: string };
  average?: { value?: string };
  bayesaverage?: { value?: string };
  stddev?: { value?: string };
  median?: { value?: string };
  owned?: { value?: string };
  trading?: { value?: string };
  wanting?: { value?: string };
  wishing?: { value?: string };
  numcomments?: { value?: string };
  numweights?: { value?: string };
  averageweight?: { value?: string };
  ranks?: {
    rank?:
      | {
          type?: string;
          id?: string;
          name?: string;
          friendlyname?: string;
          value?: string;
          bayesaverage?: string;
        }
      | Array<{
          type?: string;
          id?: string;
          name?: string;
          friendlyname?: string;
          value?: string;
          bayesaverage?: string;
        }>;
  };
}

/** 统计数据容器 */
export interface BggStatistics {
  page?: string;
  ratings?: BggRatings;
}

/** Thing 视频条目 */
export interface BggVideo {
  id?: string;
  title?: string;
  category?: string;
  language?: string;
  link?: string;
  username?: string;
  userid?: string;
  postdate?: string;
}

/** Thing 版本条目 */
export interface BggVersion {
  id?: string;
  type?: string;
  thumbnail?: string;
  image?: string;
  name?: BggName | BggName[];
  link?: BggLink | BggLink[];
  yearpublished?: { value?: string };
  productcode?: { value?: string };
  width?: { value?: string };
  length?: { value?: string };
  depth?: { value?: string };
  weight?: { value?: string };
}

/** 用户评论 */
export interface BggComment {
  username?: string;
  rating?: string;
  value?: string;
}

/** Marketplace 商品列表 */
export interface BggMarketplaceListing {
  listdate?: { value?: string };
  price?: { currency?: string; value?: string };
  condition?: { value?: string };
  notes?: { value?: string };
  link?: { href?: string; title?: string };
}

/**
 * Thing 条目完整结构
 *
 * 每个 Thing 代表 BGG 数据库中的一个条目（桌游、扩展等）
 */
export interface BggThingItem {
  /** BGG 条目 ID */
  id?: string;
  /** 条目类型 */
  type?: string;
  /** 缩略图 URL */
  thumbnail?: string;
  /** 完整图片 URL */
  image?: string;
  /** 名称（可能为主名称与别名的数组） */
  name?: BggName | BggName[];
  /** 描述（HTML） */
  description?: string;
  /** 发布年份 */
  yearpublished?: { value?: string };
  /** 最少玩家人数 */
  minplayers?: { value?: string };
  /** 最多玩家人数 */
  maxplayers?: { value?: string };
  /** 游戏时长（分钟） */
  playingtime?: { value?: string };
  /** 最短游戏时长 */
  minplaytime?: { value?: string };
  /** 最长游戏时长 */
  maxplaytime?: { value?: string };
  /** 建议最小年龄 */
  minage?: { value?: string };
  /** 关联链接（分类、机制、设计师、出版商等） */
  link?: BggLink | BggLink[];
  /** 投票数据（最佳人数、语言依赖度、年龄建议等） */
  poll?: BggPoll | BggPoll[];
  /** 统计数据（评分、排名等；需 stats=1） */
  statistics?: BggStatistics;
  /** 视频（需 videos=1） */
  videos?: { total?: string; video?: BggVideo | BggVideo[] };
  /** 版本信息（需 versions=1） */
  versions?: { item?: BggVersion | BggVersion[] };
  /** 评论列表（需 comments=1） */
  comments?: { page?: string; totalitems?: string; comment?: BggComment | BggComment[] };
  /** 评分评论列表（需 ratingcomments=1） */
  ratingcomments?: { page?: string; totalitems?: string; comment?: BggComment | BggComment[] };
  /** Marketplace 列表（需 marketplace=1） */
  marketplacelist?: { listing?: BggMarketplaceListing | BggMarketplaceListing[] };
}

/**
 * Thing API 请求参数
 *
 * 端点: /thing
 *
 * 用于获取一个或多个 Thing 条目的详细信息，包括桌游、扩展、配件等。
 * 可附加评论、统计、视频、版本、Marketplace 等子资源。
 */
export interface BggThingParams {
  /** 条目 ID，多个用逗号分隔（必填） */
  id: string;
  /** 过滤条目类型，多个用逗号分隔（可选） */
  type?: string;
  /** 是否包含版本信息（0 或 1） */
  versions?: 0 | 1;
  /** 是否包含视频（0 或 1） */
  videos?: 0 | 1;
  /** 是否包含统计数据（0 或 1） */
  stats?: 0 | 1;
  /** 是否包含历史数据（0 或 1；与 stats 配合使用，已弃用功能区域） */
  historical?: 0 | 1;
  /** 是否包含 Marketplace 列表（0 或 1） */
  marketplace?: 0 | 1;
  /** 是否包含评论（0 或 1；按用户名排序） */
  comments?: 0 | 1;
  /** 是否包含评分评论（0 或 1；按评分排序） */
  ratingcomments?: 0 | 1;
  /** 评论或评分评论的页码（每页 100 条） */
  page?: number;
  /** 每页条数（默认 100，最大 100） */
  pagesize?: number;
}

/** Thing API 响应根结构 */
export interface BggThingResponse {
  items?: {
    item?: BggThingItem | BggThingItem[];
    termsofuse?: string;
  };
}

// ─── Family 类型 (/family) ────────────────────────────────────

/**
 * Family 条目类型
 *
 * - boardgamefamily: 桌游系列
 * - rpg: 角色扮演游戏系列
 * - rpgperiodical: RPG 期刊系列
 */
export type BggFamilyType =
  | "boardgamefamily"
  | "rpg"
  | "rpgperiodical";

/** Family 条目结构 */
export interface BggFamilyItem {
  /** BGG 家族 ID */
  id?: string;
  /** 家族类型 */
  type?: string;
  /** 缩略图 URL */
  thumbnail?: string;
  /** 完整图片 URL */
  image?: string;
  /** 名称 */
  name?: BggName | BggName[];
  /** 描述（HTML） */
  description?: string;
  /** 关联链接（家族成员条目列表） */
  link?: BggLink | BggLink[];
}

/**
 * Family API 请求参数
 *
 * 端点: /family
 *
 * 用于获取一个或多个家族/系列条目。家族将关联的桌游、RPG 等条目聚合在一起。
 */
export interface BggFamilyParams {
  /** 家族 ID，多个用逗号分隔（必填） */
  id: string;
  /** 过滤家族类型，多个用逗号分隔（可选） */
  type?: string;
}

/** Family API 响应根结构 */
export interface BggFamilyResponse {
  items?: {
    item?: BggFamilyItem | BggFamilyItem[];
    termsofuse?: string;
  };
}

// ─── Forum List 类型 (/forumlist) ─────────────────────────────

/**
 * ForumList 关联对象类型
 *
 * - thing: 条目论坛（如某款桌游的论坛列表）
 * - family: 家族论坛
 */
export type BggForumListType = "thing" | "family";

/** 论坛条目 */
export interface BggForumListForum {
  /** 论坛 ID */
  id?: string;
  /** 论坛分组标题（如 "General"、"Reviews"） */
  groupid?: string;
  /** 论坛标题 */
  title?: string;
  /** 没有帖子时是否隐藏 */
  noposting?: string;
  /** 描述 */
  description?: string;
  /** 帖子数量 */
  numthreads?: string;
  /** 文章数量 */
  numposts?: string;
  /** 最后发帖时间 */
  lastpostdate?: string;
}

/**
 * ForumList API 请求参数
 *
 * 端点: /forumlist
 *
 * 获取某个 Thing 或 Family 关联的所有论坛列表。
 */
export interface BggForumListParams {
  /** 关联对象 ID（必填） */
  id: string;
  /** 关联对象类型: "thing" 或 "family"（必填） */
  type: BggForumListType;
}

/** ForumList API 响应根结构 */
export interface BggForumListResponse {
  forums?: {
    id?: string;
    type?: string;
    termsofuse?: string;
    forum?: BggForumListForum | BggForumListForum[];
  };
}

// ─── Forum 类型 (/forum) ──────────────────────────────────────

/** 论坛内的帖子条目 */
export interface BggForumThread {
  /** 帖子 ID */
  id?: string;
  /** 帖子标题 */
  subject?: string;
  /** 作者用户名 */
  author?: string;
  /** 回复数量 */
  numarticles?: string;
  /** 发帖时间 */
  postdate?: string;
  /** 最后发帖时间 */
  lastpostdate?: string;
}

/**
 * Forum API 请求参数
 *
 * 端点: /forum
 *
 * 获取指定论坛中的帖子列表，支持分页。
 */
export interface BggForumParams {
  /** 论坛 ID（必填） */
  id: string;
  /** 页码（默认 1，每页约 50 个帖子） */
  page?: number;
}

/** Forum API 响应根结构 */
export interface BggForumResponse {
  forum?: {
    id?: string;
    title?: string;
    numthreads?: string;
    numposts?: string;
    lastpostdate?: string;
    noposting?: string;
    termsofuse?: string;
    threads?: {
      thread?: BggForumThread | BggForumThread[];
    };
  };
}

// ─── Thread 类型 (/thread) ────────────────────────────────────

/** 帖子中的文章（回复） */
export interface BggThreadArticle {
  /** 文章 ID */
  id?: string;
  /** 作者用户名 */
  username?: string;
  /** 链接 */
  link?: string;
  /** 发表日期 */
  postdate?: string;
  /** 编辑日期 */
  editdate?: string;
  /** 回复数 */
  numedits?: string;
  /** 文章内容（HTML） */
  body?: string;
}

/**
 * Thread API 请求参数
 *
 * 端点: /thread
 *
 * 获取指定帖子的所有文章（回复），支持按日期范围过滤和分页。
 */
export interface BggThreadParams {
  /** 帖子 ID（必填） */
  id: string;
  /** 只返回此日期之后的文章（格式: YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS） */
  minarticledate?: string;
  /** 只返回此日期之前的文章（格式同上） */
  maxarticledate?: string;
  /** 只返回此 ID 之后的文章 */
  minarticleid?: string;
  /** 返回条数上限（注意: 仅从最新文章向前截取） */
  count?: number;
}

/** Thread API 响应根结构 */
export interface BggThreadResponse {
  thread?: {
    id?: string;
    subject?: string;
    numarticles?: string;
    link?: string;
    termsofuse?: string;
    articles?: {
      article?: BggThreadArticle | BggThreadArticle[];
    };
  };
}

// ─── User 类型 (/user) ───────────────────────────────────────

/** 用户好友 */
export interface BggUserBuddy {
  id?: string;
  name?: string;
}

/** 用户所属公会 */
export interface BggUserGuild {
  id?: string;
  name?: string;
}

/** 用户热门条目 */
export interface BggUserHotItem {
  rank?: string;
  type?: string;
  id?: string;
  name?: { value?: string };
}

/** 用户详情 */
export interface BggUserInfo {
  /** 用户 ID */
  id?: string;
  /** 用户名 */
  name?: string;
  /** 名 */
  firstname?: { value?: string };
  /** 姓 */
  lastname?: { value?: string };
  /** 头像链接 */
  avatarlink?: { value?: string };
  /** 注册年份 */
  yearregistered?: { value?: string };
  /** 最后登录日期 */
  lastlogin?: { value?: string };
  /** 所在州/省 */
  stateorprovince?: { value?: string };
  /** 所在国家 */
  country?: { value?: string };
  /** 个人网站 */
  webaddress?: { value?: string };
  /** Xbox 账号 */
  xboxaccount?: { value?: string };
  /** Wii 账号 */
  wiiaccount?: { value?: string };
  /** PSN 账号 */
  psnaccount?: { value?: string };
  /** BattleNet 账号 */
  battlenetaccount?: { value?: string };
  /** Steam 账号 */
  steamaccount?: { value?: string };
  /** 交易评分 */
  traderating?: { value?: string };
  /** 好友列表（需 buddies=1） */
  buddies?: {
    total?: string;
    page?: string;
    buddy?: BggUserBuddy | BggUserBuddy[];
  };
  /** 公会列表（需 guilds=1） */
  guilds?: {
    total?: string;
    page?: string;
    guild?: BggUserGuild | BggUserGuild[];
  };
  /** 热门条目（需 hot=1） */
  hot?: {
    domain?: string;
    item?: BggUserHotItem | BggUserHotItem[];
  };
  /** 最高条目（需 top=1） */
  top?: {
    domain?: string;
    item?: BggUserHotItem | BggUserHotItem[];
  };
}

/**
 * User API 请求参数
 *
 * 端点: /user
 *
 * 获取指定用户的详细信息，可附加好友列表、公会列表、热门/最高条目。
 */
export interface BggUserParams {
  /** 用户名（必填） */
  name: string;
  /** 是否包含好友列表（0 或 1） */
  buddies?: 0 | 1;
  /** 是否包含公会列表（0 或 1） */
  guilds?: 0 | 1;
  /** 是否包含热门条目（0 或 1） */
  hot?: 0 | 1;
  /** 是否包含最高条目（0 或 1） */
  top?: 0 | 1;
  /** 热门/最高条目的领域过滤（如 "boardgame"、"rpg" 等） */
  domain?: string;
  /** 好友/公会列表的页码 */
  page?: number;
}

/** User API 响应根结构 */
export interface BggUserResponse {
  user?: BggUserInfo;
}

// ─── Guild 类型 (/guild) ──────────────────────────────────────

/** 公会成员 */
export interface BggGuildMember {
  name?: string;
  date?: string;
}

/** 公会详情 */
export interface BggGuildInfo {
  /** 公会 ID */
  id?: string;
  /** 公会名称 */
  name?: string;
  /** 创建日期 */
  created?: string;
  /** 公会分类 */
  category?: string;
  /** 网站 */
  website?: string;
  /** 管理员 */
  manager?: string;
  /** 描述 */
  description?: string;
  /** 所在地（城市、州、国家、邮编） */
  location?: {
    addr1?: { value?: string };
    addr2?: { value?: string };
    city?: { value?: string };
    stateorprovince?: { value?: string };
    postalcode?: { value?: string };
    country?: { value?: string };
  };
  /** 成员列表（需 members=1） */
  members?: {
    count?: string;
    page?: string;
    member?: BggGuildMember | BggGuildMember[];
  };
}

/**
 * Guild API 请求参数
 *
 * 端点: /guild
 *
 * 获取指定公会的详细信息，可附加成员列表。
 */
export interface BggGuildParams {
  /** 公会 ID（必填） */
  id: string;
  /** 是否包含成员列表（0 或 1） */
  members?: 0 | 1;
  /** 按排序方式排列成员: "username" 或 "date" */
  sort?: "username" | "date";
  /** 成员列表页码 */
  page?: number;
}

/** Guild API 响应根结构 */
export interface BggGuildResponse {
  guild?: BggGuildInfo;
}

// ─── Plays 类型 (/plays) ─────────────────────────────────────

/** 单次游戏记录中的条目 */
export interface BggPlayItem {
  /** 条目名称 */
  name?: string;
  /** 条目类型 */
  objecttype?: string;
  /** 条目 ID */
  objectid?: string;
}

/** 游戏记录中的玩家 */
export interface BggPlayPlayer {
  username?: string;
  userid?: string;
  name?: string;
  startposition?: string;
  color?: string;
  score?: string;
  new?: string;
  rating?: string;
  win?: string;
}

/** 单次游戏记录 */
export interface BggPlay {
  /** 记录 ID */
  id?: string;
  /** 游戏日期 */
  date?: string;
  /** 游戏次数 */
  quantity?: string;
  /** 游戏时长（分钟） */
  length?: string;
  /** 是否未完成 */
  incomplete?: string;
  /** 是否不计分 */
  nowinstats?: string;
  /** 所在位置 */
  location?: string;
  /** 条目信息 */
  item?: BggPlayItem;
  /** 评论 */
  comments?: string;
  /** 玩家列表 */
  players?: {
    player?: BggPlayPlayer | BggPlayPlayer[];
  };
}

/**
 * Plays API 请求参数
 *
 * 端点: /plays
 *
 * 获取用户或条目的游戏记录。必须指定 username 或 id 中的一个。
 * 支持按日期范围、条目类型等过滤，每页返回最多 100 条记录。
 */
export interface BggPlaysParams {
  /** 用户名（与 id 二选一） */
  username?: string;
  /** 条目 ID（与 username 二选一） */
  id?: string;
  /** 过滤条目类型 */
  type?: string;
  /** 只返回此日期之后的记录（格式: YYYY-MM-DD） */
  mindate?: string;
  /** 只返回此日期之前的记录（格式: YYYY-MM-DD） */
  maxdate?: string;
  /** 过滤特定子类型 */
  subtype?: string;
  /** 页码（每页 100 条） */
  page?: number;
}

/** Plays API 响应根结构 */
export interface BggPlaysResponse {
  plays?: {
    username?: string;
    userid?: string;
    total?: string;
    page?: string;
    termsofuse?: string;
    play?: BggPlay | BggPlay[];
  };
}

// ─── Collection 类型 (/collection) ────────────────────────────

/** 收藏条目状态 */
export interface BggCollectionStatus {
  own?: string;
  prevowned?: string;
  fortrade?: string;
  want?: string;
  wanttoplay?: string;
  wanttobuy?: string;
  wishlist?: string;
  wishlistpriority?: string;
  preordered?: string;
  lastmodified?: string;
}

/** 收藏条目统计 */
export interface BggCollectionStats {
  minplayers?: { value?: string };
  maxplayers?: { value?: string };
  minplaytime?: { value?: string };
  maxplaytime?: { value?: string };
  playingtime?: { value?: string };
  numowned?: { value?: string };
  rating?: { value?: string };
  ranks?: {
    rank?:
      | {
          type?: string;
          id?: string;
          name?: string;
          friendlyname?: string;
          value?: string;
          bayesaverage?: string;
        }
      | Array<{
          type?: string;
          id?: string;
          name?: string;
          friendlyname?: string;
          value?: string;
          bayesaverage?: string;
        }>;
  };
}

/** 收藏条目 */
export interface BggCollectionItem {
  /** 条目 ID */
  objectid?: string;
  /** 条目类型 */
  objecttype?: string;
  /** 子类型 */
  subtype?: string;
  /** 收藏 ID */
  collid?: string;
  /** 名称 */
  name?: { _text?: string; sortindex?: string };
  /** 发布年份 */
  yearpublished?: string;
  /** 图片 URL */
  image?: string;
  /** 缩略图 URL */
  thumbnail?: string;
  /** 收藏状态标记 */
  status?: BggCollectionStatus;
  /** 游戏次数 */
  numplays?: string;
  /** 用户评论 */
  comment?: string;
  /** 条件评论 */
  conditiontext?: string;
  /** 愿望清单评论 */
  wishlistcomment?: string;
  /** 统计数据（需 stats=1） */
  stats?: BggCollectionStats;
}

/**
 * Collection API 请求参数
 *
 * 端点: /collection
 *
 * 获取指定用户的收藏列表。支持多种筛选条件，可获取评分、统计等附加信息。
 *
 * 注意: 如果收藏较大，BGG 可能返回 HTTP 202 表示正在生成中，需稍后重试。
 */
export interface BggCollectionParams {
  /** 用户名（必填） */
  username: string;
  /** 是否包含版本信息（0 或 1） */
  version?: 0 | 1;
  /** 子类型过滤（如 "boardgame"、"boardgameexpansion" 等） */
  subtype?: string;
  /** 排除子类型 */
  excludesubtype?: string;
  /** 只返回指定 ID 的条目，多个用逗号分隔 */
  id?: string;
  /** 是否包含简要信息（0 或 1；默认返回简要信息） */
  brief?: 0 | 1;
  /** 是否包含统计数据（0 或 1） */
  stats?: 0 | 1;
  /** 筛选：已拥有（0 或 1） */
  own?: 0 | 1;
  /** 筛选：已评分（0 或 1） */
  rated?: 0 | 1;
  /** 筛选：已玩过（0 或 1） */
  played?: 0 | 1;
  /** 筛选：有评论（0 或 1） */
  comment?: 0 | 1;
  /** 筛选：求交易（0 或 1） */
  trade?: 0 | 1;
  /** 筛选：想玩（0 或 1） */
  want?: 0 | 1;
  /** 筛选：愿望清单（0 或 1） */
  wishlist?: 0 | 1;
  /** 筛选：愿望清单优先级（1-5） */
  wishlistpriority?: 1 | 2 | 3 | 4 | 5;
  /** 筛选：预购（0 或 1） */
  preordered?: 0 | 1;
  /** 筛选：想购买（0 或 1） */
  wanttoplay?: 0 | 1;
  /** 筛选：想购买（0 或 1） */
  wanttobuy?: 0 | 1;
  /** 筛选：曾拥有（0 或 1） */
  prevowned?: 0 | 1;
  /** 筛选：有条件文本（0 或 1） */
  hasparts?: 0 | 1;
  /** 筛选：缺少配件文本（0 或 1） */
  wantparts?: 0 | 1;
  /** 最低评分（1-10） */
  minrating?: number;
  /** 最高评分（1-10） */
  rating?: number;
  /** 最低 BGG 评分 */
  minbggrating?: number;
  /** 最高 BGG 评分 */
  bggrating?: number;
  /** 最少游戏次数 */
  minplays?: number;
  /** 最多游戏次数 */
  maxplays?: number;
  /** 只返回此日期之后修改过的收藏（格式: YYYY-MM-DD） */
  modifiedsince?: string;
  /** 收藏 ID */
  collid?: string;
}

/** Collection API 响应根结构 */
export interface BggCollectionResponse {
  items?: {
    totalitems?: string;
    termsofuse?: string;
    pubdate?: string;
    item?: BggCollectionItem | BggCollectionItem[];
  };
}

// ─── Hot 类型 (/hot) ──────────────────────────────────────────

/**
 * Hot 条目类型
 *
 * - boardgame: 桌游热门
 * - rpg: RPG 热门
 * - videogame: 电子游戏热门
 * - boardgameperson: 桌游人物热门
 * - rpgperson: RPG 人物热门
 * - boardgamecompany: 桌游公司热门
 * - rpgcompany: RPG 公司热门
 * - videogamecompany: 电子游戏公司热门
 */
export type BggHotType =
  | "boardgame"
  | "rpg"
  | "videogame"
  | "boardgameperson"
  | "rpgperson"
  | "boardgamecompany"
  | "rpgcompany"
  | "videogamecompany";

/** 热门条目 */
export interface BggHotItem {
  /** 排名 */
  rank?: string;
  /** BGG 条目 ID */
  id?: string;
  /** 名称 */
  name?: { value?: string };
  /** 缩略图 URL */
  thumbnail?: { value?: string };
  /** 发布年份 */
  yearpublished?: { value?: string };
}

/**
 * Hot API 请求参数
 *
 * 端点: /hot
 *
 * 获取 BGG 各类条目的热门列表（通常返回前 50 条）。
 */
export interface BggHotParams {
  /** 热门条目类型（必填） */
  type: BggHotType;
}

/** Hot API 响应根结构 */
export interface BggHotResponse {
  items?: {
    termsofuse?: string;
    item?: BggHotItem | BggHotItem[];
  };
}

// ─── Search 类型 (/search) ────────────────────────────────────

/**
 * Search 条目类型
 *
 * 可搜索的条目类型，与 Thing 类型基本一致。
 */
export type BggSearchType =
  | "boardgame"
  | "boardgameexpansion"
  | "boardgameaccessory"
  | "videogame"
  | "rpgitem"
  | "rpgissue";

/** 搜索结果条目 */
export interface BggSearchItem {
  /** BGG 条目 ID */
  id?: string;
  /** 条目类型 */
  type?: string;
  /** 名称 */
  name?: { value?: string; type?: string };
  /** 发布年份 */
  yearpublished?: { value?: string };
}

/**
 * Search API 请求参数
 *
 * 端点: /search
 *
 * 搜索 BGG 数据库中的条目。支持按类型过滤和精确匹配。
 */
export interface BggSearchParams {
  /** 搜索关键词（必填） */
  query: string;
  /** 过滤条目类型，多个用逗号分隔（可选） */
  type?: string;
  /** 是否精确匹配名称（0 或 1；默认 0 为模糊搜索） */
  exact?: 0 | 1;
}

/** Search API 响应根结构 */
export interface BggSearchResponse {
  items?: {
    total?: string;
    termsofuse?: string;
    item?: BggSearchItem | BggSearchItem[];
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  API 调用函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 获取 Thing 条目详情
 *
 * 端点: GET /xmlapi2/thing
 *
 * 根据条目 ID 获取一个或多个 Thing 的详细信息。
 * 可附加评论、统计数据、视频、版本信息、Marketplace 列表等子资源。
 *
 * @example
 * ```ts
 * // 获取《Catan》的详情（含统计数据和视频）
 * const result = await fetchThingItems({ id: "13", stats: 1, videos: 1 });
 * const items = toArray(result.items?.item);
 * ```
 *
 * @example
 * ```ts
 * // 批量获取多个桌游的详情
 * const result = await fetchThingItems({ id: "174430,167791,224517", type: "boardgame" });
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 Thing 响应
 */
export async function fetchThingItems(params: BggThingParams): Promise<BggThingResponse> {
  const query = buildQuery({
    id: params.id,
    type: params.type,
    versions: params.versions,
    videos: params.videos,
    stats: params.stats,
    historical: params.historical,
    marketplace: params.marketplace,
    comments: params.comments,
    ratingcomments: params.ratingcomments,
    page: params.page,
    pagesize: params.pagesize,
  });
  return fetchBggXml<BggThingResponse>(`/thing${query}`);
}

/**
 * 获取 Family 家族/系列条目
 *
 * 端点: GET /xmlapi2/family
 *
 * 根据家族 ID 获取系列条目信息。一个家族将多个相关条目聚合在一起，
 * 例如"卡坦岛系列"、"Ticket to Ride 系列"等。
 *
 * @example
 * ```ts
 * // 获取家族详情
 * const result = await fetchFamilyItems({ id: "3", type: "boardgamefamily" });
 * const items = toArray(result.items?.item);
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 Family 响应
 */
export async function fetchFamilyItems(params: BggFamilyParams): Promise<BggFamilyResponse> {
  const query = buildQuery({
    id: params.id,
    type: params.type,
  });
  return fetchBggXml<BggFamilyResponse>(`/family${query}`);
}

/**
 * 获取论坛列表
 *
 * 端点: GET /xmlapi2/forumlist
 *
 * 获取某个 Thing 或 Family 关联的所有论坛列表。
 * 每个条目在 BGG 上通常有多个论坛分区（如 General、Reviews、Strategy 等）。
 *
 * @example
 * ```ts
 * // 获取《Catan》(id=13) 的论坛列表
 * const result = await fetchForumList({ id: "13", type: "thing" });
 * const forums = toArray(result.forums?.forum);
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 ForumList 响应
 */
export async function fetchForumList(params: BggForumListParams): Promise<BggForumListResponse> {
  const query = buildQuery({
    id: params.id,
    type: params.type,
  });
  return fetchBggXml<BggForumListResponse>(`/forumlist${query}`);
}

/**
 * 获取论坛帖子列表
 *
 * 端点: GET /xmlapi2/forum
 *
 * 获取指定论坛中的帖子列表，支持分页。每页约 50 个帖子。
 *
 * @example
 * ```ts
 * // 获取论坛 ID=19 的帖子列表
 * const result = await fetchForum({ id: "19", page: 1 });
 * const threads = toArray(result.forum?.threads?.thread);
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 Forum 响应
 */
export async function fetchForum(params: BggForumParams): Promise<BggForumResponse> {
  const query = buildQuery({
    id: params.id,
    page: params.page,
  });
  return fetchBggXml<BggForumResponse>(`/forum${query}`);
}

/**
 * 获取帖子文章详情
 *
 * 端点: GET /xmlapi2/thread
 *
 * 获取指定帖子的所有文章（回复），支持按日期范围和文章 ID 过滤。
 *
 * @example
 * ```ts
 * // 获取帖子 ID=100000 的所有文章
 * const result = await fetchThread({ id: "100000" });
 * const articles = toArray(result.thread?.articles?.article);
 * ```
 *
 * @example
 * ```ts
 * // 获取帖子中 2024 年以后的文章
 * const result = await fetchThread({ id: "100000", minarticledate: "2024-01-01" });
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 Thread 响应
 */
export async function fetchThread(params: BggThreadParams): Promise<BggThreadResponse> {
  const query = buildQuery({
    id: params.id,
    minarticledate: params.minarticledate,
    maxarticledate: params.maxarticledate,
    minarticleid: params.minarticleid,
    count: params.count,
  });
  return fetchBggXml<BggThreadResponse>(`/thread${query}`);
}

/**
 * 获取用户信息
 *
 * 端点: GET /xmlapi2/user
 *
 * 获取指定用户的详细信息，包括基本资料、交易评分等。
 * 可附加好友列表、公会列表、热门条目和最高条目。
 *
 * @example
 * ```ts
 * // 获取用户基本信息
 * const result = await fetchUser({ name: "eekspider" });
 * console.log(result.user?.firstname?.value);
 * ```
 *
 * @example
 * ```ts
 * // 获取用户及其好友和公会列表
 * const result = await fetchUser({ name: "eekspider", buddies: 1, guilds: 1, page: 1 });
 * const buddies = toArray(result.user?.buddies?.buddy);
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 User 响应
 */
export async function fetchUser(params: BggUserParams): Promise<BggUserResponse> {
  const query = buildQuery({
    name: params.name,
    buddies: params.buddies,
    guilds: params.guilds,
    hot: params.hot,
    top: params.top,
    domain: params.domain,
    page: params.page,
  });
  return fetchBggXml<BggUserResponse>(`/user${query}`);
}

/**
 * 获取公会信息
 *
 * 端点: GET /xmlapi2/guild
 *
 * 获取指定公会的详细信息，可附加成员列表（支持排序和分页）。
 *
 * @example
 * ```ts
 * // 获取公会详情及成员列表
 * const result = await fetchGuild({ id: "1303", members: 1, page: 1 });
 * const members = toArray(result.guild?.members?.member);
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 Guild 响应
 */
export async function fetchGuild(params: BggGuildParams): Promise<BggGuildResponse> {
  const query = buildQuery({
    id: params.id,
    members: params.members,
    sort: params.sort,
    page: params.page,
  });
  return fetchBggXml<BggGuildResponse>(`/guild${query}`);
}

/**
 * 获取游戏记录
 *
 * 端点: GET /xmlapi2/plays
 *
 * 获取指定用户或条目的游戏记录（Play Log）。每页最多 100 条记录。
 * 必须至少提供 username 或 id 中的一个。
 *
 * @example
 * ```ts
 * // 获取用户的全部游戏记录
 * const result = await fetchPlays({ username: "eekspider", page: 1 });
 * const plays = toArray(result.plays?.play);
 * ```
 *
 * @example
 * ```ts
 * // 获取某个桌游被玩的记录
 * const result = await fetchPlays({ id: "174430", page: 1 });
 * ```
 *
 * @example
 * ```ts
 * // 按日期范围过滤
 * const result = await fetchPlays({
 *   username: "eekspider",
 *   mindate: "2024-01-01",
 *   maxdate: "2024-12-31",
 * });
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 Plays 响应
 */
export async function fetchPlays(params: BggPlaysParams): Promise<BggPlaysResponse> {
  const query = buildQuery({
    username: params.username,
    id: params.id,
    type: params.type,
    mindate: params.mindate,
    maxdate: params.maxdate,
    subtype: params.subtype,
    page: params.page,
  });
  return fetchBggXml<BggPlaysResponse>(`/plays${query}`);
}

/**
 * 获取用户收藏
 *
 * 端点: GET /xmlapi2/collection
 *
 * 获取指定用户的收藏列表（Collection）。支持极其丰富的筛选条件，
 * 包括拥有状态、评分、游戏次数、修改日期等。
 *
 * 注意: 如果用户收藏较大，BGG 可能返回 HTTP 202（Accepted）状态码，
 * 表示正在后台生成收藏数据，客户端需要等待几秒后重试。
 * 建议调用方实现重试逻辑。
 *
 * @example
 * ```ts
 * // 获取用户拥有的桌游收藏（含统计数据）
 * const result = await fetchCollection({
 *   username: "eekspider",
 *   subtype: "boardgame",
 *   own: 1,
 *   stats: 1,
 * });
 * const items = toArray(result.items?.item);
 * ```
 *
 * @example
 * ```ts
 * // 获取用户评分 8 分以上的收藏
 * const result = await fetchCollection({
 *   username: "eekspider",
 *   minrating: 8,
 *   rated: 1,
 * });
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 Collection 响应
 */
export async function fetchCollection(params: BggCollectionParams): Promise<BggCollectionResponse> {
  const query = buildQuery({
    username: params.username,
    version: params.version,
    subtype: params.subtype,
    excludesubtype: params.excludesubtype,
    id: params.id,
    brief: params.brief,
    stats: params.stats,
    own: params.own,
    rated: params.rated,
    played: params.played,
    comment: params.comment,
    trade: params.trade,
    want: params.want,
    wishlist: params.wishlist,
    wishlistpriority: params.wishlistpriority,
    preordered: params.preordered,
    wanttoplay: params.wanttoplay,
    wanttobuy: params.wanttobuy,
    prevowned: params.prevowned,
    hasparts: params.hasparts,
    wantparts: params.wantparts,
    minrating: params.minrating,
    rating: params.rating,
    minbggrating: params.minbggrating,
    bggrating: params.bggrating,
    minplays: params.minplays,
    maxplays: params.maxplays,
    modifiedsince: params.modifiedsince,
    collid: params.collid,
  });
  return fetchBggXml<BggCollectionResponse>(`/collection${query}`);
}

/**
 * 获取带重试的用户收藏
 *
 * 封装了 BGG Collection API 的 HTTP 202 重试逻辑。
 * 当 BGG 返回 202（收藏正在生成中）时，自动等待并重试。
 *
 * @param params - Collection 请求参数
 * @param maxRetries - 最大重试次数（默认 5）
 * @param retryDelayMs - 每次重试的等待时间（毫秒，默认 3000）
 * @returns 解析后的 Collection 响应
 */
export async function fetchCollectionWithRetry(
  params: BggCollectionParams,
  maxRetries = 5,
  retryDelayMs = 3000,
): Promise<BggCollectionResponse> {
  const queryStr = buildQuery({
    username: params.username,
    version: params.version,
    subtype: params.subtype,
    excludesubtype: params.excludesubtype,
    id: params.id,
    brief: params.brief,
    stats: params.stats,
    own: params.own,
    rated: params.rated,
    played: params.played,
    comment: params.comment,
    trade: params.trade,
    want: params.want,
    wishlist: params.wishlist,
    wishlistpriority: params.wishlistpriority,
    preordered: params.preordered,
    wanttoplay: params.wanttoplay,
    wanttobuy: params.wanttobuy,
    prevowned: params.prevowned,
    hasparts: params.hasparts,
    wantparts: params.wantparts,
    minrating: params.minrating,
    rating: params.rating,
    minbggrating: params.minbggrating,
    bggrating: params.bggrating,
    minplays: params.minplays,
    maxplays: params.maxplays,
    modifiedsince: params.modifiedsince,
    collid: params.collid,
  });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(`${BGG_API_BASE}/collection${queryStr}`, {
        headers: authHeaders(),
        signal: controller.signal,
      });

      if (response.status === 202 && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }

      if (!response.ok) {
        throw new Error(`BGG API error: ${response.status} ${response.statusText}`);
      }

      const xml = await response.text();
      return xmlParser.parse(xml) as BggCollectionResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("BGG Collection API: 超过最大重试次数，收藏可能仍在生成中");
}

/**
 * 获取热门条目
 *
 * 端点: GET /xmlapi2/hot
 *
 * 获取 BGG 各类条目的热门排行榜，通常返回前 50 条。
 * 热门列表由 BGG 根据近期活跃度自动计算。
 *
 * @example
 * ```ts
 * // 获取桌游热门列表
 * const result = await fetchHotItems({ type: "boardgame" });
 * const items = toArray(result.items?.item);
 * items.forEach(item => {
 *   console.log(`#${item.rank} ${item.name?.value} (${item.yearpublished?.value})`);
 * });
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 Hot 响应
 */
export async function fetchHotItems(params: BggHotParams): Promise<BggHotResponse> {
  const query = buildQuery({
    type: params.type,
  });
  return fetchBggXml<BggHotResponse>(`/hot${query}`);
}

/**
 * 搜索 BGG 条目
 *
 * 端点: GET /xmlapi2/search
 *
 * 在 BGG 数据库中搜索条目。默认为模糊搜索，可设置 exact=1 进行精确匹配。
 * 搜索结果只包含基本信息（ID、名称、年份），如需详情需再调用 fetchThingItems。
 *
 * ## 多语言搜索行为（2026-04 实测）
 *
 * BGG Search API 支持中文、日文等非拉丁语系查询，会匹配条目的 alternate name。
 *
 * | 查询语言 | 示例       | 结果数 | 响应时间 | 匹配方式                    |
 * |---------|-----------|-------|---------|---------------------------|
 * | 中文     | "铁路"     | 7     | ~740ms  | alternate name 精确包含匹配 |
 * | 中文     | "卡坦岛"   | 1     | ~550ms  | alternate name 精确匹配     |
 * | 中文     | "璀璨宝石" | 5     | ~260ms  | alternate name 精确匹配     |
 * | 日文     | "カタン"   | 9     | ~290ms  | alternate name 精确包含匹配 |
 * | 英文     | "catan"   | 141   | ~1000ms | primary + alternate name   |
 * | 英文     | "railway" | 210   | ~890ms  | primary + alternate name   |
 *
 * 关键发现：
 * - CJK 查询返回结果远少于英文（通常 < 10 条），因为只匹配已录入的翻译名。
 * - CJK 查询响应速度通常更快（结果少 → 传输小）。
 * - 中文搜索匹配的是社区维护的 alternate name，非所有桌游都有中文名。
 * - 搜索不支持模糊/拼音匹配，只做子串精确匹配。
 *
 * @example
 * ```ts
 * // 模糊搜索桌游
 * const result = await searchItems({ query: "Catan", type: "boardgame" });
 * const items = toArray(result.items?.item);
 * ```
 *
 * @example
 * ```ts
 * // 精确匹配
 * const result = await searchItems({ query: "Catan", type: "boardgame", exact: 1 });
 * ```
 *
 * @param params - 请求参数
 * @returns 解析后的 Search 响应
 */
export async function searchItems(params: BggSearchParams): Promise<BggSearchResponse> {
  const query = buildQuery({
    query: params.query,
    type: params.type,
    exact: params.exact,
  });
  return fetchBggXml<BggSearchResponse>(`/search${query}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  导出工具函数（方便调用方使用）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 将可能为单个值或数组的 BGG XML 字段统一转为数组
 *
 * BGG XML API 的一个常见特点是：当只有一个子元素时，XML 解析器会将其解析为
 * 单个对象而非数组。使用此函数可以安全地将任何字段转为数组进行遍历。
 *
 * @example
 * ```ts
 * const result = await fetchThingItems({ id: "174430" });
 * const items = bggToArray(result.items?.item);
 * for (const item of items) {
 *   const names = bggToArray(item.name);
 *   const primaryName = names.find(n => n.type === "primary")?.value;
 * }
 * ```
 */
export { toArray as bggToArray };
