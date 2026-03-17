export type SubjectKind =
  | "game"
  | "boardgame"
  | "anime"
  | "tv"
  | "movie"
  | "manga"
  | "lightnovel"
  | "work"
  | "song"
  | "album"
  | "character"
  | "person";

export type AppLocale = "zh" | "en";

export const DEFAULT_SUBJECT_KIND: SubjectKind = "boardgame";

export const SUBJECT_KIND_ORDER: SubjectKind[] = [
  "boardgame",
  // "game",
  // "anime",
  // "tv",
  // "movie",
  // "manga",
  // "lightnovel",
  // "song",
  // "album",
  // "work",
  // "character",
  // "person",
];

type KindSearchConfig = {
  typeFilter?: number[];
  strictPlatform?: string;
  bangumiSearchCat?: number;
};

export type SubjectKindMeta = {
  kind: SubjectKind;
  label: string;
  longLabel: string;
  selectionUnit: string;
  subtitle: string;
  searchPlaceholder: string;
  searchDialogTitle: string;
  searchIdleHint: string;
  draftStorageKey: string;
  trendLabel: string;
  search: KindSearchConfig;
};

const KIND_META_MAP: Record<SubjectKind, SubjectKindMeta> = {
  game: {
    kind: "game",
    label: "游戏",
    longLabel: "九部游戏",
    selectionUnit: "部",
    subtitle: "向世界传达你所爱的游戏。",
    searchPlaceholder: "输入游戏名称",
    searchDialogTitle: "搜索游戏",
    searchIdleHint: "输入游戏名称开始搜索",
    draftStorageKey: "my-nine-game:v1",
    trendLabel: "游戏",
    search: {
      typeFilter: [4],
      bangumiSearchCat: 4,
    },
  },
  boardgame: {
    kind: "boardgame",
    label: "桌游",
    longLabel: "九款桌游",
    selectionUnit: "款",
    subtitle: "向世界传达你所爱的桌游。",
    searchPlaceholder: "输入桌游名称",
    searchDialogTitle: "搜索桌游",
    searchIdleHint: "输入桌游名称开始搜索",
    draftStorageKey: "my-nine-boardgame:v1",
    trendLabel: "桌游",
    search: {},
  },
  anime: {
    kind: "anime",
    label: "动画",
    longLabel: "九部动画",
    selectionUnit: "部",
    subtitle: "向世界传达你所爱的动画。",
    searchPlaceholder: "输入动画名称",
    searchDialogTitle: "搜索动画",
    searchIdleHint: "输入动画名称开始搜索",
    draftStorageKey: "my-nine-anime:v1",
    trendLabel: "动画",
    search: {
      typeFilter: [2],
      bangumiSearchCat: 2,
    },
  },
  manga: {
    kind: "manga",
    label: "漫画",
    longLabel: "九部漫画",
    selectionUnit: "部",
    subtitle: "向世界传达你所爱的漫画。",
    searchPlaceholder: "输入漫画名称",
    searchDialogTitle: "搜索漫画",
    searchIdleHint: "输入漫画名称开始搜索",
    draftStorageKey: "my-nine-manga:v1",
    trendLabel: "漫画",
    search: {
      typeFilter: [1],
      strictPlatform: "漫画",
      bangumiSearchCat: 1,
    },
  },
  lightnovel: {
    kind: "lightnovel",
    label: "轻小说",
    longLabel: "九部轻小说",
    selectionUnit: "部",
    subtitle: "向世界传达你所爱的轻小说。",
    searchPlaceholder: "输入轻小说名称",
    searchDialogTitle: "搜索轻小说",
    searchIdleHint: "输入轻小说名称开始搜索",
    draftStorageKey: "my-nine-lightnovel:v1",
    trendLabel: "轻小说",
    search: {
      typeFilter: [1],
      strictPlatform: "小说",
      bangumiSearchCat: 1,
    },
  },
  tv: {
    kind: "tv",
    label: "电视剧",
    longLabel: "九部电视剧",
    selectionUnit: "部",
    subtitle: "向世界传达你所爱的电视剧。",
    searchPlaceholder: "输入电视剧名称",
    searchDialogTitle: "搜索电视剧",
    searchIdleHint: "输入电视剧名称开始搜索",
    draftStorageKey: "my-nine-tv:v1",
    trendLabel: "电视剧",
    search: {},
  },
  movie: {
    kind: "movie",
    label: "电影",
    longLabel: "九部电影",
    selectionUnit: "部",
    subtitle: "向世界传达你所爱的电影。",
    searchPlaceholder: "输入电影名称",
    searchDialogTitle: "搜索电影",
    searchIdleHint: "输入电影名称开始搜索",
    draftStorageKey: "my-nine-movie:v1",
    trendLabel: "电影",
    search: {},
  },
  work: {
    kind: "work",
    label: "作品",
    longLabel: "九部作品",
    selectionUnit: "部",
    subtitle: "向世界传达你所爱的作品。",
    searchPlaceholder: "输入作品名称",
    searchDialogTitle: "搜索作品",
    searchIdleHint: "输入作品名称开始搜索",
    draftStorageKey: "my-nine-work:v1",
    trendLabel: "作品",
    search: {},
  },
  song: {
    kind: "song",
    label: "单曲",
    longLabel: "九首单曲",
    selectionUnit: "首",
    subtitle: "向世界传达你所爱的单曲。",
    searchPlaceholder: "输入单曲/歌曲名称",
    searchDialogTitle: "搜索单曲",
    searchIdleHint: "输入单曲名称开始搜索",
    draftStorageKey: "my-nine-song:v1",
    trendLabel: "单曲",
    search: {},
  },
  album: {
    kind: "album",
    label: "专辑",
    longLabel: "九张专辑",
    selectionUnit: "张",
    subtitle: "向世界传达你所爱的专辑。",
    searchPlaceholder: "输入专辑名称",
    searchDialogTitle: "搜索专辑",
    searchIdleHint: "输入专辑名称开始搜索",
    draftStorageKey: "my-nine-album:v1",
    trendLabel: "专辑",
    search: {},
  },
  character: {
    kind: "character",
    label: "角色",
    longLabel: "九名角色",
    selectionUnit: "名",
    subtitle: "向世界传达你所爱的角色。",
    searchPlaceholder: "输入角色名称",
    searchDialogTitle: "搜索角色",
    searchIdleHint: "输入角色名称开始搜索",
    draftStorageKey: "my-nine-character:v1",
    trendLabel: "角色",
    search: {},
  },
  person: {
    kind: "person",
    label: "人物",
    longLabel: "九位人物",
    selectionUnit: "位",
    subtitle: "向世界传达你所爱的人物。",
    searchPlaceholder: "输入人物名称",
    searchDialogTitle: "搜索人物",
    searchIdleHint: "输入人物名称开始搜索",
    draftStorageKey: "my-nine-person:v1",
    trendLabel: "人物",
    search: {},
  },
};

