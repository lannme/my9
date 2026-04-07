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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: Record<string, any>;
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

  const readSSEStream = useCallback(async (res: Response) => {
    const reader = res.body?.getReader();
    if (!reader) {
      addLog("error", "详情补充失败: 无法获取响应流");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    const processEvent = (eventType: string, data: string) => {
      try {
        const parsed = JSON.parse(data);
        switch (eventType) {
          case "connected":
            addLog("info", `已连接后台任务（${parsed.description || ""}，已有 ${parsed.eventCount} 条历史事件）`);
            break;
          case "start":
            addLog("info", `找到 ${parsed.totalFound} 条待补充（rank ${parsed.minRank}~${parsed.maxRank}），分 ${parsed.totalBatches} 批处理`);
            break;
          case "batch": {
            const status = parsed.failed > 0 ? "warn" : "info";
            const rr = parsed.rankRange;
            const rankInfo = rr ? ` [rank ${rr[0]}~${rr[1]}]` : "";
            addLog(
              status,
              `批次 ${parsed.batchIdx + 1}/${parsed.totalBatches}${rankInfo}：更新 ${parsed.enriched}，失败 ${parsed.failed}，跳过 ${parsed.skipped}`,
            );
            if (parsed.errors) {
              for (const errMsg of parsed.errors) {
                addLog("error", errMsg);
              }
            }
            break;
          }
          case "done": {
            const level = parsed.failed > 0 ? "warn" : "success";
            addLog(
              level,
              `详情补充完成：找到 ${parsed.totalFound}，获取 ${parsed.totalFetched}，更新 ${parsed.enriched}，失败 ${parsed.failed}，跳过 ${parsed.skipped}，耗时 ${parsed.elapsedMs}ms`,
            );
            if (parsed.errors) {
              for (const errMsg of parsed.errors) {
                addLog("error", errMsg);
              }
            }
            fetchStats();
            break;
          }
          case "error":
            addLog("error", `详情补充错误: ${parsed.error || "unknown"}`);
            break;
          case "heartbeat":
            break;
        }
      } catch {
        addLog("warn", `SSE 解析异常: ${data}`);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        let eventType = "message";
        let eventData = "";
        for (const line of part.split("\n")) {
          if (line.startsWith("event: ")) eventType = line.slice(7);
          else if (line.startsWith("data: ")) eventData = line.slice(6);
        }
        if (eventData) processEvent(eventType, eventData);
      }
    }
    if (buffer.trim()) {
      let eventType = "message";
      let eventData = "";
      for (const line of buffer.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7);
        else if (line.startsWith("data: ")) eventData = line.slice(6);
      }
      if (eventData) processEvent(eventType, eventData);
    }
  }, [addLog, fetchStats]);

  const subscribeEnrichSSE = useCallback(async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: { error?: string; description?: string; hint?: string } | null = null;
      try { parsed = JSON.parse(text); } catch { /* ignore */ }

      if (res.status === 409 && parsed?.hint?.includes("subscribe")) {
        addLog("info", `后台任务运行中（${parsed.description || ""}），自动订阅进度...`);
        const subUrl = `${API_BASE}/enrich?action=subscribe&token=${tokenRef.current}`;
        const subRes = await fetch(subUrl);
        if (!subRes.ok) {
          addLog("error", `订阅失败 (${subRes.status})`);
          return;
        }
        await readSSEStream(subRes);
        return;
      }

      addLog("error", `详情补充失败 (${res.status}): ${parsed?.error || text || res.statusText}`);
      return;
    }
    await readSSEStream(res);
  }, [addLog, readSSEStream]);

  const runEnrich = useCallback(async () => {
    if (running) return;
    setRunning("enrich");
    const rankFromNum = Math.max(1, Number(enrichRankFrom) || 1);
    const rankToNum = Number(enrichRankTo) || 0;
    const limitNum = Math.max(1, Number(enrichLimit) || 200);
    const effectiveForce = enrichForce;
    const rangeDesc = rankToNum > 0 ? `rank ${rankFromNum}~${rankToNum}` : `rank ${rankFromNum}+`;
    addLog("info", `开始 BGG 详情补充（${rangeDesc}, limit=${limitNum}${effectiveForce ? ", 强制模式" : ""}）...`);
    try {
      const params = new URLSearchParams({
        batchSize: "20",
        limit: String(limitNum),
        rankFrom: String(rankFromNum),
        token: tokenRef.current,
      });
      if (rankToNum > 0) params.set("rankTo", String(rankToNum));
      if (effectiveForce) params.set("force", "1");
      await subscribeEnrichSSE(`${API_BASE}/enrich?${params.toString()}`);
    } catch (err) {
      addLog("error", `详情补充异常: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setRunning(null);
    }
  }, [running, enrichRankFrom, enrichRankTo, enrichLimit, enrichForce, addLog, subscribeEnrichSSE]);

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
      <div className="flex justify-center items-center min-h-screen bg-background">
        <div className="p-6 space-y-4 w-full max-w-sm rounded-lg border shadow-lg border-border bg-card">
          <h1 className="text-lg font-semibold text-center text-foreground">
            运维面板
          </h1>
          <p className="text-sm text-center text-muted-foreground">
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
    <div className="p-4 min-h-screen bg-background md:p-8">
      <div className="mx-auto space-y-6 max-w-4xl">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-bold text-foreground">BGG 数据运维面板</h1>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            退出
          </Button>
        </div>

        <div className="p-4 space-y-4 rounded-lg border border-border bg-card">
          <div className="flex justify-between items-center">
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

        <div className="p-4 space-y-4 rounded-lg border border-border bg-card">
          <h2 className="text-base font-semibold text-foreground">运维操作</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="p-4 space-y-3 rounded-md border border-border bg-background">
              <div>
                <h3 className="text-sm font-semibold text-foreground">1. CSV 冷启动导入</h3>
                <p className="mt-1 text-xs text-muted-foreground">
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
            <div className="p-4 space-y-3 rounded-md border border-border bg-background">
              <div>
                <h3 className="text-sm font-semibold text-foreground">2. BGG 详情补充</h3>
                <p className="mt-1 text-xs text-muted-foreground">
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
              <label className="flex gap-2 items-center text-xs cursor-pointer text-muted-foreground">
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

          <div className="p-4 space-y-3 rounded-md border border-border bg-background">
            <div>
              <h3 className="text-sm font-semibold text-foreground">3. 数据清洗</h3>
              <p className="mt-1 text-xs text-muted-foreground">
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
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${cleanFields.has(opt.key)
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

          <div className="p-3 rounded bg-muted/50">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <strong>操作顺序：</strong>
              ① 首次部署先执行「CSV 冷启动导入」灌入基础数据 →
              ② 再执行「BGG 详情补充」为条目补充封面、翻译名、分类、机制等 →
              ③ 如需重跑补充，先用「数据清洗」清除相关字段 →
              ④ 上线后搜索请求会自动回写增量数据
            </p>
          </div>
        </div>

        <div className="p-4 space-y-3 rounded-lg border border-border bg-card">
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
              className="flex-1 h-8 text-sm"
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
              <pre className="overflow-auto p-3 max-h-96 font-mono text-xs whitespace-pre-wrap break-all rounded-md bg-muted/50">
                {debugResult}
              </pre>
            </div>
          )}
        </div>

        <div className="p-4 space-y-2 rounded-lg border border-border bg-card">
          <div className="flex justify-between items-center">
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
          <div className="overflow-y-auto space-y-1 max-h-64">
            {logs.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">暂无日志</p>
            ) : (
              logs.map((entry) => (
                <div
                  key={entry.id}
                  className={`text-xs font-mono leading-relaxed ${entry.level === "error"
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
    <div className="p-3 rounded-md border border-border bg-background">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`font-semibold text-foreground ${small ? "text-sm truncate" : "text-lg"
          }`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
