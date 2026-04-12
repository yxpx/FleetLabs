"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { sseUrl } from "@/lib/api";
import { AlertTriangle, Info, AlertCircle, Radio } from "lucide-react";

interface AgentEvent {
  id: number;
  agent_name: string;
  event_type: string;
  payload: string;
  severity: string;
  human_decision: string | null;
  created_at: string;
}

const severityConfig = {
  info: { icon: Info, dot: "bg-blue-400" },
  warning: { icon: AlertTriangle, dot: "bg-amber-400" },
  critical: { icon: AlertCircle, dot: "bg-red-400" },
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
  if (typeof parsed?.summary === "string") return parsed.summary;
  if (typeof parsed?.message === "string") return parsed.message;
  return event.event_type;
}

function getActionBadge(event: AgentEvent): string | null {
  const parsed = parsePayload(event.payload);
  const decision = parsed?.decision as Record<string, unknown> | undefined;
  if (typeof decision?.action === "string") return decision.action;
  return null;
}

export function EventFeed() {
  const [events, setEvents] = useState<AgentEvent[]>([]);

  useEffect(() => {
    const es = new EventSource(sseUrl("/orchestrator/events"));
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed.type === "DECISION" && parsed.data?.event) {
          // Real-time decision update — patch the matching event in place
          const updated = parsed.data.event as AgentEvent;
          setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        } else if (parsed.data && Array.isArray(parsed.data)) {
          setEvents(parsed.data);
        }
      } catch {
        // ignore parse errors
      }
    };
    return () => es.close();
  }, []);

  return (
    <div className="border border-border bg-card/50">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-primary" />
          <span className="text-[13px] font-semibold">Live Feed</span>
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {events.length} events
        </span>
      </div>
      <ScrollArea className="h-80">
        <div className="p-2 space-y-0.5">
          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Radio className="h-5 w-5 text-muted-foreground/40 mb-2" />
              <p className="text-[12px] text-muted-foreground">
                No events yet. Run agents to see activity.
              </p>
            </div>
          ) : (
            events.map((event) => {
              const sev = severityConfig[event.severity as keyof typeof severityConfig] || severityConfig.info;
              const summary = getEventSummary(event);
              const action = getActionBadge(event);
              return (
                <div
                  key={event.id}
                  className="flex items-start gap-2.5 px-2.5 py-2 hover:bg-muted/50 transition-colors"
                >
                  <div className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${sev.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-medium">{event.agent_name}</span>
                      <span className="text-[11px] text-muted-foreground">· {event.event_type}</span>
                      {action && (
                        <Badge className="bg-primary/15 text-primary border-primary/20 text-[9px] h-4 px-1.5">{action}</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                      {summary}
                    </p>
                  </div>
                  {event.human_decision ? (
                    <Badge variant="outline" className="text-[10px] h-5 shrink-0">
                      {event.human_decision}
                    </Badge>
                  ) : (
                    <Badge className="text-[10px] h-5 shrink-0 bg-amber-500/15 text-amber-400 border-0">
                      Pending
                    </Badge>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
