"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const API_BASE = "/api/ops-x7k9m2";

type BggStats = {
  total_count: number;
  with_cover: number;
  with_localized_name: number;
  enriched_count: number;
  csv_imported_count: number;
  expansion_count: number;
  base_game_count: number;
  top_ranked: { bgg_id: string; name: string; bgg_rank: number } | null;
};

type TaskResult = {
  ok: boolean;
  error?: string;
  result?: Record<string, unknown>;
  stats?: BggStats;
};

type LogEntry = {
  id: number;
  time: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
};

const CLEAN_FIELD_OPTIONS = [
  { key: "localized_names", label: "翻译名列表 (localized_names)" },
  { key: "cover", label: "封面图" },
  { key: "thumbnail", label: "缩略图" },
  { key: "genres", label: "游戏分类" },
  { key: "mechanics", label: "游戏机制" },
  { key: "families", label: "游戏系列" },
  { key: "designers", label: "设计师" },
  { key: "artists", label: "美术师" },
  { key: "publishers", label: "出版商" },
  { key: "description", label: "游戏描述" },
  { key: "num_comments", label: "评论数" },
  { key: "api_enriched_at", label: "补充标记 (重跑补充)" },
] as const;

function formatTime(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

export default function OpsPanel() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const tokenRef = useRef("");

  const [stats, setStats] = useState<BggStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logIdRef = useRef(0);

  const [cleanFields, setCleanFields] = useState<Set<string>>(new Set());

  const [enrichRankFrom, setEnrichRankFrom] = useState("1");
  const [enrichRankTo, setEnrichRankTo] = useState("");
  const [enrichLimit, setEnrichLimit] = useState("200");
  const [enrichForce, setEnrichForce] = useState(false);

  const [debugBggId, setDebugBggId] = useState("");
  const [debugResult, setDebugResult] = useState<string | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const addLog = useCallback(
    (level: LogEntry["level"], message: string) => {
      const entry: LogEntry = {
        id: ++logIdRef.current,
        time: formatTime(),
        level,
        message,
      };
      setLogs((prev) => [entry, ...prev].slice(0, 200));
    },
    [],
  );

  const authHeaders = useCallback((): HeadersInit => {
    return { Authorization: `Bearer ${tokenRef.current}` };
  }, []);

  const handleLogin = useCallback(async () => {
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch(`${API_BASE}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.ok) {
        tokenRef.current = password;
        setAuthed(true);
        setPassword("");
      } else {
        setAuthError(data.error || "认证失败");
      }
    } catch {
      setAuthError("网络错误");
    } finally {
      setAuthLoading(false);
    }
  }, [password]);

  const fetchStats = useCallback(async () => {
    try {
      addLog("info", "正在加载数据库统计...");
      const res = await fetch(`${API_BASE}/stats`, {
        headers: authHeaders(),
      });
      const data: TaskResult = await res.json();
      if (data.ok && data.stats) {
        setStats(data.stats);
        addLog("success", `统计加载完成：共 ${data.stats.total_count} 条记录`);
      } else {
        addLog("error", `统计加载失败: ${data.error || "unknown"}`);
      }
    } catch (err) {
      addLog("error", `统计加载异常: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }, [addLog, authHeaders]);

  const runImportCsv = useCallback(async () => {
    if (running) return;
    if (!csvFile) {
      addLog("warn", "请先选择 CSV 文件");
      return;
    }
    setRunning("import");
    addLog("info", `开始上传并导入 CSV 文件：${csvFile.name}（${(csvFile.size / 1024 / 1024).toFixed(1)} MB）...`);
    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      formData.append("batchSize", "500");
      const res = await fetch(`${API_BASE}/import-csv`, {
        method: "POST",
        headers: authHeaders(),
        body: formData,
      });
      const data: TaskResult = await res.json();
      if (data.ok && data.result) {
        const r = data.result;
        addLog(
          "success",
          `CSV 导入完成：总行数 ${r.totalRows}，写入 ${r.upsertedRows}，跳过 ${r.skippedRows}，耗时 ${r.elapsedMs}ms`,
        );
        fetchStats();
      } else {
        addLog("error", `CSV 导入失败: ${data.error || "unknown"}`);
      }
    } catch (err) {
      addLog("error", `CSV 导入异常: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setRunning(null);
    }
  }, [running, csvFile, addLog, authHeaders, fetchStats]);

  const runEnrich = useCallback(async () => {
    if (running) return;
    setRunning("enrich");
    const rankFromNum = Math.max(1, Number(enrichRankFrom) || 1);
    const rankToNum = Number(enrichRankTo) || 0;
    const limitNum = Math.max(1, Number(enrichLimit) || 200);
    const effectiveForce = enrichForce || rankToNum > 0;
    const rangeDesc = rankToNum > 0 ? `rank ${rankFromNum}~${rankToNum}` : `rank ${rankFromNum}+`;
    addLog("info", `开始 BGG 详情补充（${rangeDesc}, limit=${limitNum}${effectiveForce ? ", 强制模式" : ""}）...`);
    try {
      const body: Record<string, unknown> = {
        batchSize: 20,
        limit: limitNum,
        rankFrom: rankFromNum,
      };
      if (rankToNum > 0) body.rankTo = rankToNum;
      if (effectiveForce) body.force = true;
      const res = await fetch(`${API_BASE}/enrich`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: TaskResult = await res.json();
      if (data.ok && data.result) {
        const r = data.result;
        const level = r.failed > 0 ? "warn" : "success";
        addLog(
          level,
          `详情补充完成：找到 ${r.totalFound}，获取 ${r.totalFetched}，更新 ${r.enriched}，失败 ${r.failed}，跳过 ${r.skipped}，耗时 ${r.elapsedMs}ms`,
        );
        if (r.errors && Array.isArray(r.errors)) {
          for (const errMsg of r.errors) {
            addLog("error", errMsg);
          }
        }
        fetchStats();
      } else {
        addLog("error", `详情补充失败: ${data.error || "unknown"}`);
      }
    } catch (err) {
      addLog("error", `详情补充异常: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setRunning(null);
    }
  }, [running, enrichRankFrom, enrichRankTo, enrichLimit, enrichForce, addLog, authHeaders, fetchStats]);

  const runClean = useCallback(async () => {
    if (running) return;
    if (cleanFields.size === 0) {
      addLog("warn", "请至少选择一个要清洗的字段");
      return;
    }
    const fieldList = Array.from(cleanFields);
    setRunning("clean");
    addLog("info", `开始清洗字段：${fieldList.join(", ")}...`);
    try {
      const res = await fetch(`${API_BASE}/clean`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ fields: fieldList }),
      });
      const data: TaskResult = await res.json();
      if (data.ok && data.result) {
        const r = data.result;
        addLog(
          "success",
          `清洗完成：字段 [${(r.fields as string[]).join(", ")}]，影响 ${r.affectedRows} 行${r.resetEnrich ? "（api_enriched_at 已重置，可重新执行补充）" : ""}`,
        );
        fetchStats();
      } else {
        addLog("error", `清洗失败: ${data.error || "unknown"}`);
      }
    } catch (err) {
      addLog("error", `清洗异常: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setRunning(null);
    }
  }, [running, cleanFields, addLog, authHeaders, fetchStats]);

  const runDebugThing = useCallback(async () => {
    const id = debugBggId.trim();
    if (!id) return;
    setDebugLoading(true);
    setDebugResult(null);
    addLog("info", `正在查询 BGG /thing 接口 (id=${id})...`);
    try {
      const res = await fetch(`${API_BASE}/debug-thing?id=${id}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      const formatted = JSON.stringify(data, null, 2);
      setDebugResult(formatted);
      if (data.ok) {
        const items = data.raw || [];
        for (const item of items) {
          addLog("success", `id=${item.id} | image=${item.image || "(空)"} | thumbnail=${item.thumbnail || "(空)"}`);
        }
      } else {
        addLog("error", `查询失败: ${data.error}`);
      }
    } catch (err) {
      addLog("error", `查询异常: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setDebugLoading(false);
    }
  }, [debugBggId, addLog, authHeaders]);

  const toggleCleanField = useCallback((key: string) => {
    setCleanFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleLogout = useCallback(() => {
    tokenRef.current = "";
    setAuthed(false);
    setStats(null);
    setLogs([]);
    setRunning(null);
  }, []);

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-lg">
          <h1 className="text-center text-lg font-semibold text-foreground">
            运维面板
          </h1>
          <p className="text-center text-sm text-muted-foreground">
            请输入运维密码
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            className="space-y-3"
          >
            <Input
              type="password"
              placeholder="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {authError && (
              <p className="text-sm text-destructive">{authError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={authLoading || !password.trim()}
            >
              {authLoading ? "验证中..." : "登录"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">BGG 数据运维面板</h1>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            退出
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">数据库统计</h2>
            <Button variant="outline" size="sm" onClick={fetchStats} disabled={!!running}>
              刷新统计
            </Button>
          </div>
          {stats ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="总记录数" value={stats.total_count} />
              <StatCard label="基础游戏" value={stats.base_game_count} />
              <StatCard label="扩展包" value={stats.expansion_count} />
              <StatCard label="有封面" value={stats.with_cover} />
              <StatCard label="有中文名" value={stats.with_localized_name} />
              <StatCard label="API 已补充" value={stats.enriched_count} />
              <StatCard label="CSV 已导入" value={stats.csv_imported_count} />
              {stats.top_ranked && (
                <StatCard
                  label={`Top #${stats.top_ranked.bgg_rank}`}
                  value={stats.top_ranked.name}
                  small
                />
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              点击「刷新统计」加载数据
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <h2 className="text-base font-semibold text-foreground">运维操作</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border bg-background p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">1. CSV 冷启动导入</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  选择 boardgames_ranks.csv 文件并上传，批量导入桌游基础数据到数据库
                </p>
              </div>
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setCsvFile(f);
                    if (f) addLog("info", `已选择文件：${f.name}（${(f.size / 1024 / 1024).toFixed(1)} MB）`);
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!!running}
                >
                  {csvFile ? `📄 ${csvFile.name}` : "选择 CSV 文件"}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={runImportCsv}
                  disabled={!!running || !csvFile}
                  className="w-full"
                >
                  {running === "import" ? "导入中..." : "上传并导入"}
                </Button>
              </div>
            </div>
            <div className="rounded-md border border-border bg-background p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">2. BGG 详情补充</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  按 rank 范围从 BGG API 拉取详情（封面、翻译名、分类、机制、设计师等）
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Rank 起始</label>
                  <Input
                    type="number"
                    min={1}
                    value={enrichRankFrom}
                    onChange={(e) => setEnrichRankFrom(e.target.value)}
                    disabled={!!running}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Rank 结束</label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="不限"
                    value={enrichRankTo}
                    onChange={(e) => setEnrichRankTo(e.target.value)}
                    disabled={!!running}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">每次条数</label>
                  <Input
                    type="number"
                    min={1}
                    value={enrichLimit}
                    onChange={(e) => setEnrichLimit(e.target.value)}
                    disabled={!!running}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={enrichForce}
                  onChange={(e) => setEnrichForce(e.target.checked)}
                  disabled={!!running}
                  className="rounded"
                />
                强制模式（重新补充已标记的条目）
              </label>
              <Button
                variant="secondary"
                size="sm"
                onClick={runEnrich}
                disabled={!!running}
                className="w-full"
              >
                {running === "enrich" ? "补充中..." : "执行补充"}
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border bg-background p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">3. 数据清洗</h3>
              <p className="text-xs text-muted-foreground mt-1">
                选择要清空的字段，一键将其置为 NULL。清洗 API 补充字段时会同时重置 api_enriched_at，方便重新执行补充。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {CLEAN_FIELD_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => toggleCleanField(opt.key)}
                  disabled={!!running}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    cleanFields.has(opt.key)
                      ? "bg-destructive/10 border-destructive text-destructive"
                      : "bg-muted/50 border-border text-muted-foreground hover:border-foreground/30"
                  } disabled:opacity-50`}
                >
                  {cleanFields.has(opt.key) ? "✕ " : ""}{opt.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={runClean}
                disabled={!!running || cleanFields.size === 0}
                className="flex-1"
              >
                {running === "clean" ? "清洗中..." : `清洗选中字段（${cleanFields.size}）`}
              </Button>
              {cleanFields.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCleanFields(new Set())}
                  disabled={!!running}
                >
                  取消全选
                </Button>
              )}
            </div>
          </div>

          <div className="rounded bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong>操作顺序：</strong>
              ① 首次部署先执行「CSV 冷启动导入」灌入基础数据 →
              ② 再执行「BGG 详情补充」为条目补充封面、翻译名、分类、机制等 →
              ③ 如需重跑补充，先用「数据清洗」清除相关字段 →
              ④ 上线后搜索请求会自动回写增量数据
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h2 className="text-base font-semibold text-foreground">4. BGG /thing 接口调试</h2>
          <p className="text-xs text-muted-foreground">
            输入 BGG ID 查看完整的 /thing API 返回值（含 image、thumbnail、links 等全部字段）
          </p>
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="BGG ID（如 174430）"
              value={debugBggId}
              onChange={(e) => setDebugBggId(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runDebugThing(); }}
              className="h-8 text-sm flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={runDebugThing}
              disabled={debugLoading || !debugBggId.trim()}
            >
              {debugLoading ? "查询中..." : "查询"}
            </Button>
          </div>
          {debugResult && (
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="absolute top-1 right-1 text-xs"
                onClick={() => navigator.clipboard.writeText(debugResult)}
              >
                复制
              </Button>
              <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                {debugResult}
              </pre>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">操作日志</h2>
            <div className="flex gap-2">
              {logs.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const text = logs
                        .slice()
                        .reverse()
                        .map((e) => `[${e.time}] ${e.message}`)
                        .join("\n");
                      navigator.clipboard.writeText(text).then(() => {
                        addLog("info", "日志已复制到剪贴板");
                      });
                    }}
                  >
                    复制日志
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLogs([])}
                  >
                    清空
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">暂无日志</p>
            ) : (
              logs.map((entry) => (
                <div
                  key={entry.id}
                  className={`text-xs font-mono leading-relaxed ${
                    entry.level === "error"
                      ? "text-destructive"
                      : entry.level === "success"
                        ? "text-green-600 dark:text-green-400"
                        : entry.level === "warn"
                          ? "text-yellow-600 dark:text-yellow-400"
                          : "text-muted-foreground"
                  }`}
                >
                  <span className="opacity-60">[{entry.time}]</span>{" "}
                  {entry.message}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  small,
}: {
  label: string;
  value: string | number;
  small?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`font-semibold text-foreground ${
          small ? "text-sm truncate" : "text-lg"
        }`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
