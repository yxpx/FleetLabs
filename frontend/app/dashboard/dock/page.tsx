"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Truck,
  RefreshCcw,
  Clock,
  CheckCircle2,
  Loader2,
  Camera,
  Video,
  VideoOff,
  ScanLine,
  Upload,
  AlertCircle,
} from "lucide-react";
import { apiUpload } from "@/lib/api";

interface DockSlot {
  id: string;
  dock_number: number;
  status: "available" | "occupied" | "reserved" | "maintenance";
  vehicle_id?: string;
  eta?: string;
  updated_at: string;
}

interface VehicleCountResult {
  vehicle_count: number;
  congestion_level: string;
  over_capacity_count: number;
  estimated_wait_minutes: number;
  bounding_boxes: number[][];
  preview_b64?: string;
  label_summary?: Record<string, number>;
  model?: string;
  method?: string;
}

const statusConfig: Record<string, { color: string; label: string }> = {
  available: { color: "bg-emerald-500/20 text-emerald-400", label: "Available" },
  occupied: { color: "bg-blue-500/20 text-blue-400", label: "Occupied" },
  reserved: { color: "bg-amber-500/20 text-amber-400", label: "Reserved" },
  maintenance: { color: "bg-red-500/20 text-red-400", label: "Maintenance" },
};

export default function DockPage() {
  const [slots, setSlots] = useState<DockSlot[]>([]);
  const [vehicleResult, setVehicleResult] = useState<VehicleCountResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCounting, setIsCounting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadSlots = useCallback(async () => {
    setIsLoading(true);
    try {
      const placeholders: DockSlot[] = Array.from({ length: 8 }, (_, i) => ({
        id: `dock-${i + 1}`,
        dock_number: i + 1,
        status: (["available", "occupied", "reserved", "maintenance"] as const)[
          Math.floor(Math.random() * 4)
        ],
        updated_at: new Date().toISOString(),
      }));
      setSlots(placeholders);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const processFile = async (file: File) => {
    setIsCounting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiUpload<VehicleCountResult>("/vision/vehicle-count", fd);
      setVehicleResult(res);
    } catch (err) {
      console.error("Vehicle count failed:", err);
    } finally {
      setIsCounting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }
    } catch (err) {
      const msg = err instanceof DOMException
        ? err.name === "NotAllowedError"
          ? "Camera access denied. Please allow camera permission in your browser settings."
          : err.name === "NotFoundError"
          ? "No camera found. Connect a camera or use file upload instead."
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

  const captureAndCount = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) processFile(new File([blob], "capture.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9,
    );
  };

  const available = slots.filter((s) => s.status === "available").length;
  const occupied = slots.filter((s) => s.status === "occupied").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Dock Management</h2>
          <p className="text-[13px] text-muted-foreground">
            Monitor dock slot availability and yard vehicle counts.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={loadSlots} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Docks", value: slots.length, icon: Truck },
          { label: "Available", value: available, icon: CheckCircle2 },
          { label: "Occupied", value: occupied, icon: Clock },
          { label: "Yard Vehicles", value: vehicleResult?.vehicle_count ?? "—", icon: Camera },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="border-border bg-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 bg-primary/10 flex items-center justify-center">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold tabular-nums">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Live Camera & Vehicle Count */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Yard Camera</span>
              {cameraActive && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[10px] font-medium">
                  <span className="h-1.5 w-1.5 bg-red-400 rounded-full animate-pulse" /> LIVE
                </span>
              )}
            </div>
            <div className="flex gap-1.5">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3 w-3" /> Upload
              </Button>
              <Button
                variant={cameraActive ? "default" : "outline"}
                size="sm"
                className="h-7 gap-1 text-[11px]"
                onClick={cameraActive ? stopCamera : startCamera}
              >
                {cameraActive ? <VideoOff className="h-3 w-3" /> : <Video className="h-3 w-3" />}
                {cameraActive ? "Stop" : "Live Feed"}
              </Button>
            </div>
          </div>

          <div className="p-3">
            {cameraError && (
              <div className="flex items-start gap-2 mb-3 px-3 py-2.5 bg-red-500/10 border border-red-500/20 text-red-400">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="text-xs">{cameraError}</p>
              </div>
            )}

            {cameraActive ? (
              <div className="relative">
                <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-video object-cover bg-black/80" />
                <canvas ref={canvasRef} className="hidden" />
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                  <Button size="sm" className="gap-1.5 text-xs shadow-lg" onClick={captureAndCount} disabled={isCounting}>
                    {isCounting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
                    Count Vehicles
                  </Button>
                </div>
              </div>
            ) : vehicleResult?.preview_b64 ? (
              <img
                src={`data:image/jpeg;base64,${vehicleResult.preview_b64}`}
                alt="Detection overlay"
                className="w-full aspect-video object-contain bg-black/20"
              />
            ) : (
              <div
                className="flex flex-col items-center justify-center aspect-video bg-muted/5 border border-dashed border-border cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <Camera className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">Start live feed or upload a yard photo</p>
              </div>
            )}
          </div>
        </div>

        {/* Vehicle Count Results */}
        <div className="border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold">Detection Results</span>
            {vehicleResult?.model && (
              <Badge variant="outline" className="text-[10px] font-mono">{vehicleResult.model}</Badge>
            )}
          </div>
          <div className="p-4 space-y-4">
            {vehicleResult ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-border bg-background px-3 py-3 text-center">
                    <p className="text-3xl font-bold tabular-nums">{vehicleResult.vehicle_count}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Vehicles Detected</p>
                  </div>
                  <div className="border border-border bg-background px-3 py-3 text-center">
                    <p className={`text-3xl font-bold ${
                      vehicleResult.congestion_level === "HIGH" ? "text-red-400" :
                      vehicleResult.congestion_level === "MEDIUM" ? "text-amber-400" : "text-emerald-400"
                    }`}>
                      {vehicleResult.congestion_level}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">Congestion</p>
                  </div>
                  <div className="border border-border bg-background px-3 py-3 text-center">
                    <p className="text-2xl font-bold tabular-nums text-amber-400">{vehicleResult.over_capacity_count}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Over Capacity</p>
                  </div>
                  <div className="border border-border bg-background px-3 py-3 text-center">
                    <p className="text-2xl font-bold tabular-nums">{vehicleResult.estimated_wait_minutes}m</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Est. Wait</p>
                  </div>
                </div>
                {vehicleResult.label_summary && Object.keys(vehicleResult.label_summary).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2">Detected Classes</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(vehicleResult.label_summary).map(([label, count]) => (
                        <Badge key={label} variant="secondary" className="text-[10px] gap-1">
                          {label} <span className="font-bold">{count}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Truck className="h-8 w-8 opacity-20 mb-2" />
                <p className="text-sm">No detection yet</p>
                <p className="text-[11px] opacity-50 mt-0.5">Upload a photo or use the live feed</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dock Slots Grid */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Dock Slots</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {slots.map((slot) => {
            const conf = statusConfig[slot.status];
            return (
              <Card key={slot.id} className="border-border bg-card hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">Dock {slot.dock_number}</span>
                    <Badge className={conf.color}>{conf.label}</Badge>
                  </div>
                  {slot.vehicle_id && (
                    <p className="text-xs text-muted-foreground">Vehicle: {slot.vehicle_id}</p>
                  )}
                  {slot.eta && (
                    <p className="text-xs text-muted-foreground">ETA: {slot.eta}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
