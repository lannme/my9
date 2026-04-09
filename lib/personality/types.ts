export interface PersonalityDimensions {
  strategicDepth: number;
  socialOrientation: number;
  classicVsModern: number;
  mainstreamVsNiche: number;
  euroVsAmeritrash: number;
}

export interface PersonalityAesthetics {
  themeStyle: string;
  artStyle: string;
  narrativeVsAbstract: number;
  topThemes: string[];
}

export interface PersonalityMbtiDimensions {
  ei: number;
  sn: number;
  tf: number;
  jp: number;
}

export interface PersonalityMbti {
  type: string;
  label: string;
  dimensions: PersonalityMbtiDimensions;
  reasoning: string;
}

export interface PersonalityResult {
  tags: string[];
  dimensions: PersonalityDimensions;
  summary: string;
  topMechanics: string[];
  recommendation: string;
  aesthetics: PersonalityAesthetics;
  mbti: PersonalityMbti;
}

export interface PersonalityCacheRow {
  content_hash: string;
  prompt_version: string;
  kind: string;
  personality: PersonalityResult;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  created_at: number;
}

export interface PersonalityApiRequest {
  shareId: string;
  kind: string;
}

export interface PersonalityApiResponse {
  ok: boolean;
  personality?: PersonalityResult;
  cached?: boolean;
  error?: string;
}
