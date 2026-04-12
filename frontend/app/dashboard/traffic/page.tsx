"use client";

import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Camera,
  Clock,
  Loader2,
  Play,
  Square,
  Truck,
  Video,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface LiveTrafficStats {
  frames: number;
  elapsed: number;
  detections: number;
  avg: number;
  max: number;
  congestion: string;
  congestion_pct: number;
  passed: number;
  source_label: string;
}

interface SummaryStats {
  frames: number;
  seconds: number;
  avg: number;
  max: number;
  passed: number;
  source_label: string;
}

interface HistoryPoint {
  elapsed: number;
  detections: number;
  passed: number;
  congestion_pct: number;
}

const tooltipStyle = {
  backgroundColor: "#1a1a1f",
  border: "1px solid #2a2a32",
  borderRadius: "0",
  color: "#ffffff",
  fontSize: "12px",
  padding: "8px 12px",
};

export default function TrafficAnalyticsPage() {
  const [source, setSource] = useState<"video" | "camera">("video");
  const [videoPath, setVideoPath] = useState("D:\\Projects\\FleetLabs\\Logistics_truck_vid.mp4");

  const videoPresets = [
    { label: "Truck Video 1", path: "D:\\Projects\\FleetLabs\\Logistics_truck_vid.mp4" },
    { label: "Truck Video 2", path: "D:\\Projects\\FleetLabs\\Logistics_truck_vid_2.mp4" },
  ];
  const [maxSeconds, setMaxSeconds] = useState("30");
  const [status, setStatus] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<LiveTrafficStats | null>(null);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const runAnalytics = async () => {
    setIsRunning(true);
    setStatus("Connecting to truck counter...");
    setLiveFrame(null);
    setLiveStats(null);
    setSummary(null);
    setHistory([]);

    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams({
      source,
      max_seconds: String(Math.min(Math.max(Number(maxSeconds) || 30, 5), 90)),
      frame_stride: "2",
    });
    if (source === "video" && videoPath.trim()) {
      params.set("path", videoPath.trim());
    }

    try {
      const response = await fetch(`${API_URL}/traffic/stream?${params.toString()}`, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      setStatus("Streaming live truck counts...");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));

          if (data.error) {
            setStatus(`Error: ${data.error}`);
            setIsRunning(false);
            return;
          }

          if (data.done) {
            setSummary({
              frames: data.frames,
              seconds: data.seconds,
              avg: data.avg,
              max: data.max,
              passed: data.passed,
              source_label: data.source_label,
            });
            setStatus(`Completed ${data.frames} sampled frames in ${data.seconds}s.`);
            setIsRunning(false);
            return;
          }

          setLiveFrame(`data:image/jpeg;base64,${data.frame}`);
          setLiveStats({
            frames: data.n,
            elapsed: data.elapsed,
            detections: data.det,
            avg: data.avg,
            max: data.max,
            congestion: data.congestion,
            congestion_pct: data.congestion_pct,
            passed: data.passed,
            source_label: data.source_label,
          });
          setHistory((previous) => [
            ...previous.slice(-59),
            {
              elapsed: data.elapsed,
              detections: data.det,
              passed: data.passed,
              congestion_pct: data.congestion_pct,
            },
          ]);
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus("Stopped");
      } else {
        setStatus(err instanceof Error ? err.message : "Truck analytics stream failed");
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const stopAnalytics = () => abortRef.current?.abort();

  const congestionTone = useMemo(() => {
    const label = liveStats?.congestion ?? "";
    if (label === "Severe") return "text-red-400";
    if (label === "Moderate") return "text-amber-400";
    if (label === "Light") return "text-yellow-300";
    if (label === "Free Flow") return "text-emerald-400";
    return "text-muted-foreground";
  }, [liveStats?.congestion]);

  const kpis = [
    { label: "Passed Center", value: liveStats?.passed ?? summary?.passed ?? 0 },
    { label: "Trucks In Frame", value: liveStats?.detections ?? 0 },
    { label: "Average / Frame", value: (liveStats?.avg ?? summary?.avg ?? 0).toFixed(1) },
    { label: "Peak / Frame", value: liveStats?.max ?? summary?.max ?? 0 },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Truck Flow Analytics</h2>
          <p className="text-[13px] text-muted-foreground">
            YOLOv8n + ByteTrack style truck monitoring for gate and center traffic, sourced from the ST traffic project assets you added.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] font-mono">
          ST_Traffic_Forecasting model feed
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="border border-border bg-card/50 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr,0.85fr]">
        <Card className="border-border bg-card/50 overflow-hidden">
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                <button
                  className={`h-9 px-4 text-sm transition-colors ${source === "video" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setSource("video")}
                  disabled={isRunning}
                >
                  <Video className="mr-1.5 inline h-4 w-4" /> Video
                </button>
                <button
                  className={`h-9 px-4 text-sm transition-colors ${source === "camera" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setSource("camera")}
                  disabled={isRunning}
                >
                  <Camera className="mr-1.5 inline h-4 w-4" /> Camera
                </button>
              </div>

              {!isRunning ? (
                <Button className="gap-1.5" onClick={runAnalytics}>
                  <Play className="h-4 w-4" /> Run Truck Counter
                </Button>
              ) : (
                <Button variant="destructive" className="gap-1.5" onClick={stopAnalytics}>
                  <Square className="h-4 w-4" /> Stop
                </Button>
              )}
            </div>

            {source === "video" && (
              <div className="grid gap-1.5">
                <label className="text-xs text-muted-foreground">Video source</label>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-md border border-border overflow-hidden">
                    {videoPresets.map((preset) => (
                      <button
                        key={preset.path}
                        className={`h-9 px-3 text-[12px] transition-colors whitespace-nowrap ${
                          videoPath === preset.path
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setVideoPath(preset.path)}
                        disabled={isRunning}
                      >
                        {preset.label}
                      </button>
                    ))}
                    <button
                      className={`h-9 px-3 text-[12px] transition-colors whitespace-nowrap ${
                        !videoPresets.some((p) => p.path === videoPath)
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setVideoPath("")}
                      disabled={isRunning}
                    >
                      Custom
                    </button>
                  </div>
                </div>
                {!videoPresets.some((p) => p.path === videoPath) && (
                  <Input
                    value={videoPath}
                    onChange={(e) => setVideoPath(e.target.value)}
                    placeholder="Enter custom video file path..."
                    disabled={isRunning}
                  />
                )}
              </div>
            )}

            <div className="grid gap-1.5 md:max-w-45">
              <label className="text-xs text-muted-foreground">Max seconds (5-90)</label>
              <Input type="number" min={5} max={90} value={maxSeconds} onChange={(e) => setMaxSeconds(e.target.value)} disabled={isRunning} />
            </div>

            {status && <p className={`text-xs ${status.startsWith("Error") ? "text-red-400" : "text-muted-foreground"}`}>{status}</p>}

            <div className="relative w-full overflow-hidden bg-black" style={{ height: 400 }}>
              {liveFrame ? (
                <img src={liveFrame} alt="Truck analytics feed" className="absolute inset-0 w-full h-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {isRunning ? "Waiting for first annotated frame..." : "Run the truck counter to start streaming annotated frames."}
                </div>
              )}

              {isRunning && liveStats && (
                <div className="absolute left-3 top-3 bg-black/70 px-2.5 py-1.5 text-xs text-white font-mono rounded-sm">
                  F{liveStats.frames} · {liveStats.detections} trucks · passed {liveStats.passed}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border bg-card/50">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Live KPI Stack</h3>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Congestion</span>
                <span className={`font-semibold ${congestionTone}`}>{liveStats?.congestion ?? "—"}</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${liveStats?.congestion_pct ?? 0}%` }} />
              </div>
              <div className="grid gap-2 text-sm">
                <MetricRow label="Current frame trucks" value={String(liveStats?.detections ?? 0)} />
                <MetricRow label="Total passed center" value={String(liveStats?.passed ?? summary?.passed ?? 0)} />
                <MetricRow label="Average trucks / frame" value={(liveStats?.avg ?? summary?.avg ?? 0).toFixed(1)} />
                <MetricRow label="Elapsed" value={`${liveStats?.elapsed ?? summary?.seconds ?? 0}s`} />
                <MetricRow label="Source" value={liveStats?.source_label ?? summary?.source_label ?? (source === "camera" ? "Camera 0" : "Workspace demo video")} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/50">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Flow Trend</h3>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a32" vertical={false} />
                    <XAxis dataKey="elapsed" tick={{ fill: "#a0a0af", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#a0a0af", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <RTooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#a0a0af", paddingTop: 4 }} />
                    <Area type="monotone" dataKey="detections" name="Trucks in frame" stroke="#4d8eff" fill="#4d8eff" fillOpacity={0.2} strokeWidth={2} />
                    <Line type="monotone" dataKey="passed" name="Passed center" stroke="#34d399" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="congestion_pct" name="Congestion %" stroke="#f59e0b" dot={false} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-border bg-background px-3 py-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}