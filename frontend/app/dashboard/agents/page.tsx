"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Bot,
  RefreshCcw,
  Loader2,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Zap,
  ThumbsUp,
  ThumbsDown,
  PenLine,
  GitPullRequest,
  ArrowRightLeft,
  Filter,
  BarChart3,
  ChevronDown,
  Play,
} from "lucide-react";
import { apiFetch, sseUrl } from "@/lib/api";

interface AgentEvent {
  id: number;
  agent_name: string;
  event_type: string;
  payload: string;
  severity: string;
  human_decision: string | null;
  created_at: string;
}

const agents = [
  { name: "damage_agent", label: "Damage Agent", desc: "Analyzes shipment photos for physical damage, moisture, contamination" },
  { name: "route_agent", label: "Route Agent", desc: "Scores delivery routes based on weather, traffic, and road conditions" },
  { name: "lastmile_agent", label: "Last-Mile Agent", desc: "Evaluates last-mile delivery risk and proposes mitigations" },
  { name: "orchestrator", label: "Orchestrator", desc: "Coordinates all agents and manages the decision pipeline" },
];

const severityIcon: Record<string, typeof Activity> = {
  info: Activity,
  warning: AlertTriangle,
  critical: XCircle,
};

const severityColor: Record<string, string> = {
  info: "bg-blue-500/15 text-blue-400",
  warning: "bg-amber-500/15 text-amber-400",
  critical: "bg-red-500/15 text-red-400",
};

const decisionStyles: Record<string, string> = {
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  rejected: "bg-red-500/15 text-red-400 border-red-500/20",
  overridden: "bg-violet-500/15 text-violet-400 border-violet-500/20",
};

