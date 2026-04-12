"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Eye,
  Upload,
  Camera,
  Loader2,
  ScanLine,
  Package,
  AlertTriangle,
  Truck,
  Layers,
  Video,
  ZoomIn,
  BarChart3,
  BoxSelect,
  Brain,
} from "lucide-react";
import { apiUpload, apiFetch } from "@/lib/api";

type VisionMode = "damage" | "load" | "vehicle" | "inventory";

interface DamageResult {
  damage_detected: boolean;
  damage_type: string;
  confidence: number;
  severity: string;
  damage_regions: { label: string; detail: string }[];
  moisture_score: number;
  contamination_score: number;
  message: string;
  recommendation: string;
  evidence: string;
}

interface LoadResult {
  fill_percentage: number;
  status: string;
  boxes_loaded: number;
  boxes_remaining: number;
  wasted_capacity_inr: number;
  message: string;
  recommendation: string;
  evidence: string;
}

interface VehicleResult {
  vehicle_count: number;
  congestion_level: string;
  over_capacity_count: number;
  estimated_wait_minutes: number;
  label_summary: Record<string, number>;
  message: string;
}

interface InventoryResult {
  total_segments: number;
  segments: { id: number; label: string; confidence: number; bbox: number[]; area: number; ocr_texts: string[]; source: string }[];
  label_summary: Record<string, number>;
  preview_b64: string;
  segmentation_model: string;
  ai_analysis?: { items?: { name: string; count: number; category: string; confidence: number; evidence: string }[]; summary?: string; query_answer?: string };
}

interface DamageEvent {
  id: number;
  shipment_id: string;
  checkpoint: string;
  damage_type: string;
  confidence: number;
  severity: string;
  created_at: string;
}

const modes: { id: VisionMode; label: string; icon: typeof Eye; desc: string; endpoint: string }[] = [
  { id: "damage", label: "Damage Detection", icon: AlertTriangle, desc: "AI damage assessment via Gemini", endpoint: "/vision/scan" },
  { id: "load", label: "Load Estimation", icon: Package, desc: "Gemini cargo fill analysis", endpoint: "/vision/load-estimate" },
  { id: "vehicle", label: "Vehicle Counter", icon: Truck, desc: "Gemini vehicle count & congestion", endpoint: "/vision/vehicle-count" },
  { id: "inventory", label: "Inventory Scan", icon: Layers, desc: "Gemini visual inventory extraction", endpoint: "/inventory/scan" },
];

const severityColors: Record<string, string> = {
  NONE: "text-emerald-400 bg-emerald-500/15",
  MINOR: "text-amber-400 bg-amber-500/15",
  MODERATE: "text-orange-400 bg-orange-500/15",
  CRITICAL: "text-red-400 bg-red-500/15",
};

const congestionColors: Record<string, string> = {
  LOW: "text-emerald-400",
  MEDIUM: "text-amber-400",
  HIGH: "text-red-400",
};

