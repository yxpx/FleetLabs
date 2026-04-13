"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Upload,
  Video,
  XCircle,
  Brain,
} from "lucide-react";
import { apiUpload } from "@/lib/api";

/* ── Types ── */
interface DamageRegion {
  label: string;
  detail: string;
}

interface Workflow {
  enabled: boolean;
  provider: string;
  model: string;
  prompt_version: string;
  pipeline: string;
  reason?: string;
}

interface DamageResult {
  damage_detected: boolean;
  damage_type: string;
  confidence: number;
  severity: "NONE" | "MINOR" | "MODERATE" | "CRITICAL";
  damage_regions: DamageRegion[];
  moisture_score: number;
  contamination_score: number;
  message: string;
  recommendation: string;
  evidence: string;
  preview_b64: string;
  ai_workflow: Workflow;
}

const severityStyles = {
  NONE: { badge: "bg-emerald-500/15 text-emerald-400", icon: CheckCircle2 },
  MINOR: { badge: "bg-blue-500/15 text-blue-400", icon: AlertTriangle },
  MODERATE: { badge: "bg-amber-500/15 text-amber-400", icon: AlertTriangle },
  CRITICAL: { badge: "bg-red-500/15 text-red-400", icon: XCircle },
};

/* ── Component ── */
export default function DamagePage() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [result, setResult] = useState<DamageResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      const res = await apiUpload<DamageResult>("/vision/scan", fd);
      setResult(res);
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
        new File([blob], `damage-${Date.now()}.jpg`, { type: "image/jpeg" }),
        purl,
      );
    }, "image/jpeg", 0.92);
  };

  const severity = result ? severityStyles[result.severity] : null;
  const SeverityIcon = severity?.icon ?? ShieldAlert;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Damage Control</h2>
          <p className="text-[13px] text-muted-foreground">
            Damage assessment — upload a shipment image for AI triage.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
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

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      <canvas ref={canvasRef} className="hidden" />

      {/* Processing indicator */}
      {isAnalyzing && (
        <div className="flex items-center gap-3 border border-border bg-card px-4 py-2.5">
          <Brain className="h-4 w-4 text-primary animate-pulse" />
          <span className="text-sm font-medium">Gemini assessing damage…</span>
          <span className="text-xs text-muted-foreground">please wait</span>
        </div>
      )}

      {/* Stat cards */}
      {result && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Severity</p>
            <p className="mt-1 text-2xl font-semibold">{result.severity}</p>
          </div>
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Confidence</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{Math.round(result.confidence * 100)}%</p>
          </div>
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Moisture</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{Math.round(result.moisture_score * 100)}%</p>
          </div>
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Contamination</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{Math.round(result.contamination_score * 100)}%</p>
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
                  {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
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
              <img src={imagePreview} alt="Damage input" className="w-full max-h-96 object-contain" />
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center border border-dashed border-border text-center">
                <ShieldAlert className="mb-3 h-9 w-9 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Upload a shipment image or start the live camera.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right — Gemini Verdict */}
        <Card className="border-border bg-card">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Damage Verdict</h3>
                {result && <p className="mt-1 text-sm text-muted-foreground">{result.message}</p>}
              </div>
              {result && severity && (
                <Badge className={severity.badge}>
                  <SeverityIcon className="mr-1 h-3.5 w-3.5" /> {result.severity}
                </Badge>
              )}
            </div>
            {isAnalyzing && !result ? (
              <div className="flex items-center gap-3 py-6 justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Waiting for Gemini triage…</span>
              </div>
            ) : result ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="border border-border bg-background px-3 py-3">
                    <p className="text-xs text-muted-foreground">Recommendation</p>
                    <p className="mt-1 text-sm font-semibold">{result.recommendation}</p>
                  </div>
                  <div className="border border-border bg-background px-3 py-3">
                    <p className="text-xs text-muted-foreground">Damage Type</p>
                    <p className="mt-1 text-sm font-semibold capitalize">{result.damage_type}</p>
                  </div>
                  <div className="border border-border bg-background px-3 py-3 md:col-span-2">
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
                {result.damage_regions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Damage Regions</p>
                    {result.damage_regions.slice(0, 4).map((region, i) => (
                      <div key={`${region.label}-${i}`} className="border border-border bg-background px-3 py-2">
                        <p className="text-sm font-medium">{region.label}</p>
                        <p className="text-xs text-muted-foreground">{region.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
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