const KIND_META_EN_OVERRIDES: Partial<Record<SubjectKind, Partial<SubjectKindMeta>>> = {
  game: {
    label: "Games",
    longLabel: "Nine Games",
    selectionUnit: "games",
    subtitle: "Share the games you love with the world.",
    searchPlaceholder: "Search games",
    searchDialogTitle: "Search games",
    searchIdleHint: "Type to search games",
    trendLabel: "Games",
  },
  boardgame: {
    label: "Board games",
    longLabel: "Nine board games",
    selectionUnit: "board games",
    subtitle: "Share the board games you love with the world.",
    searchPlaceholder: "Search board games",
    searchDialogTitle: "Search board games",
    searchIdleHint: "Type to search board games",
    trendLabel: "Board games",
  },
  anime: {
    label: "Anime",
    longLabel: "Nine anime",
    selectionUnit: "anime",
    subtitle: "Share the anime you love with the world.",
    searchPlaceholder: "Search anime",
    searchDialogTitle: "Search anime",
    searchIdleHint: "Type to search anime",
    trendLabel: "Anime",
  },
  tv: {
    label: "TV",
    longLabel: "Nine TV shows",
    selectionUnit: "shows",
    subtitle: "Share the TV shows you love with the world.",
    searchPlaceholder: "Search TV shows",
    searchDialogTitle: "Search TV shows",
    searchIdleHint: "Type to search TV shows",
    trendLabel: "TV",
  },
  movie: {
    label: "Movies",
    longLabel: "Nine movies",
    selectionUnit: "movies",
    subtitle: "Share the movies you love with the world.",
    searchPlaceholder: "Search movies",
    searchDialogTitle: "Search movies",
    searchIdleHint: "Type to search movies",
    trendLabel: "Movies",
  },
  manga: {
    label: "Manga",
    longLabel: "Nine manga",
    selectionUnit: "manga",
    subtitle: "Share the manga you love with the world.",
    searchPlaceholder: "Search manga",
    searchDialogTitle: "Search manga",
    searchIdleHint: "Type to search manga",
    trendLabel: "Manga",
  },
  lightnovel: {
    label: "Light novels",
    longLabel: "Nine light novels",
    selectionUnit: "novels",
    subtitle: "Share the light novels you love with the world.",
    searchPlaceholder: "Search light novels",
    searchDialogTitle: "Search light novels",
    searchIdleHint: "Type to search light novels",
    trendLabel: "Light novels",
  },
  work: {
    label: "Works",
    longLabel: "Nine works",
    selectionUnit: "works",
    subtitle: "Share the works you love with the world.",
    searchPlaceholder: "Search works",
    searchDialogTitle: "Search works",
    searchIdleHint: "Type to search works",
    trendLabel: "Works",
  },
  song: {
    label: "Songs",
    longLabel: "Nine songs",
    selectionUnit: "songs",
    subtitle: "Share the songs you love with the world.",
    searchPlaceholder: "Search songs",
    searchDialogTitle: "Search songs",
    searchIdleHint: "Type to search songs",
    trendLabel: "Songs",
  },
  album: {
    label: "Albums",
    longLabel: "Nine albums",
    selectionUnit: "albums",
    subtitle: "Share the albums you love with the world.",
    searchPlaceholder: "Search albums",
    searchDialogTitle: "Search albums",
    searchIdleHint: "Type to search albums",
    trendLabel: "Albums",
  },
  character: {
    label: "Characters",
    longLabel: "Nine characters",
    selectionUnit: "characters",
    subtitle: "Share the characters you love with the world.",
    searchPlaceholder: "Search characters",
    searchDialogTitle: "Search characters",
    searchIdleHint: "Type to search characters",
    trendLabel: "Characters",
  },
  person: {
    label: "People",
    longLabel: "Nine people",
    selectionUnit: "people",
    subtitle: "Share the people you love with the world.",
    searchPlaceholder: "Search people",
    searchDialogTitle: "Search people",
    searchIdleHint: "Type to search people",
    trendLabel: "People",
  },
};

