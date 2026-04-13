"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUpDown,
  Clock,
  IndianRupee,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ShieldAlert,
  Truck,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";

const DeliveryRoutePlannerMap = dynamic(
  () => import("@/components/dashboard/DeliveryRoutePlannerMap").then((mod) => mod.DeliveryRoutePlannerMap),
  {
    ssr: false,
    loading: () => <div className="h-105 w-full bg-card/50 animate-pulse" />,
  },
);

interface DbBrowseResult<T> {
  rows: T[];
  total: number;
}

interface RouteRiskRow {
  id: number;
  route: string;
  distance_km: number;
  base_duration_mins: number;
  congestion_pct: number;
  predicted_delay_mins: number;
  risk_level: string;
  suggested_alternate: string | null;
  reasons: string;
  weather: string;
  origin_name?: string | null;
  origin_lat?: number | null;
  origin_lng?: number | null;
  destination_name?: string | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
  route_geometry?: string | null;
  created_at: string;
}

interface DeliveryRow {
  id: number;
  delivery_id: string;
  customer_name: string;
  address: string;
  time_slot: string;
  order_value: number;
  risk_score: number;
  risk_level: string;
  status: string;
  created_at: string;
}

interface AgentEvent {
  id: number;
  agent_name: string;
  event_type: string;
  payload: string;
  severity: string;
  human_decision: string | null;
  created_at: string;
}

interface LocationOption {
  label: string;
  address: string;
  lat: number;
  lng: number;
  source?: string;
}

interface RoutePreview {
  route: string;
  origin_name: string;
  origin_lat: number;
  origin_lng: number;
  destination_name: string;
  destination_lat: number;
  destination_lng: number;
  route_geometry: [number, number][];
  distance_km: number;
  base_duration_mins: number;
  congestion_pct: number;
  predicted_delay_mins: number;
  risk_level: string;
  suggested_alternate: string | null;
  reasons: string;
  weather: string;
}

interface PlannerForm {
  customer_name: string;
  address: string;
  pincode: string;
  time_slot: string;
  order_value: string;
}

interface RouteForm {
  route: string;
  distance_km: string;
  base_duration_mins: string;
  congestion_pct: string;
  predicted_delay_mins: string;
  risk_level: string;
  suggested_alternate: string;
  reasons: string;
  weather: string;
}

const emptyForm: RouteForm = {
  route: "",
  distance_km: "",
  base_duration_mins: "",
  congestion_pct: "",
  predicted_delay_mins: "",
  risk_level: "low",
  suggested_alternate: "",
  reasons: "",
  weather: "",
};

const emptyPlannerForm: PlannerForm = {
  customer_name: "",
  address: "",
  pincode: "",
  time_slot: "09:00-12:00",
  order_value: "",
};

function riskBadge(level: string) {
  const normalized = level.toLowerCase();
  if (normalized === "critical") return <Badge className="bg-red-500/20 text-red-400">Critical</Badge>;
  if (normalized === "high") return <Badge className="bg-amber-500/20 text-amber-400">High</Badge>;
  if (normalized === "medium" || normalized === "moderate") return <Badge className="bg-yellow-500/20 text-yellow-300">Moderate</Badge>;
  return <Badge className="bg-emerald-500/20 text-emerald-400">Low</Badge>;
}

function routeRiskScore(route: RouteRiskRow): number {
  const levelBoost = route.risk_level.toLowerCase() === "critical" ? 30 : route.risk_level.toLowerCase() === "high" ? 18 : route.risk_level.toLowerCase() === "medium" ? 10 : 0;
  return Math.min(100, Math.round(route.congestion_pct + route.predicted_delay_mins + levelBoost));
}

function predictedDelayFromMetrics(baseDurationMins: number, congestionPct: number): number {
  return Math.round(baseDurationMins * (congestionPct / 100) * 0.38);
}

function riskLevelFromDelay(delayMinutes: number): string {
  if (delayMinutes >= 60) return "critical";
  if (delayMinutes >= 35) return "high";
  if (delayMinutes >= 18) return "medium";
  return "low";
}

