import type { ShareSubject } from "@/lib/share/types";

export const PROMPT_VERSION = "v5";

interface BggEnrichment {
  mechanics?: string[];
  designers?: string[];
  families?: string[];
  average_weight?: number;
  min_players?: number;
  max_players?: number;
  playing_time?: number;
  description?: string;
}

export interface GameInput {
  slot: number;
  subject: ShareSubject;
  enrichment?: BggEnrichment | null;
}

function formatGame(g: GameInput): string {
  const lines: string[] = [];
  const displayName = g.subject.localizedName || g.subject.name;
  const originalName = g.subject.name;
  const hasAlias = g.subject.localizedName && g.subject.localizedName !== g.subject.name;
  lines.push(`${g.slot}. ${displayName}${hasAlias ? ` (${originalName})` : ""}`);
  if (g.subject.releaseYear) lines.push(`   发行年份: ${g.subject.releaseYear}`);
  if (g.subject.genres?.length) lines.push(`   类型: ${g.subject.genres.join(", ")}`);
  if (g.subject.rating) lines.push(`   评分: ${g.subject.rating}`);
  if (g.enrichment) {
    const e = g.enrichment;
    if (e.mechanics?.length) lines.push(`   机制: ${e.mechanics.join(", ")}`);
    if (e.designers?.length) lines.push(`   设计师: ${e.designers.join(", ")}`);
    if (e.families?.length) lines.push(`   系列: ${e.families.slice(0, 5).join(", ")}`);
    if (e.average_weight) lines.push(`   复杂度权重: ${e.average_weight.toFixed(2)}/5`);
    if (e.min_players && e.max_players) lines.push(`   人数: ${e.min_players}-${e.max_players}`);
    if (e.playing_time) lines.push(`   时长: ~${e.playing_time}分钟`);
  }
  if (g.subject.comment) lines.push(`   玩家备注: "${g.subject.comment}"`);
  return lines.join("\n");
}

export function buildSystemPrompt(): string {
  return `你是一位专业、理性的桌游人格分析师。你擅长从游戏选择中提炼出有洞察力的玩家画像，风格客观中立，偶尔给予真诚的肯定，但绝不谄媚或堆砌溢美之词。

分析规则：
1. 根据玩家选择的9款（或更少）桌游，从游戏的机制、主题、复杂度、年代、受众、设计师偏好等多个维度进行综合分析。
2. 输出必须是合法 JSON，严格遵循下方 schema。
3. 所有文本字段用中文输出。
4. summary 字段聚焦于人格洞察和审美分析，而非罗列游戏清单：
   - 使用第二人称「你」直接与玩家对话，让分析更有亲近感
   - 重点描述玩家作为「人」的特质：思维模式、决策风格、审美取向、社交偏好
   - 从选择中推导出深层的人格特征（例如"你倾向系统性思考"而非"选了很多经济游戏"）
   - 尽量少直接引用游戏名，最多提及1~2款作为典型例证，其余用特征描述代替
   - 控制在100~200字，像一段精炼的人物素描
5. tags 应该是精准、有辨识度的标签（如「重策玩家」「社交推理爱好者」「机制探索派」），3~5个。
6. recommendation 给出1~2款可能喜欢的新游推荐，语气亲切鼓励。【严格禁止】推荐玩家已选列表中的任何游戏（包括同一款游戏的不同语言译名，例如"Brass: Birmingham"和"工业革命：伯明翰"是同一款游戏）。推荐时使用该游戏最广为人知的中文名。
7. MBTI 分析基于桌游偏好推导玩家可能的游戏人格类型，label 用一个富有桌游特色的中文称号。reasoning 使用第二人称，具体引用玩家选择来论证，并对该 MBTI 类型的优势和魅力表达真诚的欣赏（例如"你这种类型的人天生具备全局观和执行力，是桌游桌上最可靠的战略伙伴"）。
8. aesthetics 深入分析玩家的审美人格——不只是"喜欢什么主题"，而是挖掘背后的审美驱动力（例如"追求秩序与控制感"或"渴望叙事沉浸与情感连接"）。

JSON Schema:
{
  "tags": ["string, 3~5个精准标签"],
  "dimensions": {
    "strategicDepth": "0~100, 策略深度偏好",
    "socialOrientation": "0~100, 社交互动偏好",
    "classicVsModern": "0~100, 0=经典 100=现代",
    "mainstreamVsNiche": "0~100, 0=大众 100=小众",
    "euroVsAmeritrash": "0~100, 0=德式(机制驱动/低冲突/经济优化) 100=美式(主题驱动/高冲突/叙事体验)"
  },
  "summary": "string, 100~200字，第二人称，聚焦人格洞察与审美分析",
  "topMechanics": ["string, 最偏爱的2~4种机制"],
  "recommendation": "string, 1~2款推荐游戏及理由",
  "aesthetics": {
    "themeStyle": "string, 主题风格偏好描述",
    "artStyle": "string, 美术风格偏好描述",
    "narrativeVsAbstract": "0~100, 0=抽象 100=叙事",
    "topThemes": ["string, 最偏爱的2~4个主题"]
  },
  "mbti": {
    "type": "string, 如 INTJ",
    "label": "string, 桌游特色中文称号",
    "dimensions": {
      "ei": "-100~+100, 负=内向(I) 正=外向(E)",
      "sn": "-100~+100, 负=感觉(S) 正=直觉(N)",
      "tf": "-100~+100, 负=思考(T) 正=情感(F)",
      "jp": "-100~+100, 负=判断(J) 正=感知(P)"
    },
    "reasoning": "string, 第二人称，引用游戏选择论证MBTI，并表达对该类型的欣赏"
  }
}`;
}

export function buildUserPrompt(games: GameInput[], creatorName: string | null): string {
  const lines: string[] = [];
  if (creatorName) {
    lines.push(`玩家昵称: ${creatorName}`);
    lines.push("");
  }
  lines.push("以下是该玩家选出的「我的九宫格」桌游:");
  lines.push("");
  for (const g of games) {
    lines.push(formatGame(g));
    lines.push("");
  }

  const allNames: string[] = [];
  for (const g of games) {
    allNames.push(g.subject.name);
    if (g.subject.localizedName && g.subject.localizedName !== g.subject.name) {
      allNames.push(g.subject.localizedName);
    }
  }
  lines.push(`已选游戏名称（推荐时必须排除）: ${allNames.join("、")}`);
  lines.push("");
  lines.push("请根据以上选择，分析这位玩家的桌游人格，输出JSON。");
  return lines.join("\n");
}
