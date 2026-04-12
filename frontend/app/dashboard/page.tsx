"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EventFeed } from "@/components/dashboard/EventFeed";
import { ShipmentMap } from "@/components/dashboard/ShipmentMap";
import { StatCard } from "@/components/dashboard/StatCard";
import { apiFetch, sseUrl } from "@/lib/api";
import {
  Activity,
  ArrowRight,
  Bot,
  Brain,
  Eye,
  MapPin,
  RefreshCw,
  Route,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Truck,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Stats {
  total_scans: number;
  total_damage_events: number;
  total_agent_events: number;
  pending_actions: number;
  total_deliveries: number;
  total_routes: number;
  critical_routes: number;
  critical_deliveries: number;
  avg_route_delay: number;
}

interface HealthStatus {
  status: string;
  openrouter_configured: boolean;
  inventory_model: string;
  cv_model: string;
  agent_model: string;
}

interface RouteRow {
  id: number;
  route: string;
  predicted_delay_mins: number;
  congestion_pct: number;
  risk_level: string;
}

interface RouteBrowse {
  rows: RouteRow[];
}

interface AgentEventRow {
  id: number;
  agent_name: string;
  event_type: string;
  payload: string;
  severity: string;
  human_decision: string | null;
  created_at: string;
}

const tooltipStyle = {
  backgroundColor: "#1a1a1f",
  border: "1px solid #2a2a32",
  borderRadius: "0",
  color: "#ffffff",
  fontSize: "12px",
  padding: "8px 12px",
};
const tooltipLabelStyle = { color: "#ffffff" };
const tooltipItemStyle = { color: "#ffffff" };

const agentDefs = [
  {
    key: "damage_agent",
    label: "Damage Agent",
    icon: ShieldAlert,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    desc: "Triages cargo damage events. Actions: HOLD, INSPECT, PASS.",
  },
  {
    key: "route_agent",
    label: "Route Agent",
    icon: Route,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    desc: "Monitors route risk & congestion. Actions: REROUTE, MONITOR, OK.",
  },
  {
    key: "lastmile_agent",
    label: "Last-Mile Agent",
    icon: Truck,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    desc: "Manages delivery risk. Actions: REROUTE, DELAY, EXPEDITE, OK.",
  },
];

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [recentEvents, setRecentEvents] = useState<AgentEventRow[]>([]);
  const [mounted, setMounted] = useState(false);
  const [sweepRunning, setSweepRunning] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [statsRes, healthRes, routeRes, eventsRes] = await Promise.all([
        apiFetch<Stats>("/stats"),
        apiFetch<HealthStatus>("/health"),
        apiFetch<RouteBrowse>("/db/route_risks?limit=6&offset=0"),
        apiFetch<{ rows: AgentEventRow[] }>("/db/agent_events?limit=10&offset=0"),
      ]);
      setStats(statsRes);
      setHealth(healthRes);
      setRoutes(routeRes.rows);
      setRecentEvents(eventsRes.rows);
    } catch {
      setStats(null);
      setHealth(null);
      setRoutes([]);
      setRecentEvents([]);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    loadData();
  }, [loadData]);

  useEffect(() => {
    const id = setInterval(loadData, 30000);
    return () => clearInterval(id);
  }, [loadData]);

  // Listen for real-time DECISION broadcasts to refresh stats immediately
  useEffect(() => {
    const es = new EventSource(sseUrl("/orchestrator/events"));
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed.type === "DECISION") {
          // A decision was just made — refresh dashboard data immediately
          loadData();
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [loadData]);

  const runSweep = useCallback(async () => {
    setSweepRunning(true);
    try {
      await apiFetch("/orchestrator/sweep", { method: "POST" });
      await loadData();
    } catch {
      // sweep failed silently
    } finally {
      setSweepRunning(false);
    }
  }, [loadData]);

  /* ── derived data ──────────────────────────────────── */

  const agentStats = useMemo(() => {
    const counts: Record<string, { total: number; pending: number; critical: number }> = {};
    for (const a of agentDefs) counts[a.key] = { total: 0, pending: 0, critical: 0 };
    for (const ev of recentEvents) {
      const name = ev.agent_name;
      if (counts[name]) {
        counts[name].total += 1;
        if (!ev.human_decision) counts[name].pending += 1;
        if (ev.severity === "critical") counts[name].critical += 1;
      }
    }
    return counts;
  }, [recentEvents]);

  const radarData = useMemo(() => {
    const inventoryOps = Math.min(100, 35 + (stats?.total_scans ?? 0) * 10);
    const damageOps = Math.min(100, 50 + (stats?.total_damage_events ?? 0) * 4);
    const routeOps = Math.max(22, 100 - Math.min(70, (stats?.avg_route_delay ?? 0) * 1.4));
    const queueOps = Math.max(25, 100 - Math.min(60, (stats?.pending_actions ?? 0) * 8));
    const llmOps = health?.openrouter_configured ? 94 : 48;
    return [
      { metric: "Inventory", value: inventoryOps },
      { metric: "Vision", value: 82 },
      { metric: "Damage", value: damageOps },
      { metric: "Routing", value: routeOps },
      { metric: "Queue", value: queueOps },
      { metric: "LLM", value: llmOps },
    ];
  }, [health?.openrouter_configured, stats?.avg_route_delay, stats?.pending_actions, stats?.total_damage_events, stats?.total_scans]);

  const routeChart = useMemo(
    () =>
      routes.map((r) => ({
        route: r.route.split(" via ")[0],
        delay: r.predicted_delay_mins,
        congestion: Math.round(r.congestion_pct),
      })),
    [routes],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Command Center</h2>
          <p className="text-[13px] text-muted-foreground">
            Unified operations — vision, agents, routing & approval queue.
            {mounted && <span suppressHydrationWarning> · {new Date().toLocaleTimeString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runSweep}
            disabled={sweepRunning}
            className="flex items-center gap-1.5 border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            {sweepRunning ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Run Agent Sweep
          </button>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Inventory Scans" value={stats?.total_scans ?? 0} trend="status" compactTrend trendDirection="up" tone="success" icon={<ScanLine className="h-4 w-4" />} />
        <StatCard label="Damage Alerts" value={stats?.total_damage_events ?? 0} trend="status" compactTrend trendDirection="up" tone="warning" icon={<ShieldAlert className="h-4 w-4" />} />
        <StatCard label="Critical Routes" value={stats?.critical_routes ?? 0} trend="status" compactTrend trendDirection="down" tone="warning" icon={<Route className="h-4 w-4" />} />
        <StatCard label="Pending Decisions" value={stats?.pending_actions ?? 0} trend="status" compactTrend trendDirection="up" tone={stats?.pending_actions && stats.pending_actions > 5 ? "danger" : "default"} icon={<Activity className="h-4 w-4" />} />
      </div>

      {/* Agent Workflow Pipeline */}
      <div className="border border-border bg-card/50">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-[13px] font-semibold">Agent Pipeline</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] gap-1 font-mono">
              <Brain className="h-3 w-3" /> Gemini 2.5 Flash
            </Badge>
            <Badge className={health?.openrouter_configured ? "bg-emerald-500/15 text-emerald-400 text-[10px]" : "bg-red-500/15 text-red-400 text-[10px]"}>
              {health?.openrouter_configured ? "LLM Connected" : "LLM Offline"}
            </Badge>
          </div>
        </div>

        {/* Pipeline Flow */}
        <div className="p-4">
          <div className="flex items-center gap-1.5 mb-4 px-2 py-2 bg-muted/30 border border-border text-[11px] text-muted-foreground">
            <Eye className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="font-medium text-foreground">Workflow:</span>
            Input Data
            <ArrowRight className="h-3 w-3 shrink-0" />
            Gemini Vision Analysis
            <ArrowRight className="h-3 w-3 shrink-0" />
            Agent Evaluation
            <ArrowRight className="h-3 w-3 shrink-0" />
            Decision Proposal
            <ArrowRight className="h-3 w-3 shrink-0" />
            Human Approval
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            {agentDefs.map((agent) => {
              const Icon = agent.icon;
              const st = agentStats[agent.key] || { total: 0, pending: 0, critical: 0 };
              return (
                <div key={agent.key} className={`border ${agent.border} ${agent.bg} p-4`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`h-8 w-8 flex items-center justify-center ${agent.bg} border ${agent.border}`}>
                      <Icon className={`h-4 w-4 ${agent.color}`} />
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold">{agent.label}</p>
                      <p className="text-[10px] text-muted-foreground">{agent.desc}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center bg-background/50 p-2">
                      <p className="text-lg font-bold tabular-nums">{st.total}</p>
                      <p className="text-[9px] text-muted-foreground">Events</p>
                    </div>
                    <div className="text-center bg-background/50 p-2">
                      <p className="text-lg font-bold tabular-nums text-amber-400">{st.pending}</p>
                      <p className="text-[9px] text-muted-foreground">Pending</p>
                    </div>
                    <div className="text-center bg-background/50 p-2">
                      <p className="text-lg font-bold tabular-nums text-red-400">{st.critical}</p>
                      <p className="text-[9px] text-muted-foreground">Critical</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Operational Radar */}
        <div className="border border-border bg-card/50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Operational Radar</h3>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="78%" data={radarData}>
                <PolarGrid stroke="#2a2a32" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: "#a0a0af", fontSize: 11, fontWeight: 500 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Operations" dataKey="value" stroke="#4d8eff" fill="#4d8eff" fillOpacity={0.22} strokeWidth={2} dot={{ r: 3, fill: "#4d8eff" }} />
                <RTooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} formatter={(v) => [`${v}%`, "Score"]} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Route Pressure */}
        <div className="border border-border bg-card/50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Route Pressure</h3>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={routeChart} barCategoryGap="20%" barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a32" vertical={false} />
                <XAxis dataKey="route" tick={{ fill: "#a0a0af", fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis tick={{ fill: "#a0a0af", fontSize: 10 }} axisLine={false} tickLine={false} label={{ value: "minutes / %", angle: -90, position: "insideLeft", style: { fill: "#6b6b7a", fontSize: 10 } }} />
                <RTooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#a0a0af", paddingTop: 4 }} />
                <Bar dataKey="delay" name="Delay (min)" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                <Bar dataKey="congestion" name="Congestion (%)" fill="#4d8eff" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* System Status + Stats Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* AI System Status */}
        <div className="border border-border bg-card/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">AI System</h3>
          </div>
          <div className="space-y-2.5">
            <SystemRow label="Vision Model" value={health?.cv_model ?? "—"} ok={!!health?.openrouter_configured} />
            <SystemRow label="Inventory Model" value={health?.inventory_model ?? "—"} ok={!!health?.openrouter_configured} />
            <SystemRow label="Agent Model" value={health?.agent_model ?? "—"} ok={!!health?.openrouter_configured} />
            <SystemRow label="Backend" value={health?.status === "ok" ? "Connected" : "Offline"} ok={health?.status === "ok"} />
            <SystemRow label="OpenRouter" value={health?.openrouter_configured ? "Configured" : "Missing Key"} ok={!!health?.openrouter_configured} />
          </div>
        </div>

        {/* Objective Snapshot */}
        <div className="border border-border bg-card/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Operations Snapshot</h3>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <MiniStat label="Total Routes" value={stats?.total_routes ?? 0} color="text-foreground" />
            <MiniStat label="Deliveries" value={stats?.total_deliveries ?? 0} color="text-foreground" />
            <MiniStat label="At-Risk Deliveries" value={stats?.critical_deliveries ?? 0} color="text-red-400" />
            <MiniStat label="Agent Events" value={stats?.total_agent_events ?? 0} color="text-primary" />
            <MiniStat label="Avg Delay" value={`${stats?.avg_route_delay ?? 0}m`} color="text-amber-400" />
            <MiniStat label="Pending Queue" value={stats?.pending_actions ?? 0} color="text-amber-400" />
          </div>
        </div>
      </div>

      {/* Map + Event Feed */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-h-96">
          <ShipmentMap />
        </div>
        <div className="min-h-96">
          <EventFeed />
        </div>
      </div>
    </div>
  );
}

/* ── sub-components ──────────────────────────────────── */

function SystemRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-background border border-border">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`h-1.5 w-1.5 shrink-0 ${ok ? "bg-emerald-400" : "bg-red-400"}`} />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <span className="text-[11px] font-mono text-foreground truncate max-w-[60%] text-right">{value}</span>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-background border border-border px-3 py-2.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold tabular-nums mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