function parsePayload(payload: string): Record<string, unknown> | null {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseRouteGeometry(routeGeometry?: string | null): [number, number][] {
  if (!routeGeometry) return [];
  try {
    const parsed = JSON.parse(routeGeometry) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((point): point is [number, number] => Array.isArray(point) && point.length >= 2)
      .map((point) => [Number(point[0]), Number(point[1])]);
  } catch {
    return [];
  }
}

export default function LastMilePage() {
  const [routes, setRoutes] = useState<RouteRiskRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshingLive, setIsRefreshingLive] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  // Dialog state
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editRouteId, setEditRouteId] = useState<number | null>(null);
  const [form, setForm] = useState<RouteForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [dialogFeedback, setDialogFeedback] = useState<string | null>(null);

  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [originResults, setOriginResults] = useState<LocationOption[]>([]);
  const [destinationResults, setDestinationResults] = useState<LocationOption[]>([]);
  const [selectedOrigin, setSelectedOrigin] = useState<LocationOption | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<LocationOption | null>(null);
  const [searchingOrigin, setSearchingOrigin] = useState(false);
  const [searchingDestination, setSearchingDestination] = useState(false);
  const [routePreview, setRoutePreview] = useState<RoutePreview | null>(null);
  const [plannerForm, setPlannerForm] = useState<PlannerForm>(emptyPlannerForm);
  const [isPreviewingRoute, setIsPreviewingRoute] = useState(false);
  const [isCreatingRoute, setIsCreatingRoute] = useState(false);
  const [plannerFeedback, setPlannerFeedback] = useState<string | null>(null);
  const [dialogOriginQuery, setDialogOriginQuery] = useState("");
  const [dialogDestinationQuery, setDialogDestinationQuery] = useState("");
  const [dialogOriginResults, setDialogOriginResults] = useState<LocationOption[]>([]);
  const [dialogDestinationResults, setDialogDestinationResults] = useState<LocationOption[]>([]);
  const [dialogSelectedOrigin, setDialogSelectedOrigin] = useState<LocationOption | null>(null);
  const [dialogSelectedDestination, setDialogSelectedDestination] = useState<LocationOption | null>(null);
  const [dialogSearchingOrigin, setDialogSearchingOrigin] = useState(false);
  const [dialogSearchingDestination, setDialogSearchingDestination] = useState(false);
  const [dialogRoutePreview, setDialogRoutePreview] = useState<RoutePreview | null>(null);
  const [isAutoFillingDialog, setIsAutoFillingDialog] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [routeRes, deliveryRes, eventRes] = await Promise.all([
        apiFetch<DbBrowseResult<RouteRiskRow>>("/db/route_risks?limit=25&offset=0"),
        apiFetch<DbBrowseResult<DeliveryRow>>("/db/deliveries?limit=25&offset=0"),
        apiFetch<AgentEvent[]>("/events/all"),
      ]);
      setRoutes(routeRes.rows);
      setDeliveries(deliveryRes.rows);
      setEvents(eventRes);
    } catch {
      setRoutes([]);
      setDeliveries([]);
      setEvents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const query = originQuery.trim();
    if (query.length < 2 || selectedOrigin?.label === query) {
      setOriginResults([]);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setSearchingOrigin(true);
      try {
        const results = await apiFetch<LocationOption[]>(`/locations/search?q=${encodeURIComponent(query)}&limit=5`);
        setOriginResults(results);
      } catch {
        setOriginResults([]);
      } finally {
        setSearchingOrigin(false);
      }
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [originQuery, selectedOrigin]);

  useEffect(() => {
    const query = destinationQuery.trim();
    if (query.length < 2 || selectedDestination?.label === query) {
      setDestinationResults([]);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setSearchingDestination(true);
      try {
        const results = await apiFetch<LocationOption[]>(`/locations/search?q=${encodeURIComponent(query)}&limit=5`);
        setDestinationResults(results);
      } catch {
        setDestinationResults([]);
      } finally {
        setSearchingDestination(false);
      }
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [destinationQuery, selectedDestination]);

  useEffect(() => {
    const query = dialogOriginQuery.trim();
    if (dialogMode !== "add" || query.length < 2 || dialogSelectedOrigin?.label === query) {
      setDialogOriginResults([]);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setDialogSearchingOrigin(true);
      try {
        const results = await apiFetch<LocationOption[]>(`/locations/search?q=${encodeURIComponent(query)}&limit=5`);
        setDialogOriginResults(results);
      } catch {
        setDialogOriginResults([]);
      } finally {
        setDialogSearchingOrigin(false);
      }
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [dialogMode, dialogOriginQuery, dialogSelectedOrigin]);

  useEffect(() => {
    const query = dialogDestinationQuery.trim();
    if (dialogMode !== "add" || query.length < 2 || dialogSelectedDestination?.label === query) {
      setDialogDestinationResults([]);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setDialogSearchingDestination(true);
      try {
        const results = await apiFetch<LocationOption[]>(`/locations/search?q=${encodeURIComponent(query)}&limit=5`);
        setDialogDestinationResults(results);
      } catch {
        setDialogDestinationResults([]);
      } finally {
        setDialogSearchingDestination(false);
      }
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [dialogMode, dialogDestinationQuery, dialogSelectedDestination]);

  const refreshLiveRoutes = useCallback(async () => {
    setIsRefreshingLive(true);
    try {
      await apiFetch("/routes/refresh-live", { method: "POST" });
      await load();
    } catch (err) {
      alert(`Live route refresh failed\n${err instanceof Error ? err.message : err}`);
    } finally {
      setIsRefreshingLive(false);
    }
  }, [load]);

  const sortedRoutes = useMemo(() => {
    const rows = [...routes];
    rows.sort((a, b) => sortAsc ? routeRiskScore(a) - routeRiskScore(b) : routeRiskScore(b) - routeRiskScore(a));
    return rows;
  }, [routes, sortAsc]);

  const openAddDialog = () => {
    setDialogMode("add");
    setEditRouteId(null);
    setForm(emptyForm);
    setDialogFeedback(null);
    setDialogOriginQuery("");
    setDialogDestinationQuery("");
    setDialogOriginResults([]);
    setDialogDestinationResults([]);
    setDialogSelectedOrigin(null);
    setDialogSelectedDestination(null);
    setDialogRoutePreview(null);
  };

  const openEditDialog = (route: RouteRiskRow) => {
    setDialogMode("edit");
    setEditRouteId(route.id);
    setForm({
      route: route.route,
      distance_km: String(route.distance_km),
      base_duration_mins: String(route.base_duration_mins),
      congestion_pct: String(route.congestion_pct),
      predicted_delay_mins: String(route.predicted_delay_mins),
      risk_level: route.risk_level,
      suggested_alternate: route.suggested_alternate || "",
      reasons: route.reasons || "",
      weather: route.weather || "",
    });
    setDialogFeedback(null);
    setDialogOriginQuery("");
    setDialogDestinationQuery("");
    setDialogOriginResults([]);
    setDialogDestinationResults([]);
    setDialogSelectedOrigin(null);
    setDialogSelectedDestination(null);
    setDialogRoutePreview(null);
  };

  const closeDialog = () => {
    setDialogMode(null);
    setEditRouteId(null);
    setDialogFeedback(null);
    setDialogOriginQuery("");
    setDialogDestinationQuery("");
    setDialogOriginResults([]);
    setDialogDestinationResults([]);
    setDialogSelectedOrigin(null);
    setDialogSelectedDestination(null);
    setDialogRoutePreview(null);
  };

  const selectOrigin = (option: LocationOption) => {
    setSelectedOrigin(option);
    setOriginQuery(option.label);
    setOriginResults([]);
    setRoutePreview(null);
    setPlannerFeedback(null);
  };

  const selectDestination = (option: LocationOption) => {
    setSelectedDestination(option);
    setDestinationQuery(option.label);
    setDestinationResults([]);
    setPlannerForm((current) => ({
      ...current,
      address: current.address || option.address || option.label,
    }));
    setRoutePreview(null);
    setPlannerFeedback(null);
  };

  const selectDialogOrigin = (option: LocationOption) => {
    setDialogSelectedOrigin(option);
    setDialogOriginQuery(option.label);
    setDialogOriginResults([]);
    setDialogRoutePreview(null);
    setDialogFeedback(null);
    setForm((current) => ({
      ...current,
      route: dialogSelectedDestination ? `${option.label} → ${dialogSelectedDestination.label}` : current.route,
    }));
  };

  const selectDialogDestination = (option: LocationOption) => {
    setDialogSelectedDestination(option);
    setDialogDestinationQuery(option.label);
    setDialogDestinationResults([]);
    setDialogRoutePreview(null);
    setDialogFeedback(null);
    setForm((current) => ({
      ...current,
      route: dialogSelectedOrigin ? `${dialogSelectedOrigin.label} → ${option.label}` : current.route,
    }));
  };

  const previewRoute = useCallback(async () => {
    if (!selectedOrigin || !selectedDestination) {
      setPlannerFeedback("Pick both origin and destination from search results first.");
      return;
    }
    setIsPreviewingRoute(true);
    setPlannerFeedback(null);
    try {
      const preview = await apiFetch<RoutePreview>("/routes/preview", {
        method: "POST",
        body: JSON.stringify({
          origin: selectedOrigin,
          destination: selectedDestination,
        }),
      });
      setRoutePreview(preview);
    } catch (err) {
      setPlannerFeedback(`Preview failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setIsPreviewingRoute(false);
    }
  }, [selectedDestination, selectedOrigin]);

  const savePlannedRoute = useCallback(async () => {
    if (!selectedOrigin || !selectedDestination || !routePreview) {
      setPlannerFeedback("Preview the route before saving it to the database.");
      return;
    }
    if (!plannerForm.customer_name.trim()) {
      setPlannerFeedback("Customer name is required for a delivery route.");
      return;
    }
    if (!plannerForm.address.trim()) {
      setPlannerFeedback("Delivery address is required.");
      return;
    }

    setIsCreatingRoute(true);
    setPlannerFeedback(null);
    try {
      await apiFetch("/routes/create-delivery", {
        method: "POST",
        body: JSON.stringify({
          origin: selectedOrigin,
          destination: selectedDestination,
          customer_name: plannerForm.customer_name.trim(),
          address: plannerForm.address.trim(),
          pincode: plannerForm.pincode.trim() || null,
          time_slot: plannerForm.time_slot.trim() || "09:00-12:00",
          order_value: Number(plannerForm.order_value) || 0,
        }),
      });
      await load();
      setPlannerFeedback("Delivery route saved. It will now show up in the route table and map views.");
      setPlannerForm(emptyPlannerForm);
      setOriginResults([]);
      setDestinationResults([]);
    } catch (err) {
      setPlannerFeedback(`Save failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setIsCreatingRoute(false);
    }
  }, [load, plannerForm, routePreview, selectedDestination, selectedOrigin]);

  const autofillDialogRoute = useCallback(async () => {
    if (!dialogSelectedOrigin || !dialogSelectedDestination) {
      setDialogFeedback("Choose both origin and destination from search results first.");
      return;
    }

    setIsAutoFillingDialog(true);
    setDialogFeedback(null);
    try {
      const preview = await apiFetch<RoutePreview>("/routes/preview", {
        method: "POST",
        body: JSON.stringify({
          origin: dialogSelectedOrigin,
          destination: dialogSelectedDestination,
        }),
      });

      setDialogRoutePreview(preview);
      setForm((current) => ({
        ...current,
        route: preview.route,
        distance_km: String(preview.distance_km),
        base_duration_mins: String(preview.base_duration_mins),
        congestion_pct: String(Math.round(preview.congestion_pct)),
        predicted_delay_mins: String(preview.predicted_delay_mins),
        risk_level: preview.risk_level,
        suggested_alternate: preview.suggested_alternate || "",
        reasons: preview.reasons || "",
        weather: preview.weather || current.weather,
      }));
      setDialogFeedback("Route metrics auto-filled. Congestion is still editable.");
    } catch (err) {
      setDialogFeedback(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setIsAutoFillingDialog(false);
    }
  }, [dialogSelectedDestination, dialogSelectedOrigin]);

  const handleSave = useCallback(async () => {
    if (dialogMode === "add" && (!dialogSelectedOrigin || !dialogSelectedDestination)) {
      setDialogFeedback("Pick origin and destination first.");
      return;
    }
    if (dialogMode === "add" && !dialogRoutePreview) {
      setDialogFeedback("Use Auto-Fill before saving a new route.");
      return;
    }
    if (!form.route.trim()) { setDialogFeedback("Route name is required"); return; }
    setIsSaving(true);
    setDialogFeedback(null);
    const payload = {
      route: form.route.trim(),
      distance_km: Number(form.distance_km) || 0,
      base_duration_mins: Number(form.base_duration_mins) || 0,
      congestion_pct: Number(form.congestion_pct) || 0,
      predicted_delay_mins: Number(form.predicted_delay_mins) || 0,
      risk_level: form.risk_level || "low",
      suggested_alternate: form.suggested_alternate.trim() || null,
      reasons: form.reasons.trim(),
      weather: form.weather.trim(),
      created_at: new Date().toISOString(),
      ...(dialogMode === "add" && dialogRoutePreview
        ? {
            origin_name: dialogRoutePreview.origin_name,
            origin_lat: dialogRoutePreview.origin_lat,
            origin_lng: dialogRoutePreview.origin_lng,
            destination_name: dialogRoutePreview.destination_name,
            destination_lat: dialogRoutePreview.destination_lat,
            destination_lng: dialogRoutePreview.destination_lng,
            route_geometry: dialogRoutePreview.route_geometry,
          }
        : {}),
    };
    try {
      if (dialogMode === "add") {
        const res = await apiFetch<{ status: string; row: RouteRiskRow }>("/db/route_risks/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: payload }),
        });
        if (res.row) setRoutes((prev) => [res.row, ...prev]);
      } else if (editRouteId !== null) {
        const res = await apiFetch<{ status: string; row: RouteRiskRow }>(`/db/route_risks/${editRouteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: payload }),
        });
        if (res.row) {
          setRoutes((prev) => prev.map((r) => r.id === editRouteId ? res.row : r));
        }
      }
      setDialogFeedback("Saved");
      setTimeout(closeDialog, 600);
    } catch (err) {
      setDialogFeedback(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setIsSaving(false);
    }
  }, [dialogMode, dialogRoutePreview, dialogSelectedDestination, dialogSelectedOrigin, editRouteId, form]);

  const handleDelete = useCallback(async (id: number) => {
    try {
      await apiFetch(`/db/route_risks/${id}`, { method: "DELETE" });
      setRoutes((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : err}`);
    }
  }, []);

  const highRiskDeliveries = useMemo(
    () => deliveries.filter((delivery) => ["high", "critical"].includes(delivery.risk_level.toLowerCase())).sort((a, b) => b.risk_score - a.risk_score),
    [deliveries],
  );

  const pendingEvents = useMemo(
    () => events.filter((event) => ["route_agent", "lastmile_agent"].includes(event.agent_name) && !event.human_decision),
    [events],
  );

  const avgDelay = routes.length > 0 ? Math.round(routes.reduce((sum, route) => sum + route.predicted_delay_mins, 0) / routes.length) : 0;
  const criticalRoutes = routes.filter((route) => ["high", "critical"].includes(route.risk_level.toLowerCase())).length;
  const atRiskOrderValue = highRiskDeliveries.reduce((sum, delivery) => sum + delivery.order_value, 0);
  const mapRoutes = useMemo(
    () => routes.map((route) => ({
      id: route.id,
      label: route.route,
      geometry: parseRouteGeometry(route.route_geometry),
      riskLevel: route.risk_level,
    })).filter((route) => route.geometry.length > 1),
    [routes],
  );

  const updateForm = (key: keyof RouteForm, value: string) => setForm((current) => {
    const next = { ...current, [key]: value };

    if (dialogMode === "add" && (key === "congestion_pct" || key === "base_duration_mins")) {
      const baseDuration = Number(key === "base_duration_mins" ? value : next.base_duration_mins) || 0;
      const congestionPct = Math.max(0, Math.min(100, Number(key === "congestion_pct" ? value : next.congestion_pct) || 0));
      const predictedDelayMins = predictedDelayFromMetrics(baseDuration, congestionPct);
      next.predicted_delay_mins = String(predictedDelayMins);
      next.risk_level = riskLevelFromDelay(predictedDelayMins);

      if (dialogSelectedOrigin && dialogSelectedDestination) {
        next.reasons = `${dialogSelectedOrigin.label} to ${dialogSelectedDestination.label} is running at ${Math.round(congestionPct)}% estimated congestion with ${predictedDelayMins} min projected delay. Source: manual congestion override.`;
      }
    }

    return next;
  });
  const updatePlannerForm = (key: keyof PlannerForm, value: string) => setPlannerForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Last-Mile Risk</h2>
          <p className="text-[13px] text-muted-foreground">
            Live route pressure, order exposure, and agent recommendations.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" onClick={openAddDialog}>
            <Plus className="h-4 w-4" />
            Add Route
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={refreshLiveRoutes} disabled={isRefreshingLive}>
            {isRefreshingLive ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
            Refresh Live Intel
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
        <Card className="border-border bg-card">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Delivery Route Planner</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Search real locations, preview the corridor on the map, then save the route and linked delivery to the database in one step.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <LocationSearchField
                label="Origin"
                placeholder="Search pickup city or warehouse"
                query={originQuery}
                selected={selectedOrigin}
                loading={searchingOrigin}
                results={originResults}
                onQueryChange={(value) => {
                  setSelectedOrigin(null);
                  setOriginQuery(value);
                  setRoutePreview(null);
                }}
                onSelect={selectOrigin}
              />
              <LocationSearchField
                label="Destination"
                placeholder="Search delivery city or address"
                query={destinationQuery}
                selected={selectedDestination}
                loading={searchingDestination}
                results={destinationResults}
                onQueryChange={(value) => {
                  setSelectedDestination(null);
                  setDestinationQuery(value);
                  setRoutePreview(null);
                }}
                onSelect={selectDestination}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Customer Name</label>
                <Input value={plannerForm.customer_name} onChange={(e) => updatePlannerForm("customer_name", e.target.value)} placeholder="FleetLabs retail partner" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Time Slot</label>
                <Input value={plannerForm.time_slot} onChange={(e) => updatePlannerForm("time_slot", e.target.value)} placeholder="09:00-12:00" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Delivery Address</label>
                <Input value={plannerForm.address} onChange={(e) => updatePlannerForm("address", e.target.value)} placeholder="Customer warehouse or drop point" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Pincode</label>
                <Input value={plannerForm.pincode} onChange={(e) => updatePlannerForm("pincode", e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Order Value (INR)</label>
                <Input type="number" min={0} value={plannerForm.order_value} onChange={(e) => updatePlannerForm("order_value", e.target.value)} placeholder="125000" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button className="gap-1.5" onClick={previewRoute} disabled={isPreviewingRoute}>
                {isPreviewingRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Preview Route
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={savePlannedRoute} disabled={!routePreview || isCreatingRoute}>
                {isCreatingRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Add Delivery Route
              </Button>
            </div>

            {plannerFeedback && (
              <p className={`text-xs font-medium ${plannerFeedback.toLowerCase().includes("failed") ? "text-red-400" : "text-emerald-400"}`}>
                {plannerFeedback}
              </p>
            )}

            {routePreview && (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <div className="border border-border bg-background px-3 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Distance</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{routePreview.distance_km} km</p>
                </div>
                <div className="border border-border bg-background px-3 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Base ETA</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{routePreview.base_duration_mins} min</p>
                </div>
                <div className="border border-border bg-background px-3 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Projected Delay</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-amber-400">{routePreview.predicted_delay_mins} min</p>
                </div>
                <div className="border border-border bg-background px-3 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Risk</p>
                  <div className="mt-1">{riskBadge(routePreview.risk_level)}</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card overflow-hidden">
          <CardContent className="p-0">
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Route Map Preview</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Existing saved routes are shown faintly. The active preview route is highlighted.
                  </p>
                </div>
                {routePreview && <Badge variant="outline">{routePreview.weather}</Badge>}
              </div>
            </div>
            <div className="h-105">
              <DeliveryRoutePlannerMap
                origin={selectedOrigin}
                destination={selectedDestination}
                routeGeometry={routePreview?.route_geometry ?? []}
                existingRoutes={mapRoutes}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="border border-border bg-card px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Routes Monitored</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{routes.length}</p>
        </div>
        <div className="border border-border bg-card px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Critical Routes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-400">{criticalRoutes}</p>
        </div>
        <div className="border border-border bg-card px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Average Delay</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{avgDelay} min</p>
        </div>
        <div className="border border-border bg-card px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">At-Risk Order Value</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-red-400">₹{atRiskOrderValue.toLocaleString()}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr,0.65fr]">
        <Card className="border-border bg-card">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-16">Risk</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Weather</TableHead>
                  <TableHead className="text-right">Delay</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => setSortAsc(!sortAsc)}>
                    <span className="inline-flex items-center gap-1">
                      Score <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRoutes.map((route) => (
                  <TableRow key={route.id} className="hover:bg-muted/5">
                    <TableCell>{riskBadge(route.risk_level)}</TableCell>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                        <div>
                          <p className="text-sm font-medium">{route.route}</p>
                          <p className="text-xs text-muted-foreground">{route.distance_km} km · {route.base_duration_mins} min base · congestion {route.congestion_pct}%</p>
                          {route.suggested_alternate && (
                            <p className="text-xs text-primary mt-1">Alt: {route.suggested_alternate}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{route.weather}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{route.predicted_delay_mins} min</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{routeRiskScore(route)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-0.5 justify-end">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary" onClick={() => openEditDialog(route)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400" onClick={() => handleDelete(route.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {sortedRoutes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      No routes. Click &quot;Add Route&quot; to create one.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Exposure Snapshot</h3>
              </div>
              {highRiskDeliveries.slice(0, 4).map((delivery) => (
                <div key={delivery.id} className="border border-border bg-background px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{delivery.delivery_id}</p>
                      <p className="text-xs text-muted-foreground">{delivery.customer_name} · {delivery.time_slot}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{delivery.risk_score}</p>
                      <p className="text-[11px] text-muted-foreground">₹{delivery.order_value.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
              {highRiskDeliveries.length === 0 && (
                <p className="text-sm text-muted-foreground">No high-risk deliveries in the current dataset.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Pending Proposals</h3>
              </div>
              {pendingEvents.length > 0 ? (
                pendingEvents.slice(0, 4).map((event) => {
                  const payload = parsePayload(event.payload);
                  const summary = typeof payload?.summary === "string" ? payload.summary : event.event_type;
                  return (
                    <div key={event.id} className="border border-border bg-background px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline" className="text-[10px]">{event.agent_name}</Badge>
                        {riskBadge(event.severity)}
                      </div>
                      <p className="text-sm font-medium">{summary}</p>
                      <p className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</p>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">Run the orchestrator to generate live route and last-mile proposals.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-border bg-card">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <IndianRupee className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Commercial Impact</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="border border-border bg-background px-3 py-3">
              <p className="text-xs text-muted-foreground">High-value orders under risk</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{highRiskDeliveries.length}</p>
            </div>
            <div className="border border-border bg-background px-3 py-3">
              <p className="text-xs text-muted-foreground">Worst route delay</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{sortedRoutes[0]?.predicted_delay_mins ?? 0} min</p>
            </div>
            <div className="border border-border bg-background px-3 py-3">
              <p className="text-xs text-muted-foreground">Most exposed delivery</p>
              <p className="mt-1 text-xl font-semibold">{highRiskDeliveries[0]?.delivery_id ?? "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add / Edit Route Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogMode === "add" ? "Add New Route" : "Edit Route"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {dialogMode === "add" && (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <LocationSearchField
                    label="Origin"
                    placeholder="Search origin city or hub"
                    query={dialogOriginQuery}
                    selected={dialogSelectedOrigin}
                    loading={dialogSearchingOrigin}
                    results={dialogOriginResults}
                    onQueryChange={setDialogOriginQuery}
                    onSelect={selectDialogOrigin}
                  />
                  <LocationSearchField
                    label="Destination"
                    placeholder="Search destination city or hub"
                    query={dialogDestinationQuery}
                    selected={dialogSelectedDestination}
                    loading={dialogSearchingDestination}
                    results={dialogDestinationResults}
                    onQueryChange={setDialogDestinationQuery}
                    onSelect={selectDialogDestination}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 border border-border bg-background px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">Pick both endpoints, then auto-fill route distance, duration, delay, weather, and a default congestion estimate.</p>
                  <Button type="button" variant="outline" size="sm" onClick={autofillDialogRoute} disabled={isAutoFillingDialog}>
                    {isAutoFillingDialog ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                    Auto-Fill
                  </Button>
                </div>
              </>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Route (e.g. Mumbai → Pune via NH48)</label>
              <Input value={form.route} onChange={(e) => updateForm("route", e.target.value)} placeholder="Origin → Destination via Highway" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Distance (km){dialogMode === "add" ? " · auto" : ""}</label>
                <Input type="number" min={0} value={form.distance_km} onChange={(e) => updateForm("distance_km", e.target.value)} readOnly={dialogMode === "add"} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Base Duration (min){dialogMode === "add" ? " · auto" : ""}</label>
                <Input type="number" min={0} value={form.base_duration_mins} onChange={(e) => updateForm("base_duration_mins", e.target.value)} readOnly={dialogMode === "add"} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Weather{dialogMode === "add" ? " · auto" : ""}</label>
                <Input value={form.weather} onChange={(e) => updateForm("weather", e.target.value)} placeholder="Clear, 30°C" readOnly={dialogMode === "add"} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Congestion %{dialogMode === "add" ? " · auto, editable" : ""}</label>
                <Input type="number" min={0} max={100} value={form.congestion_pct} onChange={(e) => updateForm("congestion_pct", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Predicted Delay (min){dialogMode === "add" ? " · auto" : ""}</label>
                <Input type="number" min={0} value={form.predicted_delay_mins} onChange={(e) => updateForm("predicted_delay_mins", e.target.value)} readOnly={dialogMode === "add"} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Risk Level{dialogMode === "add" ? " · auto" : ""}</label>
                <select
                  className="flex h-9 w-full border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.risk_level}
                  onChange={(e) => updateForm("risk_level", e.target.value)}
                  disabled={dialogMode === "add"}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Suggested Alternate Route</label>
              <Input value={form.suggested_alternate} onChange={(e) => updateForm("suggested_alternate", e.target.value)} placeholder="Optional alternate route" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Reasons / Notes</label>
              <Textarea rows={2} value={form.reasons} onChange={(e) => updateForm("reasons", e.target.value)} placeholder="Construction, flood, festival traffic..." />
            </div>
            {dialogFeedback && (
              <p className={`text-xs font-medium ${dialogFeedback.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>{dialogFeedback}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDialog}>Cancel</Button>
            <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {dialogMode === "add" ? "Add Route" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LocationSearchField({
  label,
  placeholder,
  query,
  selected,
  loading,
  results,
  onQueryChange,
  onSelect,
}: {
  label: string;
  placeholder: string;
  query: string;
  selected: LocationOption | null;
  loading: boolean;
  results: LocationOption[];
  onQueryChange: (value: string) => void;
  onSelect: (option: LocationOption) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder={placeholder} />
        {(loading || results.length > 0) && (
          <div className="absolute z-20 mt-1 w-full border border-border bg-card shadow-2xl">
            {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>}
            {!loading && results.map((result) => (
              <button
                key={`${result.label}-${result.lat}-${result.lng}`}
                type="button"
                onClick={() => onSelect(result)}
                className="w-full px-3 py-2 text-left hover:bg-muted/20 transition-colors"
              >
                <p className="text-sm font-medium">{result.label}</p>
                <p className="text-[11px] text-muted-foreground truncate">{result.address}</p>
              </button>
            ))}
          </div>
        )}
      </div>
      {selected && (
        <p className="text-[11px] text-muted-foreground">
          {selected.address} · {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
        </p>
      )}
    </div>
  );
}
