export type SubjectKind = "boardgame";

export const DEFAULT_SUBJECT_KIND: SubjectKind = "boardgame";

export const SUBJECT_KIND_ORDER: SubjectKind[] = ["boardgame"];

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
};

export function getSubjectKindMeta(kind: SubjectKind): SubjectKindMeta {
  return KIND_META_MAP[kind];
}

export function getSubjectKindShareTitle(kind: SubjectKind): string {
  const meta = getSubjectKindMeta(kind);
  return `构成我的九${meta.selectionUnit}${meta.label}`;
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