export function getSubjectKindMeta(kind: SubjectKind): SubjectKindMeta {
  return KIND_META_MAP[kind];
}

export function getSubjectKindMetaByLocale(kind: SubjectKind, locale: AppLocale): SubjectKindMeta {
  if (locale !== "en") return getSubjectKindMeta(kind);
  const base = getSubjectKindMeta(kind);
  const override = KIND_META_EN_OVERRIDES[kind];
  if (!override) return base;
  return {
    ...base,
    ...override,
    kind: base.kind,
    search: base.search,
    draftStorageKey: base.draftStorageKey,
  };
}

export function getSubjectKindShareTitle(kind: SubjectKind): string {
  const meta = getSubjectKindMeta(kind);
  return `构成我的九${meta.selectionUnit}${meta.label}`;
}

const SUBJECT_KIND_LABEL_EN: Partial<Record<SubjectKind, string>> = {
  boardgame: "board games",
};

export function getSubjectKindShareTitleByLocale(kind: SubjectKind, locale: AppLocale): string {
  if (locale !== "en") {
    return getSubjectKindShareTitle(kind);
  }
  const label = SUBJECT_KIND_LABEL_EN[kind] ?? getSubjectKindMetaByLocale(kind, "en").label;
  return `My Nine ${label}`;
}

export function parseSubjectKind(value: string | null | undefined): SubjectKind | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized in KIND_META_MAP) {
    return normalized as SubjectKind;
  }
  return null;
}

export function toSubjectKindOrDefault(value: string | null | undefined): SubjectKind {
  return parseSubjectKind(value) ?? DEFAULT_SUBJECT_KIND;
}
