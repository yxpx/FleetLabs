"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiFetch } from "@/lib/api";

interface Route {
  id: string;
  from: [number, number];
  to: [number, number];
  geometry?: [number, number][];
  label: string;
  status: "in-transit" | "delivered" | "delayed";
  risk_level?: string;
}

const ROUTES: Route[] = [
  { id: "r1", from: [19.076, 72.8777], to: [18.5204, 73.8567], label: "Mumbai → Pune", status: "in-transit" },
  { id: "r2", from: [28.7041, 77.1025], to: [26.9124, 75.7873], label: "Delhi → Jaipur", status: "delivered" },
  { id: "r3", from: [12.9716, 77.5946], to: [13.0827, 80.2707], label: "Bangalore → Chennai", status: "delayed" },
  { id: "r4", from: [22.5726, 88.3639], to: [25.5941, 85.1376], label: "Kolkata → Patna", status: "in-transit" },
  { id: "r5", from: [17.385, 78.4867], to: [16.5062, 80.648], label: "Hyderabad → Vijayawada", status: "in-transit" },
];

const statusColor: Record<string, string> = {
  "in-transit": "#4d8eff",
  delivered: "#34d399",
  delayed: "#e54545",
};

const statusLabel: Record<string, string> = {
  "in-transit": "In Transit",
  delivered: "Delivered",
  delayed: "Delayed",
};

export default function LeafletMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [routes, setRoutes] = useState<Route[]>(ROUTES);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    apiFetch<Route[]>("/routes/map")
      .then((rows) => {
        if (rows.length > 0) {
          setRoutes(rows);
        }
      })
      .catch(() => {
        setRoutes(ROUTES);
      });
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || mapInstance.current) return;

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

    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, [ready]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (routeLayer.current) {
      routeLayer.current.remove();
    }

    const nextLayer = L.layerGroup().addTo(map);
    const allLatLngs: L.LatLngExpression[] = [];

    routes.forEach((route) => {
      const color = statusColor[route.status];
      const latlngs: L.LatLngExpression[] = route.geometry?.length ? route.geometry : [route.from, route.to];
      allLatLngs.push(...latlngs);

      L.polyline(latlngs, {
        color,
        weight: 3,
        opacity: 0.8,
        dashArray: route.status === "delayed" ? "8 6" : undefined,
      }).addTo(nextLayer);

      L.circleMarker(route.from, {
        radius: 6,
        color,
        fillColor: color,
        fillOpacity: 1,
        weight: 2,
      })
        .bindPopup(
          `<div style="font-size:12px;line-height:1.4">
            <strong>${route.label}</strong><br/>
            <span style="color:${color}">● ${statusLabel[route.status]}</span><br/>
            Origin
          </div>`,
          { className: "dark-popup" }
        )
        .addTo(nextLayer);

      L.circleMarker(route.to, {
        radius: 5,
        color,
        fillColor: color,
        fillOpacity: 0.5,
        weight: 2,
      })
        .bindPopup(
          `<div style="font-size:12px;line-height:1.4">
            <strong>${route.label}</strong><br/>
            <span style="color:${color}">● ${statusLabel[route.status]}</span><br/>
            Destination
          </div>`,
          { className: "dark-popup" }
        )
        .addTo(nextLayer);

      const mid = L.latLng(
        (route.from[0] + route.to[0]) / 2,
        (route.from[1] + route.to[1]) / 2
      );
      L.marker(mid, {
        icon: L.divIcon({
          className: "route-label",
          html: `<span style="font-size:10px;color:#8e8e9a;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.8)">${route.label}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
      }).addTo(nextLayer);
    });

    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs).pad(0.22), { animate: false });
    }

    routeLayer.current = nextLayer;
  }, [routes]);

  return <div ref={mapRef} className="w-full h-full" />;
}
