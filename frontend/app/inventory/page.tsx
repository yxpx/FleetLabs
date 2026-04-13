"use client";

import { useState, useRef, useCallback, useEffect, Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Camera,
  Upload,
  Video,
  ScanLine,
  Sparkles,
  Save,
  Image as ImageIcon,
  Loader2,
  Package,
  Eye,
  Database,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
  X,
  TableProperties,
  Braces,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Check,
  Trash,
  DatabaseZap,
} from "lucide-react";
import { apiUpload, apiFetch } from "@/lib/api";

interface Segment {
  id: number;
  label: string;
  confidence: number;
  bbox: number[];
  area: number;
  ocr_texts: string[];
  source: string;
}

interface AiItem {
  name: string;
  brand: string;
  category: string;
  count: number;
  location: string;
  condition: string;
  confidence: number;
  evidence: string;
}

interface AiAnalysis {
  items: AiItem[];
  total_items: number;
  summary: string;
  query_answer: string | null;
  raw_output?: string | null;
}

interface AiWorkflow {
  enabled: boolean;
  status?: "success" | "response_error" | "unavailable";
  provider: string;
  model: string;
  prompt_version: string;
  image_strategy: string;
  context_strategy: string;
  candidate_labels?: string[];
  ocr_clue_count?: number;
  reason?: string;
}

interface ScanResult {
  total_segments: number;
  segments: Segment[];
  label_summary: Record<string, number>;
  preview_b64: string;
  segmentation_model: string;
  query: string;
  ai_analysis: AiAnalysis | null;
  ai_workflow: AiWorkflow | null;
}

interface InventoryScan {
  id: number;
  scan_id: string;
  item_count: number;
  schema_columns: string;
  items: string;
  natural_language_query: string | null;
  created_at: string;
}

interface DbTable {
  name: string;
  count: number;
}

interface DbBrowseResult {
  table: string;
  total: number;
  limit: number;
  offset: number;
  rows: Record<string, unknown>[];
}

