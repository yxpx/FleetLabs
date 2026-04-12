"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, Pencil } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface ActionCardProps {
  eventId: number;
  agentName: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  onDecision?: () => void;
}

const severityDot = {
  info: "bg-blue-400",
  warning: "bg-amber-400",
  critical: "bg-red-400",
};

const severityBadge = {
  info: "bg-blue-500/15 text-blue-400 border-0",
  warning: "bg-amber-500/15 text-amber-400 border-0",
  critical: "bg-red-500/15 text-red-400 border-0",
};

export function ActionCard({
  eventId,
  agentName,
  title,
  description,
  severity,
  onDecision,
}: ActionCardProps) {
  const handleAction = async (action: "approve" | "reject") => {
    await apiFetch(`/actions/${eventId}/${action}`, { method: "POST" });
    onDecision?.();
  };

  return (
    <div className="border border-border bg-card/50 p-3.5 hover:bg-muted/20 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge className={`text-[10px] h-5 ${severityBadge[severity]}`}>
              {severity.toUpperCase()}
            </Badge>
            <span className="text-[11px] text-muted-foreground">{agentName}</span>
          </div>
          <h4 className="text-[13px] font-medium">{title}</h4>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-emerald-400 hover:bg-emerald-500/10"
            onClick={() => handleAction("approve")}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-red-400 hover:bg-red-500/10"
            onClick={() => handleAction("reject")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:bg-muted/50"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
