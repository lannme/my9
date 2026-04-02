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
    addLog("info", "开始执行 BGG 详情补充（limit=200, batchSize=20）...");
    try {
      const res = await fetch(`${API_BASE}/enrich`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize: 20, limit: 200 }),
      });
      const data: TaskResult = await res.json();
      if (data.ok && data.result) {
        const r = data.result;
        addLog(
          "success",
          `详情补充完成：找到 ${r.totalFound}，获取 ${r.totalFetched}，更新 ${r.enriched}，失败 ${r.failed}，跳过 ${r.skipped}，耗时 ${r.elapsedMs}ms`,
        );
        fetchStats();
      } else {
        addLog("error", `详情补充失败: ${data.error || "unknown"}`);
      }
    } catch (err) {
      addLog("error", `详情补充异常: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setRunning(null);
    }
  }, [running, addLog, authHeaders, fetchStats]);

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
            <ActionCard
              title="2. BGG 详情补充"
              description="为缺少封面的高分桌游从 BGG API 拉取详情（封面、中文名、类型）"
              buttonText={running === "enrich" ? "补充中..." : "执行补充"}
              onClick={runEnrich}
              disabled={!!running}
              variant="secondary"
            />
          </div>
          <div className="rounded bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong>操作顺序：</strong>
              ① 首次部署先执行「CSV 冷启动导入」灌入基础数据 →
              ② 再执行「BGG 详情补充」为高分条目补充封面和中文名 →
              ③ 上线后搜索请求会自动回写增量数据 →
              ④ 定期执行「BGG 详情补充」维护新增条目
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">操作日志</h2>
            {logs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLogs([])}
              >
                清空
              </Button>
            )}
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

function ActionCard({
  title,
  description,
  buttonText,
  onClick,
  disabled,
  variant,
}: {
  title: string;
  description: string;
  buttonText: string;
  onClick: () => void;
  disabled: boolean;
  variant: "default" | "secondary";
}) {
  return (
    <div className="rounded-md border border-border bg-background p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      <Button
        variant={variant}
        size="sm"
        onClick={onClick}
        disabled={disabled}
        className="w-full"
      >
        {buttonText}
      </Button>
    </div>
  );
}
