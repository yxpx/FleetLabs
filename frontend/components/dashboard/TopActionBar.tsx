"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, Circle, Loader2, Play } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface HealthStatus {
  status: string;
  openrouter_configured: boolean;
  vision_model: string;
  inventory_model?: string;
  cv_model?: string;
  agent_model?: string;
}

export function TopActionBar() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    apiFetch("/health")
      .then((res) => setHealth(res as HealthStatus))
      .catch(() => setHealth(null));
  }, []);

  const runAllAgents = async () => {
    setIsRunning(true);
    try {
      await apiFetch("/orchestrator/run", { method: "POST" });
    } catch (err) {
      alert(`Run agents failed\n${err instanceof Error ? err.message : err}`);
    } finally {
      setIsRunning(false);
    }
  };

  const backendStatus = health?.status === "ok" ? "online" : "offline";

  return (
    <header className="flex items-center justify-between border-b border-border px-6 h-14 bg-card/50 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 text-xs">
          <Circle
            className={`h-2 w-2 fill-current ${
              backendStatus === "online" ? "text-emerald-400" : "text-red-400"
            }`}
          />
          <span className="text-muted-foreground font-medium">
            {backendStatus === "online" ? "Connected" : "Offline"}
          </span>
        </div>
        <Badge
          variant="outline"
          className={health?.openrouter_configured ? "border-emerald-500/30 text-emerald-400" : "border-amber-500/30 text-amber-400"}
        >
          <Bot className="h-3 w-3 mr-1" />
          {health?.openrouter_configured ? "OpenRouter Ready" : "OpenRouter Missing"}
        </Badge>
        {(health?.inventory_model || health?.cv_model || health?.vision_model) && (
          <Badge variant="outline" className="hidden lg:inline-flex text-[10px] font-mono">
            {health.inventory_model ?? health.cv_model ?? health.vision_model}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={runAllAgents}
          disabled={isRunning || backendStatus !== "online"}
          className="gap-1.5 text-xs h-8"
        >
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run Agents
        </Button>
      </div>
    </header>
  );
}