export default function VisionMonitorPage() {
  const [activeMode, setActiveMode] = useState<VisionMode>("damage");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [damageResult, setDamageResult] = useState<DamageResult | null>(null);
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null);
  const [vehicleResult, setVehicleResult] = useState<VehicleResult | null>(null);
  const [inventoryResult, setInventoryResult] = useState<InventoryResult | null>(null);
  const [damageHistory, setDamageHistory] = useState<DamageEvent[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [processCount, setProcessCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    apiFetch<DamageEvent[]>("/db/damage_events?limit=20&offset=0")
      .then((res) => {
        if ("rows" in (res as unknown as Record<string, unknown>)) {
          setDamageHistory((res as unknown as { rows: DamageEvent[] }).rows);
        }
      })
      .catch(() => {});
  }, [processCount]);

  const clearResults = () => {
    setDamageResult(null);
    setLoadResult(null);
    setVehicleResult(null);
    setInventoryResult(null);
  };

  const processImage = useCallback(async (file: File) => {
    setIsProcessing(true);
    clearResults();
    const mode = modes.find((m) => m.id === activeMode)!;
    const fd = new FormData();
    fd.append("file", file);
    try {
      if (activeMode === "damage") {
        setDamageResult(await apiUpload<DamageResult>(mode.endpoint, fd));
      } else if (activeMode === "load") {
        setLoadResult(await apiUpload<LoadResult>(mode.endpoint, fd));
      } else if (activeMode === "vehicle") {
        setVehicleResult(await apiUpload<VehicleResult>(mode.endpoint, fd));
      } else {
        setInventoryResult(await apiUpload<InventoryResult>(mode.endpoint, fd));
      }
      setProcessCount((c) => c + 1);
    } catch (err) {
      console.error("Vision processing failed:", err);
    } finally {
      setIsProcessing(false);
    }
  }, [activeMode]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
    processImage(file);
  }, [processImage]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }
    } catch (err) {
      const msg = err instanceof DOMException
        ? err.name === "NotAllowedError"
          ? "Camera access denied. Allow camera permission in browser settings."
          : err.name === "NotFoundError"
          ? "No camera found. Connect a camera or use file upload."
          : `Camera error: ${err.message}`
        : "Failed to access camera.";
      setCameraError(msg);
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const captureFrame = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setImagePreview(dataUrl);
    canvas.toBlob((blob) => {
      if (blob) processImage(new File([blob], "capture.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  };

  const hasResult = damageResult || loadResult || vehicleResult || inventoryResult;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Vision Monitor</h2>
          <p className="text-[13px] text-muted-foreground">
            Unified Gemini vision pipeline — damage, loads, vehicles, inventory — all powered by one AI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs gap-1 font-mono">
            <Eye className="h-3 w-3" /> {processCount} processed
          </Badge>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {modes.map((m) => {
          const Icon = m.icon;
          const isActive = activeMode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => { setActiveMode(m.id); clearResults(); }}
              className={`flex items-center gap-2.5 p-3 border transition-colors text-left ${
                isActive
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card/50 text-muted-foreground hover:bg-muted/20 hover:text-foreground"
              }`}
            >
              <div className={`h-8 w-8 flex items-center justify-center shrink-0 ${isActive ? "bg-primary/20" : "bg-muted/20"}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[12px] font-semibold">{m.label}</p>
                <p className="text-[10px] opacity-60">{m.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: Input Panel */}
        <div className="lg:col-span-2 space-y-3">
          <div className="border border-border bg-card/50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-[12px] font-semibold">Input Source</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3 w-3" /> File
                </Button>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => cameraRef.current?.click()}>
                  <Camera className="h-3 w-3" /> Capture
                </Button>
                <Button
                  variant={cameraActive ? "default" : "ghost"}
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  onClick={cameraActive ? stopCamera : startCamera}
                >
                  <Video className="h-3 w-3" /> {cameraActive ? "Stop" : "Live"}
                </Button>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />

            <div className="p-3">
              {cameraError && (
                <div className="flex items-start gap-2 mb-3 px-3 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="text-xs">{cameraError}</p>
                </div>
              )}
              {cameraActive ? (
                <div className="relative">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-64 object-contain bg-black" />
                  <canvas ref={canvasRef} className="hidden" />
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-2">
                    <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={captureFrame} disabled={isProcessing}>
                      {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
                      Analyze Frame
                    </Button>
                  </div>
                  <div className="absolute top-2 right-2">
                    <span className="flex items-center gap-1.5 px-2 py-0.5 bg-red-500/80 text-white text-[10px]">
                      <span className="h-1.5 w-1.5 bg-white animate-pulse" /> LIVE
                    </span>
                  </div>
                </div>
              ) : imagePreview ? (
                <div className="relative group">
                  <img src={imagePreview} alt="Input" className="w-full object-contain max-h-64" />
                  {isProcessing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <div className="flex items-center gap-2 text-white">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-sm">Gemini analyzing...</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="flex flex-col items-center justify-center border border-dashed border-border p-10 cursor-pointer hover:border-primary/40 transition-colors"
                  onClick={() => fileRef.current?.click()}
                >
                  <BoxSelect className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-xs text-muted-foreground">Upload or capture an image</p>
                </div>
              )}
            </div>
          </div>

          {damageHistory.length > 0 && (
            <div className="border border-border bg-card/50">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <BarChart3 className="h-3.5 w-3.5 text-primary" />
                <span className="text-[12px] font-semibold">Recent Damage Events</span>
              </div>
              <ScrollArea className="h-48">
                <div className="divide-y divide-border">
                  {damageHistory.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2 px-3 py-2">
                      <div className={`h-2 w-2 shrink-0 ${
                        ev.severity === "CRITICAL" ? "bg-red-400" :
                        ev.severity === "MODERATE" ? "bg-orange-400" :
                        ev.severity === "MINOR" ? "bg-amber-400" : "bg-emerald-400"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium truncate">{ev.shipment_id}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{ev.checkpoint} — {ev.damage_type}</p>
                      </div>
                      <Badge className={`text-[9px] h-4 ${severityColors[ev.severity] || ""}`}>
                        {ev.severity}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        {/* Right: Results Panel */}
        <div className="lg:col-span-3 space-y-3">
          {isProcessing && (
            <div className="border border-border bg-card/50 flex items-center gap-3 px-4 py-4">
              <Brain className="h-5 w-5 text-primary animate-pulse" />
              <div>
                <p className="text-sm font-medium">Gemini Vision analyzing…</p>
                <p className="text-[11px] text-muted-foreground">Processing image through AI pipeline</p>
              </div>
            </div>
          )}

          {!hasResult && !isProcessing && (
            <div className="border border-border bg-card/50 flex flex-col items-center justify-center py-24">
              <Eye className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">Upload or capture an image to analyze</p>
              <p className="text-[11px] text-muted-foreground/50 mt-1">Select a mode above and provide input</p>
            </div>
          )}

          {/* Damage Results */}
          {damageResult && (
            <div className="space-y-3">
              <div className="border border-border bg-card/50">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-[13px] font-semibold">Damage Analysis</span>
                  <Badge className={`${severityColors[damageResult.severity] || ""}`}>{damageResult.severity}</Badge>
                </div>
                <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="text-center">
                    <p className="text-2xl font-bold tabular-nums">{(damageResult.confidence * 100).toFixed(0)}%</p>
                    <p className="text-[10px] text-muted-foreground">Confidence</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold tabular-nums capitalize">{damageResult.damage_type}</p>
                    <p className="text-[10px] text-muted-foreground">Type</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold tabular-nums">{(damageResult.moisture_score * 100).toFixed(0)}%</p>
                    <p className="text-[10px] text-muted-foreground">Moisture</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold tabular-nums">{(damageResult.contamination_score * 100).toFixed(0)}%</p>
                    <p className="text-[10px] text-muted-foreground">Contamination</p>
                  </div>
                </div>
              </div>
              <div className="border border-border bg-card/50 p-4 space-y-3">
                <div className="border border-border bg-background px-3 py-3">
                  <p className="text-xs text-muted-foreground">Assessment</p>
                  <p className="mt-1 text-sm">{damageResult.message}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="border border-border bg-background px-3 py-3">
                    <p className="text-xs text-muted-foreground">Recommendation</p>
                    <p className="mt-1 text-sm font-semibold">{damageResult.recommendation}</p>
                  </div>
                  <div className="border border-border bg-background px-3 py-3">
                    <p className="text-xs text-muted-foreground">Evidence</p>
                    <p className="mt-1 text-sm">{damageResult.evidence}</p>
                  </div>
                </div>
              </div>
              {damageResult.damage_regions.length > 0 && (
                <div className="border border-border bg-card/50 p-4">
                  <p className="text-[12px] font-semibold mb-2">Damage Regions ({damageResult.damage_regions.length})</p>
                  <div className="space-y-2">
                    {damageResult.damage_regions.map((r, i) => (
                      <div key={i} className="border border-border bg-background px-3 py-2">
                        <p className="text-sm font-medium">{r.label}</p>
                        <p className="text-xs text-muted-foreground">{r.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Load Results */}
          {loadResult && (
            <div className="space-y-3">
              <div className="border border-border bg-card/50 p-6 flex flex-col items-center">
                <div className="relative h-36 w-36 mb-3">
                  <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                    <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="10" className="text-[#2a2a32]" />
                    <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="10"
                      strokeDasharray={`${loadResult.fill_percentage * 3.39} 339.3`} strokeLinecap="round"
                      className={loadResult.fill_percentage >= 80 ? "text-emerald-400" : loadResult.fill_percentage >= 50 ? "text-amber-400" : "text-red-400"}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-3xl font-bold">{loadResult.fill_percentage.toFixed(0)}%</span>
                  </div>
                </div>
                <Badge className={`capitalize ${
                  loadResult.status === "optimal" ? "bg-emerald-500/15 text-emerald-400" :
                  loadResult.status === "overloaded" ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"
                }`}>{loadResult.status}</Badge>
              </div>
              <div className="border border-border bg-card/50 p-4 grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-xl font-bold tabular-nums">{loadResult.boxes_loaded}</p>
                  <p className="text-[10px] text-muted-foreground">Loaded</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold tabular-nums text-amber-400">{loadResult.boxes_remaining}</p>
                  <p className="text-[10px] text-muted-foreground">Remaining</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold tabular-nums text-red-400">₹{loadResult.wasted_capacity_inr.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">Wasted</p>
                </div>
              </div>
              <div className="border border-border bg-card/50 p-4 space-y-2">
                <div className="border border-border bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">Recommendation</p>
                  <p className="mt-1 text-sm font-semibold">{loadResult.recommendation}</p>
                </div>
                <div className="border border-border bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">Evidence</p>
                  <p className="mt-1 text-sm">{loadResult.evidence}</p>
                </div>
              </div>
            </div>
          )}

          {/* Vehicle Results */}
          {vehicleResult && (
            <div className="space-y-3">
              <div className="border border-border bg-card/50 p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="text-center">
                  <p className="text-3xl font-bold tabular-nums">{vehicleResult.vehicle_count}</p>
                  <p className="text-[10px] text-muted-foreground">Vehicles</p>
                </div>
                <div className="text-center">
                  <p className={`text-3xl font-bold ${congestionColors[vehicleResult.congestion_level] || ""}`}>
                    {vehicleResult.congestion_level}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Congestion</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold tabular-nums text-amber-400">{vehicleResult.over_capacity_count}</p>
                  <p className="text-[10px] text-muted-foreground">Over Capacity</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold tabular-nums">{vehicleResult.estimated_wait_minutes}m</p>
                  <p className="text-[10px] text-muted-foreground">Est. Wait</p>
                </div>
              </div>
              {vehicleResult.label_summary && Object.keys(vehicleResult.label_summary).length > 0 && (
                <div className="border border-border bg-card/50 p-4">
                  <p className="text-[12px] font-semibold mb-2">Vehicle Types</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(vehicleResult.label_summary).map(([label, count]) => (
                      <Badge key={label} variant="secondary" className="text-[10px] gap-1">{label} <span className="font-bold">{count}</span></Badge>
                    ))}
                  </div>
                </div>
              )}
              {vehicleResult.message && (
                <div className="border border-border bg-card/50 px-4 py-3">
                  <p className="text-xs text-muted-foreground">{vehicleResult.message}</p>
                </div>
              )}
            </div>
          )}

          {/* Inventory Results */}
          {inventoryResult && (
            <div className="space-y-3">
              {inventoryResult.preview_b64 && (
                <div className="border border-border bg-card/50">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <ZoomIn className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[12px] font-semibold">Image Preview</span>
                    <Badge variant="outline" className="text-[10px] font-mono">{inventoryResult.segmentation_model}</Badge>
                  </div>
                  <img src={`data:image/jpeg;base64,${inventoryResult.preview_b64}`} alt="Preview" className="w-full object-contain max-h-72" />
                </div>
              )}
              <div className="border border-border bg-card/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12px] font-semibold">Inventory Summary</span>
                  <Badge className="bg-primary/15 text-primary">{inventoryResult.total_segments} items</Badge>
                </div>
                {inventoryResult.ai_analysis?.summary && (
                  <p className="text-xs text-muted-foreground mb-3">{inventoryResult.ai_analysis.summary}</p>
                )}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {Object.entries(inventoryResult.label_summary).map(([label, count]) => (
                    <div key={label} className="bg-background p-2 flex items-center justify-between">
                      <span className="text-xs font-medium">{label}</span>
                      <Badge variant="secondary" className="text-[10px]">{count}</Badge>
                    </div>
                  ))}
                </div>
                {inventoryResult.segments.length > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">Confidence Distribution</p>
                    <div className="flex h-6 w-full overflow-hidden">
                      {inventoryResult.segments.map((seg, i) => (
                        <div
                          key={i}
                          className={`h-full border-r border-background ${
                            seg.confidence >= 0.8 ? "bg-emerald-500" :
                            seg.confidence >= 0.5 ? "bg-amber-500" : "bg-red-500"
                          }`}
                          style={{ width: `${100 / inventoryResult.segments.length}%`, opacity: 0.5 + seg.confidence * 0.5 }}
                          title={`${seg.label}: ${(seg.confidence * 100).toFixed(0)}%`}
                        />
                      ))}
                    </div>
                    <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 bg-emerald-500 inline-block" /> &gt;80%</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 bg-amber-500 inline-block" /> 50-80%</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 bg-red-500 inline-block" /> &lt;50%</span>
                    </div>
                  </div>
                )}
              </div>
              {inventoryResult.ai_analysis?.items && inventoryResult.ai_analysis.items.length > 0 && (
                <ScrollArea className="h-48 border border-border bg-card/50">
                  <div className="divide-y divide-border">
                    {inventoryResult.ai_analysis.items.map((item, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2">
                        <span className="text-[10px] font-mono text-muted-foreground w-6">#{i}</span>
                        <span className="text-xs font-medium flex-1">{item.name}</span>
                        <span className="text-[10px] text-muted-foreground">{item.category}</span>
                        <Badge variant="secondary" className="text-[10px]">×{item.count}</Badge>
                        <span className="text-[10px] font-mono text-muted-foreground">{(item.confidence * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
