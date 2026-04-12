import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  compactTrend?: boolean;
  trendDirection?: "up" | "down" | "flat";
  tone?: "default" | "success" | "warning" | "danger";
  icon?: React.ReactNode;
  subtitle?: string;
}

const toneColors = {
  default: "text-muted-foreground",
  success: "text-emerald-400",
  warning: "text-amber-400",
  danger: "text-red-400",
};

const toneBg = {
  default: "bg-muted/50",
  success: "bg-emerald-500/8",
  warning: "bg-amber-500/8",
  danger: "bg-red-500/8",
};

export function StatCard({
  label,
  value,
  trend,
  compactTrend = false,
  trendDirection = "flat",
  tone = "default",
  icon,
  subtitle,
}: StatCardProps) {
  return (
    <div className={cn(
      "border border-border p-4 transition-colors hover:border-border/80",
      toneBg[tone]
    )}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        {icon && <div className="text-muted-foreground/60">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {trend && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-[11px] font-medium",
              trendDirection === "up" && "text-emerald-400",
              trendDirection === "down" && "text-red-400",
              trendDirection === "flat" && "text-muted-foreground"
            )}
          >
            {trendDirection === "up" && <TrendingUp className="h-3 w-3" />}
            {trendDirection === "down" && <TrendingDown className="h-3 w-3" />}
            {trendDirection === "flat" && <Minus className="h-3 w-3" />}
            {!compactTrend && trend}
          </span>
        )}
      </div>
      {subtitle && (
        <p className={cn("text-[11px] font-medium mt-1", toneColors[tone])}>
          {subtitle}
        </p>
      )}
    </div>
  );
}
