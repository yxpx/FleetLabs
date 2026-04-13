"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Camera,
  Loader2,
  Package,
  ScanLine,
  Upload,
  Video,
  Brain,
} from "lucide-react";
import { apiUpload } from "@/lib/api";

/* ── Types ── */
interface Workflow {
  enabled: boolean;
  provider: string;
  model: string;
  prompt_version: string;
  pipeline: string;
  reason?: string;
}

interface LoadResult {
  fill_percentage: number;
  status: string;
  boxes_loaded: number;
  boxes_remaining: number;
  wasted_capacity_inr?: number;
  message: string;
  recommendation: string;
  evidence: string;
  preview_b64: string;
  ai_workflow: Workflow;
}

/* ── Component ── */
export default function LoadPage() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [history, setHistory] = useState<{ fill: number; time: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const processFile = useCallback(async (file: File, previewUrl?: string) => {
    if (previewUrl) setImagePreview(previewUrl);
    setResult(null);
    setIsAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiUpload<LoadResult>("/vision/load-estimate", fd);
      setResult(res);
      setHistory((prev) => [
        { fill: res.fill_percentage, time: new Date().toLocaleTimeString() },
        ...prev.slice(0, 11),
      ]);
    } catch (err) {
      alert(`Analysis failed\n${err instanceof Error ? err.message : err}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file, URL.createObjectURL(file));
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 1280, height: 720 },
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch (err) {
      alert(`Camera unavailable\n${err instanceof Error ? err.message : err}`);
    }
  };

  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const purl = canvas.toDataURL("image/jpeg", 0.92);
      processFile(
        new File([blob], `load-${Date.now()}.jpg`, { type: "image/jpeg" }),
        purl,
      );
    }, "image/jpeg", 0.92);
  };

  const fill = result?.fill_percentage ?? 0;
  const statusTone =
    fill >= 80
      ? "text-emerald-400"
      : fill >= 55
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Load Intelligence</h2>
          <p className="text-[13px] text-muted-foreground">
            Load utilization analysis — upload or capture a truck/container image.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Upload
          </Button>
          <Button
            variant={cameraActive ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={cameraActive ? stopCamera : startCamera}
          >
            <Video className="h-3.5 w-3.5" /> {cameraActive ? "Stop Live" : "Live Camera"}
          </Button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      <canvas ref={canvasRef} className="hidden" />

      {/* Processing indicator */}
      {isAnalyzing && (
        <div className="flex items-center gap-3 border border-border bg-card px-4 py-2.5">
          <Brain className="h-4 w-4 text-primary animate-pulse" />
          <span className="text-sm font-medium">Gemini analyzing load utilization…</span>
          <span className="text-xs text-muted-foreground">please wait</span>
        </div>
      )}

      {/* Stat cards */}
      {result && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Fill Level</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${statusTone}`}>{fill.toFixed(0)}%</p>
          </div>
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Loaded Units</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{result.boxes_loaded}</p>
          </div>
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Remaining Capacity</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-400">{result.boxes_remaining}</p>
          </div>
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Economic Leakage</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-red-400">₹{(result.wasted_capacity_inr ?? 0).toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left — Image Input */}
        <Card className="border-border bg-card">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Image Input</h3>
              {cameraActive && (
                <Button size="sm" className="gap-1.5" onClick={captureFrame} disabled={isAnalyzing}>
                  {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
                  Capture & Analyze
                </Button>
              )}
            </div>
            {cameraActive ? (
              <div className="relative bg-black">
                <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-96 object-contain" />
                <div className="absolute top-2 right-2">
                  <Badge className="bg-red-500/80 text-white border-none gap-1 text-[10px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> LIVE
                  </Badge>
                </div>
              </div>
            ) : imagePreview ? (
              <img src={imagePreview} alt="Load input" className="w-full max-h-96 object-contain" />
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center border border-dashed border-border text-center">
                <Package className="mb-3 h-9 w-9 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Upload a truck/container image or start the live camera.</p>
              </div>
            )}
            {history.length > 0 && (
              <div className="border border-border bg-background p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold">Live History</span>
                  <span className="text-[10px] text-muted-foreground">last {history.length} captures</span>
                </div>
                <div className="flex h-12 items-end gap-1">
                  {history.slice().reverse().map((entry, i) => (
                    <div key={`${entry.time}-${i}`} className="flex-1">
                      <div
                        className={`${entry.fill >= 80 ? "bg-emerald-500" : entry.fill >= 55 ? "bg-amber-500" : "bg-red-500"} w-full`}
                        style={{ height: `${Math.max(6, Math.min(48, entry.fill / 2))}px` }}
                        title={`${entry.fill.toFixed(0)}% at ${entry.time}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right — Gemini Verdict */}
        <Card className="border-border bg-card">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Utilization Verdict</h3>
                {result && <p className="mt-1 text-sm text-muted-foreground">{result.message}</p>}
              </div>
              {result && (
                <Badge className={`capitalize ${fill >= 80 ? "bg-emerald-500/15 text-emerald-400" : fill >= 55 ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400"}`}>
                  {result.status}
                </Badge>
              )}
            </div>
            {isAnalyzing && !result ? (
              <div className="flex items-center gap-3 py-6 justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Waiting for verdict…</span>
              </div>
            ) : result ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="border border-border bg-background px-3 py-3">
                    <p className="text-xs text-muted-foreground">Recommendation</p>
                    <p className="mt-1 text-sm font-semibold">{result.recommendation}</p>
                  </div>
                  <div className="border border-border bg-background px-3 py-3 md:col-span-1">
                    <p className="text-xs text-muted-foreground">Evidence</p>
                    <p className="mt-1 text-sm">{result.evidence}</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="border border-border bg-background px-3 py-3">
                    <p className="text-xs text-muted-foreground">Model</p>
                    <p className="mt-1 break-all font-mono text-xs">{result.ai_workflow.model}</p>
                  </div>
                  <div className="border border-border bg-background px-3 py-3">
                    <p className="text-xs text-muted-foreground">Pipeline</p>
                    <p className="mt-1 text-sm font-semibold">{result.ai_workflow.pipeline}</p>
                  </div>
                </div>
                {result.ai_workflow.reason && (
                  <div className="border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                    {result.ai_workflow.reason}
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No model verdict yet.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
