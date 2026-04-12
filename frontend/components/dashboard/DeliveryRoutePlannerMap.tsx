"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface PlannerLocation {
  label: string;
  lat: number;
  lng: number;
}

interface ExistingRoute {
  id: string | number;
  label: string;
  geometry: [number, number][];
  riskLevel?: string;
}

interface DeliveryRoutePlannerMapProps {
  origin: PlannerLocation | null;
  destination: PlannerLocation | null;
  routeGeometry: [number, number][];
  existingRoutes?: ExistingRoute[];
  height?: string;
}

const riskColor: Record<string, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#4d8eff",
  low: "#34d399",
};

export function DeliveryRoutePlannerMap({
  origin,
  destination,
  routeGeometry,
  existingRoutes = [],
  height = "420px",
}: DeliveryRoutePlannerMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const baseRouteLayerRef = useRef<L.LayerGroup | null>(null);
  const previewLayerRef = useRef<L.LayerGroup | null>(null);

  const previewBounds = useMemo(() => {
    if (routeGeometry.length > 1) {
      return L.latLngBounds(routeGeometry.map(([lat, lng]) => L.latLng(lat, lng)));
    }
    if (origin && destination) {
      return L.latLngBounds([
        L.latLng(origin.lat, origin.lng),
        L.latLng(destination.lat, destination.lng),
      ]);
    }
    if (origin) {
      return L.latLngBounds([L.latLng(origin.lat, origin.lng), L.latLng(origin.lat, origin.lng)]);
    }
    if (destination) {
      return L.latLngBounds([L.latLng(destination.lat, destination.lng), L.latLng(destination.lat, destination.lng)]);
    }
    return null;
  }, [destination, origin, routeGeometry]);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [20.5937, 78.9629],
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: "topleft" }).addTo(map);
    mapInstanceRef.current = map;

    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (baseRouteLayerRef.current) {
      baseRouteLayerRef.current.remove();
    }

    const layer = L.layerGroup().addTo(map);
    for (const route of existingRoutes) {
      if (!route.geometry.length) continue;
      L.polyline(route.geometry, {
        color: riskColor[(route.riskLevel || "low").toLowerCase()] || "#64748b",
        weight: 2,
        opacity: 0.22,
      }).bindTooltip(route.label, { direction: "top" }).addTo(layer);
    }

    baseRouteLayerRef.current = layer;
  }, [existingRoutes]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (previewLayerRef.current) {
      previewLayerRef.current.remove();
    }

    const layer = L.layerGroup().addTo(map);

    if (origin) {
      L.circleMarker([origin.lat, origin.lng], {
        radius: 7,
        color: "#38bdf8",
        fillColor: "#38bdf8",
        fillOpacity: 1,
        weight: 2,
      }).bindTooltip(`Origin: ${origin.label}`, { direction: "top" }).addTo(layer);
    }

    if (destination) {
      L.circleMarker([destination.lat, destination.lng], {
        radius: 7,
        color: "#34d399",
        fillColor: "#34d399",
        fillOpacity: 1,
        weight: 2,
      }).bindTooltip(`Destination: ${destination.label}`, { direction: "top" }).addTo(layer);
    }

    if (routeGeometry.length > 1) {
      L.polyline(routeGeometry, {
        color: "#f8fafc",
        weight: 5,
        opacity: 0.18,
      }).addTo(layer);
      L.polyline(routeGeometry, {
        color: "#38bdf8",
        weight: 3,
        opacity: 0.95,
        dashArray: "10 10",
      }).addTo(layer);
    }

    if (previewBounds) {
      map.fitBounds(previewBounds.pad(0.25), { animate: false });
    }

    previewLayerRef.current = layer;
  }, [destination, origin, previewBounds, routeGeometry]);

  return <div ref={mapRef} style={{ height, width: "100%" }} />;
}