function parsePayload(payload: string): Record<string, unknown> | null {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getEventSummary(event: AgentEvent): string {
  const parsed = parsePayload(event.payload);
  return typeof parsed?.summary === "string" ? parsed.summary : event.event_type;
}

function getDecisionPayload(event: AgentEvent): Record<string, unknown> | null {
  const parsed = parsePayload(event.payload);
  if (!parsed || typeof parsed.decision !== "object" || parsed.decision === null) {
    return null;
  }
  return parsed.decision as Record<string, unknown>;
}

function getInputPayload(event: AgentEvent): Record<string, unknown> | null {
  const parsed = parsePayload(event.payload);
  if (!parsed || typeof parsed.input !== "object" || parsed.input === null) {
    return null;
  }
  return parsed.input as Record<string, unknown>;
}

export default function AgentMonitorPage() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [liveEvents, setLiveEvents] = useState<AgentEvent[]>([]);
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ id: number; msg: string; type: "success" | "error" } | null>(null);
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [overrideDialog, setOverrideDialog] = useState<{ eventId: number; payload: string } | null>(null);
  const [overrideText, setOverrideText] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [isOverriding, setIsOverriding] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const res = await apiFetch<AgentEvent[]>("/events/all");
      setEvents(res);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // SSE live feed
  useEffect(() => {
    const es = new EventSource(sseUrl("/orchestrator/events"));
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed.type === "DECISION" && parsed.data?.event) {
          // Real-time decision broadcast — update the matching event in place
          const updated = parsed.data.event as AgentEvent;
          setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
          setLiveEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        } else if (parsed.data && Array.isArray(parsed.data)) {
          setLiveEvents(parsed.data);
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, []);

  const handleRunAll = async () => {
    setIsRunning(true);
    try {
      await apiFetch("/orchestrator/run", { method: "POST" });
      await loadEvents();
      setFeedback({ id: 0, msg: "All agents ran successfully", type: "success" });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback({ id: 0, msg: `Run failed: ${err instanceof Error ? err.message : err}`, type: "error" });
      setTimeout(() => setFeedback(null), 5000);
    } finally {
      setIsRunning(false);
    }
  };

  const handleDecision = async (eventId: number, action: "approve" | "reject") => {
    setDecidingId(eventId);
    // Optimistic update — immediately reflect the decision in the UI
    const decisionLabel = action === "approve" ? "approved" : "rejected";
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, human_decision: decisionLabel } : e))
    );
    setLiveEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, human_decision: decisionLabel } : e))
    );
    try {
      const res = await apiFetch<{ status: string; event: AgentEvent }>(`/actions/${eventId}/${action}`, { method: "POST" });
      // Update with server truth
      if (res.event) {
        setEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
        setLiveEvents((prev) => prev.map((e) => (e.id === eventId ? res.event : e)));
      }
      setFeedback({ id: eventId, msg: `Event #${eventId} ${action}d — ${decisionLabel} successfully`, type: "success" });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      // Revert optimistic update
      setEvents((prev) =>
        prev.map((e) => (e.id === eventId ? { ...e, human_decision: null } : e))
      );
      setLiveEvents((prev) =>
        prev.map((e) => (e.id === eventId ? { ...e, human_decision: null } : e))
      );
      setFeedback({ id: eventId, msg: `Failed to ${action}: ${err instanceof Error ? err.message : err}`, type: "error" });
      setTimeout(() => setFeedback(null), 5000);
    } finally {
      setDecidingId(null);
    }
  };

  const handleOverride = async () => {
    if (!overrideDialog) return;
    setIsOverriding(true);
    try {
      await apiFetch(`/actions/${overrideDialog.eventId}/override`, {
        method: "POST",
        body: JSON.stringify({
          override_params: { custom_action: overrideText, reason: overrideReason },
        }),
      });
      const eid = overrideDialog.eventId;
      setOverrideDialog(null);
      setOverrideText("");
      setOverrideReason("");
      await loadEvents();
      setFeedback({ id: eid, msg: `Event #${eid} overridden`, type: "success" });
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback({ id: overrideDialog.eventId, msg: `Override failed: ${err instanceof Error ? err.message : err}`, type: "error" });
      setTimeout(() => setFeedback(null), 5000);
    } finally {
      setIsOverriding(false);
    }
  };

  const allEvents = [...liveEvents, ...events];
  const uniqueEvents = allEvents.filter(
    (e, i, arr) => arr.findIndex((x) => x.id === e.id) === i
  );

  // Filtered events
  const filteredEvents = uniqueEvents.filter((e) => {
    if (filterAgent !== "all" && e.agent_name !== filterAgent) return false;
    if (filterStatus === "pending" && e.human_decision) return false;
    if (filterStatus === "decided" && !e.human_decision) return false;
    return true;
  });

  // Per-agent stats
  const agentStats = agents.map((a) => {
    const agentEvents = uniqueEvents.filter((e) => e.agent_name === a.name);
    const pending = agentEvents.filter((e) => !e.human_decision).length;
    const approved = agentEvents.filter((e) => e.human_decision === "approved").length;
    const rejected = agentEvents.filter((e) => e.human_decision === "rejected").length;
    const overridden = agentEvents.filter((e) => e.human_decision === "overridden").length;
    const lastEvent = agentEvents[0];
    return { ...a, total: agentEvents.length, pending, approved, rejected, overridden, lastEvent };
  });

  const pendingCount = uniqueEvents.filter((e) => !e.human_decision).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Workflow & Agent Monitor</h2>
          <p className="text-[13px] text-muted-foreground">
            Human-in-the-loop decision management — approve, reject, or override agent proposals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-xs gap-1">
              <Clock className="h-3 w-3" /> {pendingCount} pending
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleRunAll}
            disabled={isRunning}
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run All Agents
          </Button>
        </div>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border ${
          feedback.type === "success"
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            : "bg-red-500/10 border-red-500/20 text-red-400"
        }`}>
          {feedback.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {feedback.msg}
        </div>
      )}

      {/* Pipeline Status Bar */}
      <div className="border border-border bg-card/50 p-3">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-[11px]">
            <GitPullRequest className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">Pipeline</span>
          </div>
          <div className="flex-1 flex items-center gap-1">
            {agents.slice(0, -1).map((a, i) => {
              const stat = agentStats[i];
              const hasIssue = stat.pending > 0;
              return (
                <div key={a.name} className="flex items-center gap-1 flex-1">
                  <div className={`flex-1 h-1.5 ${hasIssue ? "bg-amber-400/40" : stat.total > 0 ? "bg-emerald-400/40" : "bg-[#2a2a32]"}`}>
                    <div
                      className={`h-full transition-all ${hasIssue ? "bg-amber-400" : "bg-emerald-400"}`}
                      style={{ width: stat.total > 0 ? `${((stat.approved + stat.overridden) / stat.total * 100).toFixed(0)}%` : "0%" }}
                    />
                  </div>
                  {i < agents.length - 2 && <ArrowRightLeft className="h-3 w-3 text-muted-foreground/30 shrink-0" />}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 bg-emerald-400 inline-block" /> Resolved</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 bg-amber-400 inline-block" /> Pending</span>
          </div>
        </div>
      </div>

      {/* Agent Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {agentStats.map((agent) => (
          <div key={agent.name} className="border border-border bg-card/50 p-4">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="h-8 w-8 bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold">{agent.label}</p>
                <p className="text-[11px] text-muted-foreground truncate">{agent.desc}</p>
              </div>
              {agent.pending > 0 && (
                <span className="flex h-5 w-5 items-center justify-center bg-amber-500/20 text-amber-400 text-[10px] font-bold shrink-0">
                  {agent.pending}
                </span>
              )}
            </div>
            <div className="grid grid-cols-5 gap-1.5 text-center">
              <div>
                <p className="text-base font-bold tabular-nums">{agent.total}</p>
                <p className="text-[9px] text-muted-foreground">Total</p>
              </div>
              <div>
                <p className="text-base font-bold tabular-nums text-amber-400">{agent.pending}</p>
                <p className="text-[9px] text-muted-foreground">Pending</p>
              </div>
              <div>
                <p className="text-base font-bold tabular-nums text-emerald-400">{agent.approved}</p>
                <p className="text-[9px] text-muted-foreground">Approved</p>
              </div>
              <div>
                <p className="text-base font-bold tabular-nums text-red-400">{agent.rejected}</p>
                <p className="text-[9px] text-muted-foreground">Rejected</p>
              </div>
              <div>
                <p className="text-base font-bold tabular-nums text-violet-400">{agent.overridden}</p>
                <p className="text-[9px] text-muted-foreground">Override</p>
              </div>
            </div>
            {agent.lastEvent && (
              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Last: {agent.lastEvent.event_type}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Workflow Decision Queue */}
      <div className="border border-border bg-card/50">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            <span className="text-[13px] font-semibold">Decision Queue</span>
            <Badge variant="outline" className="text-[10px] h-5">{filteredEvents.length} events</Badge>
          </div>
          <div className="flex items-center gap-2">
            {/* Agent filter */}
            <div className="relative">
              <Filter className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <select
                value={filterAgent}
                onChange={(e) => setFilterAgent(e.target.value)}
                className="h-7 pl-6 pr-6 text-[11px] bg-background border border-border text-foreground appearance-none cursor-pointer"
              >
                <option value="all">All agents</option>
                {agents.map((a) => <option key={a.name} value={a.name}>{a.label}</option>)}
              </select>
              <ChevronDown className="h-3 w-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            </div>
            {/* Status filter */}
            <div className="flex border border-border">
              {(["all", "pending", "decided"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-2.5 py-1 text-[10px] capitalize transition-colors ${
                    filterStatus === s ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                  } ${s !== "all" ? "border-l border-border" : ""}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={loadEvents}>
              <RefreshCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <ScrollArea className="h-120">
          <div className="divide-y divide-border">
            {filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Bot className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No events match current filters.</p>
                <p className="text-[12px] text-muted-foreground/60 mt-1">Run agents to see their output here.</p>
              </div>
            ) : (
              filteredEvents.map((event) => {
                const SevIcon = severityIcon[event.severity] || Activity;
                const sevColor = severityColor[event.severity] || severityColor.info;
                const isPending = !event.human_decision;
                const isDeciding = decidingId === event.id;
                const decision = getDecisionPayload(event);
                const input = getInputPayload(event);
                const summary = getEventSummary(event);

                return (
                  <div key={event.id} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`h-7 w-7 flex items-center justify-center shrink-0 ${sevColor}`}>
                        <SevIcon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold">{event.agent_name}</span>
                          <Badge variant="outline" className="text-[10px] h-5">{event.event_type}</Badge>
                          {typeof decision?.action === "string" && (
                            <Badge className="bg-primary/15 text-primary border-primary/20 text-[10px] h-5">
                              {decision.action}
                            </Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                            {new Date(event.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed text-foreground">{summary}</p>
                        {typeof decision?.reason === "string" && (
                          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">{decision.reason}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {typeof input?.shipment_id === "string" && <Badge variant="outline" className="text-[10px]">{input.shipment_id}</Badge>}
                          {typeof input?.delivery_id === "string" && <Badge variant="outline" className="text-[10px]">{input.delivery_id}</Badge>}
                          {typeof input?.route === "string" && <Badge variant="outline" className="text-[10px] max-w-80 truncate">{input.route}</Badge>}
                          {typeof decision?.new_eta === "string" && <Badge variant="outline" className="text-[10px]">ETA {decision.new_eta}</Badge>}
                          {(typeof decision?.risk_score === "number" || typeof input?.risk_score === "number") && (
                            <Badge variant="outline" className="text-[10px]">
                              Risk {String(decision?.risk_score ?? input?.risk_score)}
                            </Badge>
                          )}
                        </div>
                        <details className="mt-2 text-[11px] text-muted-foreground">
                          <summary className="cursor-pointer select-none hover:text-foreground">View raw JSON</summary>
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-none border border-border bg-background p-3 font-mono text-[10px] leading-relaxed">{event.payload}</pre>
                        </details>

                        {/* Action buttons for pending events */}
                        {isPending && (
                          <div className="flex items-center gap-2 mt-2.5">
                            <Button
                              size="sm"
                              className="h-7 gap-1.5 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => handleDecision(event.id, "approve")}
                              disabled={isDeciding}
                            >
                              {isDeciding ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 text-[11px] border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
                              onClick={() => handleDecision(event.id, "reject")}
                              disabled={isDeciding}
                            >
                              <ThumbsDown className="h-3 w-3" /> Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 text-[11px] border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:text-violet-400"
                              onClick={() => setOverrideDialog({ eventId: event.id, payload: event.payload })}
                              disabled={isDeciding}
                            >
                              <PenLine className="h-3 w-3" /> Override
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Decision badge */}
                      {event.human_decision && (
                        <Badge className={`shrink-0 text-[10px] border ${decisionStyles[event.human_decision] || ""}`}>
                          {event.human_decision === "approved" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {event.human_decision === "rejected" && <XCircle className="h-3 w-3 mr-1" />}
                          {event.human_decision === "overridden" && <PenLine className="h-3 w-3 mr-1" />}
                          {event.human_decision}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Override Dialog */}
      <Dialog open={!!overrideDialog} onOpenChange={(open) => !open && setOverrideDialog(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <PenLine className="h-4 w-4 text-violet-400" />
              Override Agent Decision
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Original Agent Proposal</label>
              <div className="bg-background border border-border p-3 text-xs text-muted-foreground max-h-24 overflow-y-auto">
                {overrideDialog?.payload}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Custom Action</label>
              <Textarea
                value={overrideText}
                onChange={(e) => setOverrideText(e.target.value)}
                placeholder="Describe the custom action to take instead..."
                className="bg-background resize-none h-20"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Reason for Override</label>
              <Input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g., Agent missed local traffic closure on NH48"
                className="bg-background"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setOverrideDialog(null); setOverrideText(""); setOverrideReason(""); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleOverride}
              disabled={isOverriding || !overrideText.trim()}
              className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
            >
              {isOverriding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
              Apply Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