export default function InventoryPage() {
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [nlQuery, setNlQuery] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanPhase, setScanPhase] = useState<"idle" | "analyzing" | "done">("idle");
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Inventory scan viewer state
  const [scans, setScans] = useState<InventoryScan[]>([]);
  const [isLoadingScans, setIsLoadingScans] = useState(false);
  const [expandedScan, setExpandedScan] = useState<string | null>(null);
  const [editDialog, setEditDialog] = useState<{
    scanId: string;
    itemId: number;
    label: string;
    confidence: string;
    source: string;
  } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  // Multi-table DB browser state
  const [dbTables, setDbTables] = useState<DbTable[]>([]);
  const [activeTable, setActiveTable] = useState<string>("inventory_scans");
  const [dbData, setDbData] = useState<DbBrowseResult | null>(null);
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [dbViewMode, setDbViewMode] = useState<"table" | "json">("table");
  const [dbFilter, setDbFilter] = useState("");
  const [dbPage, setDbPage] = useState(0);
  const [copiedRow, setCopiedRow] = useState<number | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [dbEditDialog, setDbEditDialog] = useState<{ rowId: number; text: string } | null>(null);
  const [isSavingDbEdit, setIsSavingDbEdit] = useState(false);
  const PAGE_SIZE = 25;

  const getWorkflowBadge = (workflow: AiWorkflow) => {
    if (workflow.status === "success") {
      return {
        label: "LLM Active",
        className: "border-emerald-500/30 text-emerald-400",
      };
    }
    if (workflow.status === "response_error") {
      return {
        label: "LLM Response Error",
        className: "border-amber-500/30 text-amber-400",
      };
    }
    return {
      label: "LLM Unavailable",
      className: "border-red-500/30 text-red-400",
    };
  };

  const loadTables = useCallback(async () => {
    try {
      const tables = await apiFetch<DbTable[]>("/db/tables");
      setDbTables(tables);
    } catch {
      // ignore
    }
  }, []);

  const loadTableData = useCallback(async (table: string, page: number = 0) => {
    setIsLoadingDb(true);
    try {
      const data = await apiFetch<DbBrowseResult>(
        `/db/${encodeURIComponent(table)}?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
      );
      setDbData(data);
    } catch {
      setDbData(null);
    } finally {
      setIsLoadingDb(false);
    }
  }, []);

  const loadScans = useCallback(async () => {
    setIsLoadingScans(true);
    try {
      const data = await apiFetch<InventoryScan[]>("/inventory");
      setScans(data);
    } catch {
      // silently fail
    } finally {
      setIsLoadingScans(false);
    }
  }, []);

  useEffect(() => {
    loadScans();
    loadTables();
  }, [loadScans, loadTables]);

  useEffect(() => {
    loadTableData(activeTable, dbPage);
  }, [activeTable, dbPage, loadTableData]);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 1280, height: 720 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (err) {
      alert(`Camera unavailable\n${err instanceof Error ? err.message : err}`);
    }
  }, []);

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const frameFile = new File([blob], `inventory-frame-${Date.now()}.jpg`, { type: "image/jpeg" });
      setSelectedImage(frameFile);
      setImagePreview(URL.createObjectURL(frameFile));
      setScanResult(null);
      setSaved(false);
    }, "image/jpeg", 0.92);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      setScanResult(null);
      setSaved(false);
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  }, []);

  const handleScan = async () => {
    if (!selectedImage) return;
    setIsScanning(true);
    setScanResult(null);

    setScanPhase("analyzing");
    try {
      const formData = new FormData();
      formData.append("file", selectedImage);
      formData.append("query", nlQuery);
      const result = await apiUpload<ScanResult>("/inventory/scan", formData);
      setScanResult(result);
    } catch (err) {
      console.error("Scan failed:", err);
    } finally {
      setIsScanning(false);
      setScanPhase("done");
    }
  };

  const buildDbItems = (result: ScanResult): Record<string, unknown>[] => {
    if (result.ai_analysis?.items?.length) {
      return result.ai_analysis.items.map((item, index) => ({
        id: index,
        label: item.name,
        confidence: item.confidence ?? 0.9,
        bbox: [],
        area: null,
        ocr_texts: item.evidence ? [item.evidence] : [],
        source: `vlm:${result.ai_workflow?.model ?? "inventory-vlm"}`,
        brand: item.brand,
        category: item.category,
        count: item.count,
        location: item.location,
        condition: item.condition,
        extraction_type: "catalog_item",
      }));
    }
    return result.segments.map((segment) => ({ ...segment }));
  };

  const handleSave = async () => {
    if (!scanResult) return;
    setIsSaving(true);
    try {
      const scanId = `scan_${Date.now()}`;
      const itemsToSave = buildDbItems(scanResult);
      await apiFetch("/inventory/save", {
        method: "POST",
        body: JSON.stringify({
          scan_id: scanId,
          items: itemsToSave,
          schema_columns: Array.from(new Set(itemsToSave.flatMap(Object.keys))),
          natural_language_query: nlQuery || null,
          item_count: scanResult.ai_analysis?.total_items ?? scanResult.total_segments,
        }),
      });
      setSaved(true);
      loadScans();
      loadTables();
      if (activeTable === "inventory_scans") loadTableData("inventory_scans", dbPage);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteScan = async (scanId: string) => {
    setIsDeleting(scanId);
    try {
      await apiFetch(`/inventory/${encodeURIComponent(scanId)}`, { method: "DELETE" });
      setScans((prev) => prev.filter((s) => s.scan_id !== scanId));
      if (expandedScan === scanId) setExpandedScan(null);
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setIsDeleting(null);
    }
  };

  const handleEditItem = async () => {
    if (!editDialog) return;
    setIsUpdating(true);
    try {
      await apiFetch(`/inventory/${encodeURIComponent(editDialog.scanId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          item_id: editDialog.itemId,
          updates: {
            label: editDialog.label,
            confidence: parseFloat(editDialog.confidence),
            source: editDialog.source,
          },
        }),
      });
      setEditDialog(null);
      loadScans();
    } catch (err) {
      console.error("Update failed:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const parseItems = (items: string): Segment[] => {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const handleCopyRow = (row: Record<string, unknown>, idx: number) => {
    navigator.clipboard.writeText(JSON.stringify(row, null, 2));
    setCopiedRow(idx);
    setTimeout(() => setCopiedRow(null), 1500);
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      await apiFetch("/db/clear-all", { method: "DELETE" });
      await loadTables();
      await loadTableData(activeTable, 0);
      setDbPage(0);
      loadScans();
    } catch (err) {
      alert(`Clear failed — is the backend running?\n${err instanceof Error ? err.message : err}`);
    } finally { setIsClearing(false); }
  };

  const handleSeedDemo = async () => {
    setIsSeeding(true);
    try {
      await apiFetch("/db/seed-demo", { method: "POST" });
      await loadTables();
      await loadTableData(activeTable, 0);
      setDbPage(0);
      loadScans();
    } catch (err) {
      alert(`Seed failed — is the backend running?\n${err instanceof Error ? err.message : err}`);
    } finally { setIsSeeding(false); }
  };

  const handleSaveDbEdit = async () => {
    if (!dbEditDialog) return;
    setIsSavingDbEdit(true);
    try {
      const parsed = JSON.parse(dbEditDialog.text) as Record<string, unknown>;
      await apiFetch(`/db/${encodeURIComponent(activeTable)}/${dbEditDialog.rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ updates: parsed }),
      });
      setDbEditDialog(null);
      await loadTables();
      await loadTableData(activeTable, dbPage);
      if (activeTable === "inventory_scans") {
        loadScans();
      }
    } catch (err) {
      alert(`Save edit failed\n${err instanceof Error ? err.message : err}`);
    } finally {
      setIsSavingDbEdit(false);
    }
  };

  const filteredScans = scans.filter((s) => {
    if (!dbFilter) return true;
    const q = dbFilter.toLowerCase();
    return (
      s.scan_id.toLowerCase().includes(q) ||
      (s.natural_language_query || "").toLowerCase().includes(q) ||
      s.items.toLowerCase().includes(q)
    );
  });

  const dbColumns = dbData?.rows?.[0] ? Object.keys(dbData.rows[0]) : [];
  const totalPages = dbData ? Math.ceil(dbData.total / PAGE_SIZE) : 0;

  const formatCellValue = (val: unknown): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "string" && val.length > 80) return val.slice(0, 80) + "…";
    return String(val);
  };

  const aiItems = scanResult?.ai_analysis?.items ?? [];
  const structuredItemCount = scanResult?.ai_analysis?.total_items ?? scanResult?.total_segments ?? 0;
  const uniqueLabels = scanResult ? Object.keys(scanResult.label_summary).length : 0;
  const ocrHits = scanResult?.segments.filter((seg) => seg.ocr_texts.length > 0).length ?? 0;
  const recognizedBrands = aiItems.filter((item) => item.brand && item.brand !== "unknown").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Inventory Scanner</h2>
        <p className="text-[13px] text-muted-foreground">
          Gemini Vision analysis — image in, AI extraction into database-ready catalog rows.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Upload & Query */}
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardContent className="p-5">
              {cameraActive ? (
                <div className="relative bg-black">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-80 object-contain" />
                  <div className="absolute top-2 right-2">
                    <Badge className="bg-red-500/80 text-white border-none gap-1 text-[10px]">
                      <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> LIVE
                    </Badge>
                  </div>
                </div>
              ) : imagePreview ? (
                <div className="relative group">
                  <img src={imagePreview} alt="Selected" className="w-full object-contain max-h-80" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                      <Upload className="h-3.5 w-3.5" /> Change Image
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="flex flex-col items-center justify-center border-2 border-dashed border-border p-12 cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="h-14 w-14 bg-primary/10 flex items-center justify-center mb-4">
                    <ImageIcon className="h-7 w-7 text-primary" />
                  </div>
                  <p className="text-sm font-medium">Drop an image or click to upload</p>
                  <p className="text-xs text-muted-foreground mt-1">Shelves, pallets, warehouses, or any scene</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex gap-2 mt-4">
                <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" /> Upload
                </Button>
                <Button variant={cameraActive ? "default" : "outline"} size="sm" className="gap-1.5 flex-1" onClick={cameraActive ? stopCamera : startCamera}>
                  <Video className="h-3.5 w-3.5" /> {cameraActive ? "Stop Live" : "Live Camera"}
                </Button>
                {cameraActive && (
                  <Button size="sm" className="gap-1.5 flex-1" onClick={captureFrame}>
                    <Camera className="h-3.5 w-3.5" /> Capture Frame
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Natural Language Query</h3>
                <Badge variant="outline" className="text-xs">Optional</Badge>
              </div>
              <Textarea
                placeholder='"Just count the chairs, ignore the people" or "Add columns for brand and condition"'
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
                className="resize-none h-20 bg-background"
              />
            </CardContent>
          </Card>

          {scanPhase === "analyzing" && (
            <div className="flex items-center gap-3 border border-border bg-card px-4 py-2.5">
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
              <span className="text-sm font-medium">Gemini extracting inventory…</span>
            </div>
          )}
          <Button className="w-full gap-2 h-11" size="lg" disabled={!selectedImage || isScanning} onClick={handleScan}>
            {isScanning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Gemini analyzing…</>
            ) : (
              <><ScanLine className="h-4 w-4" /> Scan & Analyze</>
            )}
          </Button>
        </div>

        {/* Right: Results */}
        <div className="space-y-4">
          {scanResult && (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <div className="border border-border bg-card px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Structured Units</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{structuredItemCount}</p>
              </div>
              <div className="border border-border bg-card px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Unique Labels</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{uniqueLabels}</p>
              </div>
              <div className="border border-border bg-card px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Brands Recognized</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{recognizedBrands}</p>
              </div>
              <div className="border border-border bg-card px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">OCR Hits</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{ocrHits}</p>
              </div>
            </div>
          )}

          {scanResult?.preview_b64 && (
            <Card className="border-border bg-card">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Analysis Preview</h3>
                  <Badge variant="outline" className="text-xs">{scanResult.segmentation_model ?? "gemini"}</Badge>
                </div>
                <img src={`data:image/jpeg;base64,${scanResult.preview_b64}`} alt="Analysis preview" className="w-full object-contain max-h-72" />
              </CardContent>
            </Card>
          )}

          {scanResult && (
            <>
              {/* AI Analysis — smart product identification */}
              {scanResult.ai_analysis && (
                <Card className="border-primary/30 bg-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold">AI Product Analysis</h3>
                        <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">
                          {scanResult.ai_workflow?.model ?? "Vision LLM"}
                        </Badge>
                      </div>
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                        {structuredItemCount} items
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">{scanResult.ai_analysis.summary}</p>
                    {scanResult.ai_analysis.query_answer && (
                      <div className="mb-3 px-3 py-2 bg-primary/5 border border-primary/20 text-xs">
                        <span className="font-semibold text-primary">Query Answer:</span>{" "}
                        <span className="text-foreground">{scanResult.ai_analysis.query_answer}</span>
                      </div>
                    )}
                    <ScrollArea className="h-52">
                      <div className="space-y-1">
                        {aiItems.map((item, i) => (
                          <div key={i} className="flex items-center justify-between bg-background px-3 py-2 text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium truncate">{item.name}</span>
                              {item.brand !== "unknown" && (
                                <Badge variant="outline" className="text-[10px] shrink-0">{item.brand}</Badge>
                              )}
                              <Badge variant="outline" className="text-[10px] shrink-0">{item.category}</Badge>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                              <span>{item.location}</span>
                              <span>{Math.round(item.confidence * 100)}%</span>
                              <span className="font-semibold text-foreground">×{item.count}</span>
                            </div>
                          </div>
                        ))}
                        {aiItems.length === 0 && (
                          <div className="flex items-center justify-center bg-background px-3 py-8 text-xs text-muted-foreground">
                            The model returned analysis metadata, but no structured items.
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                    {scanResult.ai_analysis.raw_output && (
                      <details className="border border-border bg-background px-3 py-3">
                        <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground select-none hover:text-foreground">
                          Raw Model Output
                        </summary>
                        <p className="mt-2 text-xs whitespace-pre-wrap wrap-break-word text-foreground/85">
                          {scanResult.ai_analysis.raw_output}
                        </p>
                      </details>
                    )}
                  </CardContent>
                </Card>
              )}

              {scanResult.ai_workflow && (
                <Card className="border-border bg-card">
                  <CardContent className="p-5 space-y-3">
                    {(() => {
                      const workflowBadge = getWorkflowBadge(scanResult.ai_workflow);
                      return (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-semibold">Extraction Workflow</h3>
                      </div>
                      <Badge variant="outline" className={workflowBadge.className}>
                        {workflowBadge.label}
                      </Badge>
                    </div>
                      );
                    })()}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="border border-border bg-background px-3 py-2">
                        <p className="text-muted-foreground">Provider</p>
                        <p className="mt-1 font-medium">{scanResult.ai_workflow.provider}</p>
                      </div>
                      <div className="border border-border bg-background px-3 py-2">
                        <p className="text-muted-foreground">Prompt Version</p>
                        <p className="mt-1 font-medium">{scanResult.ai_workflow.prompt_version}</p>
                      </div>
                      <div className="border border-border bg-background px-3 py-2">
                        <p className="text-muted-foreground">Image Strategy</p>
                        <p className="mt-1 font-medium">{scanResult.ai_workflow.image_strategy}</p>
                      </div>
                      <div className="border border-border bg-background px-3 py-2">
                        <p className="text-muted-foreground">Context Strategy</p>
                        <p className="mt-1 font-medium">{scanResult.ai_workflow.context_strategy}</p>
                      </div>
                    </div>
                    {scanResult.ai_workflow.candidate_labels && scanResult.ai_workflow.candidate_labels.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {scanResult.ai_workflow.candidate_labels.slice(0, 8).map((label) => (
                          <Badge key={label} variant="secondary" className="text-[10px]">{label}</Badge>
                        ))}
                      </div>
                    )}
                    {scanResult.ai_workflow.reason && (
                      <div className="border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                        {scanResult.ai_workflow.reason}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card className="border-border bg-card">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Object Detection</h3>
                      <Badge variant="outline" className="text-[10px]">Gemini</Badge>
                    </div>
                    <Badge className="bg-primary/20 text-primary border-primary/30">{scanResult.total_segments} detected</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {Object.entries(scanResult.label_summary).map(([label, count]) => (
                      <Badge key={label} variant="secondary" className="text-xs gap-1">
                        {label}<span className="font-bold ml-1">{count}</span>
                      </Badge>
                    ))}
                  </div>
                  <ScrollArea className="h-36">
                    <div className="space-y-1.5">
                      {scanResult.segments.slice(0, 20).map((seg) => (
                        <div key={seg.id} className="flex items-center justify-between bg-background px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{seg.label}</span>
                            {seg.ocr_texts.length > 0 && (
                              <span className="text-xs text-muted-foreground truncate max-w-32">{seg.ocr_texts.join(", ")}</span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">{(seg.confidence * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </>
          )}

          {scanResult && (
            <Button
              className="w-full gap-2 h-11"
              variant={saved ? "outline" : "default"}
              disabled={isSaving || saved}
              onClick={handleSave}
            >
              {isSaving ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
              ) : saved ? (
                <><Save className="h-4 w-4" /> Saved to Inventory</>
              ) : (
                <><Save className="h-4 w-4" /> Save to Inventory</>
              )}
            </Button>
          )}

          {!scanResult && !isScanning && (
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-border p-16">
              <ScanLine className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground text-center">
                Upload or capture an image and click Scan to see<br />Gemini analysis and extraction here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Multi-Table Database Browser ─── */}
      <div className="border border-border bg-card">
        {/* Browser Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Database Browser</h3>
            <Badge variant="outline" className="text-xs font-mono">{dbTables.length} tables</Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex border border-border">
              <button
                onClick={() => setDbViewMode("table")}
                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] transition-colors ${
                  dbViewMode === "table" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <TableProperties className="h-3 w-3" /> Table
              </button>
              <button
                onClick={() => setDbViewMode("json")}
                className={`flex items-center gap-1 px-2.5 py-1 text-[11px] border-l border-border transition-colors ${
                  dbViewMode === "json" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Braces className="h-3 w-3" /> JSON
              </button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => { loadTables(); loadTableData(activeTable, dbPage); }}
              disabled={isLoadingDb}
            >
              <RefreshCw className={`h-3 w-3 ${isLoadingDb ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-400"
              onClick={handleSeedDemo}
              disabled={isSeeding}
            >
              {isSeeding ? <Loader2 className="h-3 w-3 animate-spin" /> : <DatabaseZap className="h-3 w-3" />} Seed Demo
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400"
              onClick={handleClearAll}
              disabled={isClearing}
            >
              {isClearing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash className="h-3 w-3" />} Clear All
            </Button>
          </div>
        </div>

        <div className="flex">
          {/* Table Sidebar */}
          <div className="w-52 border-r border-border shrink-0">
            <div className="px-3 py-2 border-b border-border">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tables</span>
            </div>
            <div className="py-1">
              {dbTables.map((t) => (
                <button
                  key={t.name}
                  onClick={() => { setActiveTable(t.name); setDbPage(0); }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors ${
                    activeTable === t.name
                      ? "bg-primary/10 text-primary border-r-2 border-primary"
                      : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                  }`}
                >
                  <span className="font-mono truncate">{t.name}</span>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0 ml-2">{t.count}</Badge>
                </button>
              ))}
            </div>
          </div>

          {/* Table Content */}
          <div className="flex-1 min-w-0">
            {isLoadingDb && !dbData ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading…</span>
              </div>
            ) : dbData && dbData.rows.length > 0 ? (
              <>
                {dbViewMode === "table" ? (
                  <ScrollArea className="h-105">
                    <div className="min-w-max">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent border-border">
                            {dbColumns.map((col) => (
                              <TableHead key={col} className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap px-3">
                                {col}
                              </TableHead>
                            ))}
                            <TableHead className="text-[10px] font-semibold text-muted-foreground w-8"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dbData.rows.map((row, ri) => (
                            <TableRow key={ri} className="border-border hover:bg-[#1f1f26]">
                              {dbColumns.map((col) => (
                                <TableCell key={col} className="text-xs px-3 py-2 max-w-64 truncate font-mono">
                                  {formatCellValue(row[col])}
                                </TableCell>
                              ))}
                              <TableCell className="px-2">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setDbEditDialog({ rowId: Number(row.id), text: JSON.stringify(row, null, 2) })}
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                    title="Edit row"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => handleCopyRow(row, ri)}
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                    title="Copy row as JSON"
                                  >
                                    {copiedRow === ri ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </ScrollArea>
                ) : (
                  <ScrollArea className="h-105">
                    <pre className="p-4 text-xs font-mono text-muted-foreground leading-relaxed">
                      <code>{JSON.stringify(dbData.rows, null, 2)}</code>
                    </pre>
                  </ScrollArea>
                )}

                {/* Pagination */}
                <div className="flex items-center justify-between px-4 py-2 border-t border-border">
                  <span className="text-[11px] text-muted-foreground">
                    Showing {dbPage * PAGE_SIZE + 1}–{Math.min((dbPage + 1) * PAGE_SIZE, dbData.total)} of {dbData.total} rows
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setDbPage(0)} disabled={dbPage === 0}>
                      <ChevronsLeft className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setDbPage((p) => Math.max(0, p - 1))} disabled={dbPage === 0}>
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <span className="text-[11px] text-muted-foreground px-2 tabular-nums">
                      Page {dbPage + 1} of {totalPages}
                    </span>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setDbPage((p) => p + 1)} disabled={dbPage >= totalPages - 1}>
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setDbPage(totalPages - 1)} disabled={dbPage >= totalPages - 1}>
                      <ChevronsRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-20">
                <Database className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No data in {activeTable}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Inventory Scans (Expandable) ─── */}
      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Saved Scans</h3>
              <Badge variant="outline" className="text-xs font-mono">
                {scans.length} scan{scans.length !== 1 ? "s" : ""}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Filter scans..."
                  value={dbFilter}
                  onChange={(e) => setDbFilter(e.target.value)}
                  className="h-8 w-52 pl-8 text-xs bg-background"
                />
                {dbFilter && (
                  <button
                    onClick={() => setDbFilter("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={loadScans} disabled={isLoadingScans}>
                <RefreshCw className={`h-3 w-3 ${isLoadingScans ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </div>

          {isLoadingScans && scans.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading scans…</span>
            </div>
          ) : filteredScans.length === 0 ? (
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-border py-12">
              <Database className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                {dbFilter ? "No scans match your filter" : "No saved scans yet — scan an image and save it"}
              </p>
            </div>
          ) : (
            <div className="border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground">SCAN ID</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground">ITEMS</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground">QUERY</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground">CREATED</TableHead>
                    <TableHead className="text-xs font-semibold text-muted-foreground w-20">ACTIONS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredScans.map((scan) => {
                    const isExpanded = expandedScan === scan.scan_id;
                    const items = parseItems(scan.items);
                    return (
                      <Fragment key={scan.scan_id}>
                        <TableRow
                          className="cursor-pointer border-border hover:bg-[#1f1f26]"
                          onClick={() => setExpandedScan(isExpanded ? null : scan.scan_id)}
                        >
                          <TableCell className="w-8 text-muted-foreground">
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{scan.scan_id}</TableCell>
                          <TableCell><Badge variant="secondary" className="text-xs">{scan.item_count}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-48 truncate">{scan.natural_language_query || "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(scan.created_at).toLocaleString()}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
                              onClick={(e) => { e.stopPropagation(); handleDeleteScan(scan.scan_id); }}
                              disabled={isDeleting === scan.scan_id}
                            >
                              {isDeleting === scan.scan_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                          </TableCell>
                        </TableRow>

                        {isExpanded && items.length > 0 && (
                          <TableRow className="hover:bg-transparent border-border">
                            <TableCell colSpan={6} className="p-0">
                              <div className="bg-background border-y border-border">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="hover:bg-transparent border-border">
                                      <TableHead className="text-[11px] font-semibold text-muted-foreground pl-10">ID</TableHead>
                                      <TableHead className="text-[11px] font-semibold text-muted-foreground">LABEL</TableHead>
                                      <TableHead className="text-[11px] font-semibold text-muted-foreground">CONFIDENCE</TableHead>
                                      <TableHead className="text-[11px] font-semibold text-muted-foreground">AREA</TableHead>
                                      <TableHead className="text-[11px] font-semibold text-muted-foreground">OCR TEXT</TableHead>
                                      <TableHead className="text-[11px] font-semibold text-muted-foreground">SOURCE</TableHead>
                                      <TableHead className="text-[11px] font-semibold text-muted-foreground w-12">EDIT</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {items.map((item) => (
                                      <TableRow key={item.id} className="border-border hover:bg-[#1f1f26]">
                                        <TableCell className="text-xs font-mono pl-10">{item.id}</TableCell>
                                        <TableCell className="text-xs font-medium">{item.label}</TableCell>
                                        <TableCell>
                                          <div className="flex items-center gap-2">
                                            <div className="h-1.5 w-16 bg-[#2a2a32]">
                                              <div className="h-full bg-primary" style={{ width: `${(item.confidence * 100).toFixed(0)}%` }} />
                                            </div>
                                            <span className="text-xs text-muted-foreground">{(item.confidence * 100).toFixed(1)}%</span>
                                          </div>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">{item.area?.toLocaleString() ?? "—"}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground max-w-32 truncate">{item.ocr_texts?.length > 0 ? item.ocr_texts.join(", ") : "—"}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">{item.source ?? "—"}</TableCell>
                                        <TableCell>
                                          <Button
                                            variant="ghost" size="sm"
                                            className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditDialog({ scanId: scan.scan_id, itemId: item.id, label: item.label, confidence: String(item.confidence), source: item.source || "" });
                                            }}
                                          >
                                            <Pencil className="h-3 w-3" />
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}

                        {isExpanded && items.length === 0 && (
                          <TableRow className="hover:bg-transparent border-border">
                            <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">
                              No item data available for this scan.
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Database Row Edit Dialog */}
      <Dialog open={!!dbEditDialog} onOpenChange={(open) => !open && setDbEditDialog(null)}>
        <DialogContent className="bg-card border-border max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">
              Edit {activeTable} row #{dbEditDialog?.rowId}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Edit the JSON for this row. The backend ignores the <span className="font-mono">id</span> field and only updates editable columns.
            </p>
            <Textarea
              value={dbEditDialog?.text ?? ""}
              onChange={(e) => setDbEditDialog((prev) => prev ? { ...prev, text: e.target.value } : null)}
              className="min-h-80 bg-background font-mono text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDbEditDialog(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveDbEdit} disabled={isSavingDbEdit}>
              {isSavingDbEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Row
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Item Dialog */}
      <Dialog open={!!editDialog} onOpenChange={(open) => !open && setEditDialog(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Edit Item #{editDialog?.itemId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Label</label>
              <Input
                value={editDialog?.label ?? ""}
                onChange={(e) => setEditDialog((prev) => prev ? { ...prev, label: e.target.value } : null)}
                className="bg-background"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Confidence (0–1)</label>
              <Input
                value={editDialog?.confidence ?? ""}
                onChange={(e) => setEditDialog((prev) => prev ? { ...prev, confidence: e.target.value } : null)}
                className="bg-background" type="number" step="0.01" min="0" max="1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Source</label>
              <Input
                value={editDialog?.source ?? ""}
                onChange={(e) => setEditDialog((prev) => prev ? { ...prev, source: e.target.value } : null)}
                className="bg-background"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditDialog(null)}>Cancel</Button>
            <Button size="sm" onClick={handleEditItem} disabled={isUpdating} className="gap-1.5">
              {isUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
