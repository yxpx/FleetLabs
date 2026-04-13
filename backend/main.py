import asyncio
import json
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncGenerator

import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from contextlib import asynccontextmanager
from dotenv import load_dotenv

from db.database import init_db, get_db
from models.schemas import (
    InventorySaveRequest,
    AgentActionRequest,
    RoutePreviewRequest,
    DeliveryRouteCreateRequest,
)
from vision.traffic_monitor import TrafficAnalyticsService
from agents.sse_events import broadcaster


load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="FleetLabs API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

traffic_service = TrafficAnalyticsService()


async def _sync_inventory_items(db, scan_id: str, items: list[dict[str, Any]]):
    await db.execute("DELETE FROM inventory_items WHERE scan_id = ?", (scan_id,))

    for index, item in enumerate(items):
        await db.execute(
            """
            INSERT INTO inventory_items (
                scan_id, item_id, label, confidence, bbox, area, ocr_texts, source,
                brand, category, count, location, condition, evidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                scan_id,
                item.get("id", index),
                item.get("label") or item.get("name") or "unknown",
                item.get("confidence"),
                json.dumps(item.get("bbox", [])),
                item.get("area"),
                json.dumps(item.get("ocr_texts", [])),
                item.get("source"),
                item.get("brand"),
                item.get("category"),
                item.get("count"),
                item.get("location"),
                item.get("condition"),
                item.get("evidence"),
            ),
        )


# ──────────────────────────────────────────────
# Health
# ──────────────────────────────────────────────
@app.get("/")
async def root():
    return {"message": "FleetLabs API is running"}


@app.get("/health")
async def health():
    inventory_model = os.getenv("OPENROUTER_INVENTORY_MODEL", "google/gemini-2.5-flash")
    cv_model = os.getenv("OPENROUTER_CV_MODEL", "google/gemini-2.5-flash")
    return {
        "status": "ok",
        "openrouter_configured": bool(os.getenv("OPENROUTER_API_KEY")),
        "vision_model": inventory_model,
        "inventory_model": inventory_model,
        "cv_model": cv_model,
        "agent_model": os.getenv("OPENROUTER_AGENT_MODEL", "google/gemini-2.5-flash"),
    }


# ──────────────────────────────────────────────
# Inventory Endpoints
# ──────────────────────────────────────────────
@app.post("/inventory/scan")
async def inventory_scan(
    file: UploadFile = File(...),
    query: str = Form(default=""),
):
    """Upload image → Gemini Vision → return inventory items"""
    contents = await file.read()

    # Import here to avoid slow startup
    from vision.segmentor import segment_and_analyze

    result = await asyncio.to_thread(segment_and_analyze, contents, query)
    return result


@app.post("/inventory/save")
async def inventory_save(req: InventorySaveRequest):
    """Save structured inventory to SQLite"""
    db = await get_db()
    try:
        item_count = req.item_count if req.item_count is not None else len(req.items)
        await db.execute(
            """INSERT INTO inventory_scans (scan_id, item_count, schema_columns, items, natural_language_query)
               VALUES (?, ?, ?, ?, ?)""",
            (
                req.scan_id,
                item_count,
                json.dumps(req.schema_columns),
                json.dumps(req.items),
                req.natural_language_query,
            ),
        )
        await _sync_inventory_items(db, req.scan_id, req.items)
        await db.commit()
        return {"status": "saved", "scan_id": req.scan_id, "item_count": item_count}
    finally:
        await db.close()


@app.get("/inventory")
async def list_inventory():
    """List all inventory scans"""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, scan_id, item_count, schema_columns, items, natural_language_query, created_at FROM inventory_scans ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        await db.close()


@app.get("/inventory/{scan_id}")
async def get_inventory(scan_id: str):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM inventory_scans WHERE scan_id = ?", (scan_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Scan not found")
        return dict(row)
    finally:
        await db.close()


@app.delete("/inventory/{scan_id}")
async def delete_inventory(scan_id: str):
    """Delete an inventory scan"""
    db = await get_db()
    try:
        await db.execute("DELETE FROM inventory_items WHERE scan_id = ?", (scan_id,))
        cursor = await db.execute(
            "DELETE FROM inventory_scans WHERE scan_id = ?", (scan_id,)
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Scan not found")
        return {"status": "deleted", "scan_id": scan_id}
    finally:
        await db.close()


@app.patch("/inventory/{scan_id}")
async def update_inventory_item(scan_id: str, body: dict):
    """Update items in an inventory scan"""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT items FROM inventory_scans WHERE scan_id = ?", (scan_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Scan not found")
        items = json.loads(row["items"]) if isinstance(row["items"], str) else row["items"]
        item_id = body.get("item_id")
        updates = body.get("updates", {})
        for item in items:
            if item.get("id") == item_id:
                item.update(updates)
                break
        await db.execute(
            "UPDATE inventory_scans SET items = ? WHERE scan_id = ?",
            (json.dumps(items), scan_id),
        )
        await _sync_inventory_items(db, scan_id, items)
        await db.commit()
        return {"status": "updated", "scan_id": scan_id}
    finally:
        await db.close()


# ──────────────────────────────────────────────
# Vision Endpoints
# ──────────────────────────────────────────────
@app.post("/vision/scan")
async def vision_damage_scan(file: UploadFile = File(...)):
    """Damage detection on uploaded image"""
    contents = await file.read()
    from vision.damage_detector import detect_damage

    result = await asyncio.to_thread(detect_damage, contents)
    return result


@app.post("/vision/load-estimate")
async def vision_load_estimate(file: UploadFile = File(...)):
    """Estimate truck load fill percentage"""
    contents = await file.read()
    from vision.load_estimator import estimate_load

    result = await asyncio.to_thread(estimate_load, contents)
    return result


@app.post("/vision/vehicle-count")
async def vision_vehicle_count(file: UploadFile = File(...)):
    """Count vehicles in image"""
    contents = await file.read()
    from vision.vehicle_counter import count_vehicles

    result = await asyncio.to_thread(count_vehicles, contents)
    return result


# ──────────────────────────────────────────────
# Database Browser
# ──────────────────────────────────────────────
ALLOWED_TABLES = [
    "inventory_scans", "inventory_items", "damage_events", "dock_slots",
    "agent_events", "route_risks", "deliveries",
]


@app.get("/db/tables")
async def list_tables():
    """List available tables with row counts"""
    db = await get_db()
    try:
        results = []
        for table in ALLOWED_TABLES:
            row = await (await db.execute(f"SELECT COUNT(*) as count FROM {table}")).fetchone()
            results.append({"name": table, "count": row["count"]})
        return results
    finally:
        await db.close()


@app.get("/db/{table}")
async def browse_table(table: str, limit: int = 100, offset: int = 0):
    """Read rows from an allowed table"""
    if table not in ALLOWED_TABLES:
        raise HTTPException(status_code=400, detail=f"Table '{table}' is not browsable")
    db = await get_db()
    try:
        count_row = await (await db.execute(f"SELECT COUNT(*) as count FROM {table}")).fetchone()
        cursor = await db.execute(
            f"SELECT * FROM {table} ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()
        return {
            "table": table,
            "total": count_row["count"],
            "limit": limit,
            "offset": offset,
            "rows": [dict(r) for r in rows],
        }
    finally:
        await db.close()


@app.patch("/db/{table}/{row_id}")
async def update_table_row(table: str, row_id: int, body: dict):
    if table not in ALLOWED_TABLES:
        raise HTTPException(status_code=400, detail=f"Table '{table}' is not editable")

    raw_updates = body.get("updates") if isinstance(body, dict) else None
    if not isinstance(raw_updates, dict) or not raw_updates:
        raise HTTPException(status_code=400, detail="Body must include an 'updates' object")

    db = await get_db()
    try:
        schema_rows = await (await db.execute(f"PRAGMA table_info({table})")).fetchall()
        editable_columns = {row["name"] for row in schema_rows if row["name"] != "id"}
        updates = {
            key: json.dumps(value) if isinstance(value, (dict, list)) else value
            for key, value in raw_updates.items()
            if key in editable_columns
        }
        if not updates:
            raise HTTPException(status_code=400, detail="No editable columns supplied")

        assignments = ", ".join([f"{column} = ?" for column in updates])
        values = list(updates.values()) + [row_id]
        cursor = await db.execute(f"UPDATE {table} SET {assignments} WHERE id = ?", values)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Row not found")
        await db.commit()
        updated = await (await db.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,))).fetchone()
        return {"status": "updated", "row": dict(updated) if updated else None}
    finally:
        await db.close()


@app.post("/db/{table}/add")
async def add_table_row(table: str, body: dict):
    if table not in ALLOWED_TABLES:
        raise HTTPException(status_code=400, detail=f"Table '{table}' is not writable")
    data = body.get("data")
    if not isinstance(data, dict) or not data:
        raise HTTPException(status_code=400, detail="Body must include a 'data' object")
    db = await get_db()
    try:
        schema_rows = await (await db.execute(f"PRAGMA table_info({table})")).fetchall()
        editable_columns = {row["name"] for row in schema_rows if row["name"] != "id"}
        filtered = {
            key: json.dumps(value) if isinstance(value, (dict, list)) else value
            for key, value in data.items()
            if key in editable_columns
        }
        if not filtered:
            raise HTTPException(status_code=400, detail="No valid columns supplied")
        cols = ", ".join(filtered.keys())
        placeholders = ", ".join(["?"] * len(filtered))
        cursor = await db.execute(
            f"INSERT INTO {table} ({cols}) VALUES ({placeholders})",
            list(filtered.values()),
        )
        await db.commit()
        new_row = await (await db.execute(f"SELECT * FROM {table} WHERE id = ?", (cursor.lastrowid,))).fetchone()
        return {"status": "created", "row": dict(new_row) if new_row else None}
    finally:
        await db.close()


@app.delete("/db/{table}/{row_id}")
async def delete_table_row(table: str, row_id: int):
    if table not in ALLOWED_TABLES:
        raise HTTPException(status_code=400, detail=f"Table '{table}' is not deletable")
    db = await get_db()
    try:
        cursor = await db.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Row not found")
        await db.commit()
        return {"status": "deleted", "id": row_id}
    finally:
        await db.close()


# ──────────────────────────────────────────────
# Agent Events & Actions (Human-in-the-Loop)
# ──────────────────────────────────────────────
@app.get("/events/pending")
async def get_pending_events():
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM agent_events WHERE human_decision IS NULL ORDER BY created_at DESC LIMIT 50"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@app.get("/events/all")
async def get_all_events():
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM agent_events ORDER BY created_at DESC LIMIT 100"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


@app.post("/actions/{event_id}/approve")
async def approve_action(event_id: int):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE agent_events SET human_decision = 'approved', decided_at = CURRENT_TIMESTAMP WHERE id = ?",
            (event_id,),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM agent_events WHERE id = ?", (event_id,))
        row = await cursor.fetchone()
        event = dict(row) if row else {}
        await broadcaster.publish("DECISION", {"event_id": event_id, "decision": "approved", "event": event})
        return {"status": "approved", "event_id": event_id, "event": event}
    finally:
        await db.close()


@app.post("/actions/{event_id}/reject")
async def reject_action(event_id: int):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE agent_events SET human_decision = 'rejected', decided_at = CURRENT_TIMESTAMP WHERE id = ?",
            (event_id,),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM agent_events WHERE id = ?", (event_id,))
        row = await cursor.fetchone()
        event = dict(row) if row else {}
        await broadcaster.publish("DECISION", {"event_id": event_id, "decision": "rejected", "event": event})
        return {"status": "rejected", "event_id": event_id, "event": event}
    finally:
        await db.close()


@app.post("/actions/{event_id}/override")
async def override_action(event_id: int, req: AgentActionRequest):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE agent_events SET human_decision = 'overridden', payload = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?",
            (json.dumps(req.override_params), event_id),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM agent_events WHERE id = ?", (event_id,))
        row = await cursor.fetchone()
        event = dict(row) if row else {}
        await broadcaster.publish("DECISION", {"event_id": event_id, "decision": "overridden", "event": event})
        return {"status": "overridden", "event_id": event_id, "event": event}
    finally:
        await db.close()


# ──────────────────────────────────────────────
# SSE Stream
# ──────────────────────────────────────────────
async def event_generator() -> AsyncGenerator[str, None]:
    """SSE event stream — pushes agent events every 10s, and instantly relays decision broadcasts."""
    queue = broadcaster.subscribe()
    try:
        while True:
            # Poll DB every 10s, but also check for real-time broadcasts
            db = await get_db()
            try:
                cursor = await db.execute(
                    "SELECT * FROM agent_events ORDER BY created_at DESC LIMIT 20"
                )
                rows = await cursor.fetchall()
                events = [dict(r) for r in rows]
            finally:
                await db.close()

            data = json.dumps({"type": "AGENT_EVENTS", "data": events})
            yield f"data: {data}\n\n"

            # Wait up to 10s, but wake early if a decision broadcast arrives
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=10.0)
                # Relay broadcast immediately, then loop to send fresh DB snapshot
                yield f"data: {msg}\n\n"
            except asyncio.TimeoutError:
                pass
    finally:
        broadcaster.unsubscribe(queue)


@app.get("/orchestrator/events")
async def sse_events():
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/orchestrator/run")
@app.post("/orchestrator/run-all")
async def run_orchestrator():
    from agents.orchestrator import run_all_agents

    result = await run_all_agents()
    return {"status": "ok", **result}


CITY_COORDS = {
    "Mumbai": (19.0760, 72.8777),
    "Pune": (18.5204, 73.8567),
    "Delhi": (28.6139, 77.2090),
    "Jaipur": (26.9124, 75.7873),
    "Bangalore": (12.9716, 77.5946),
    "Chennai": (13.0827, 80.2707),
    "Hyderabad": (17.3850, 78.4867),
    "Vijayawada": (16.5062, 80.6480),
    "Kolkata": (22.5726, 88.3639),
    "Dhanbad": (23.7957, 86.4304),
    "Nashik": (19.9975, 73.7898),
    "Ahmedabad": (23.0225, 72.5714),
    "Vadodara": (22.3072, 73.1812),
    "Coimbatore": (11.0168, 76.9558),
}

WEATHER_LABELS = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Fog",
    51: "Light drizzle",
    61: "Rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Snow",
    80: "Rain showers",
    95: "Thunderstorm",
}


def _haversine_km(origin_lat: float, origin_lng: float, destination_lat: float, destination_lng: float) -> float:
    radius_km = 6371.0
    d_lat = math.radians(destination_lat - origin_lat)
    d_lng = math.radians(destination_lng - origin_lng)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(origin_lat))
        * math.cos(math.radians(destination_lat))
        * math.sin(d_lng / 2) ** 2
    )
    return 2 * radius_km * math.asin(math.sqrt(a))


def _fallback_location_matches(query: str, limit: int) -> list[dict[str, Any]]:
    query_lc = query.lower().strip()
    matches = []
    for city, (lat, lng) in CITY_COORDS.items():
        if query_lc in city.lower():
            matches.append({
                "label": city,
                "address": f"{city}, India",
                "lat": lat,
                "lng": lng,
                "source": "workspace-city-cache",
            })
    return matches[:limit]


async def _search_locations(query: str, limit: int = 5) -> list[dict[str, Any]]:
    matches = _fallback_location_matches(query, limit)
    seen = {(round(item["lat"], 5), round(item["lng"], 5), item["label"]) for item in matches}

    try:
        async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "FleetLabs/1.0"}) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": query,
                    "format": "jsonv2",
                    "limit": max(limit, 5),
                    "addressdetails": 0,
                },
            )
            response.raise_for_status()
            for row in response.json():
                label = str(row.get("name") or row.get("display_name") or "").strip()
                address = str(row.get("display_name") or label).strip()
                lat = float(row["lat"])
                lng = float(row["lon"])
                key = (round(lat, 5), round(lng, 5), label)
                if not label or key in seen:
                    continue
                seen.add(key)
                matches.append(
                    {
                        "label": label,
                        "address": address,
                        "lat": lat,
                        "lng": lng,
                        "source": "nominatim",
                    }
                )
                if len(matches) >= limit:
                    break
    except Exception:
        pass

    return matches[:limit]


async def _fetch_route_geometry(origin_lat: float, origin_lng: float, destination_lat: float, destination_lng: float) -> tuple[float, int, list[list[float]], str]:
    try:
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "FleetLabs/1.0"}) as client:
            response = await client.get(
                f"https://router.project-osrm.org/route/v1/driving/{origin_lng},{origin_lat};{destination_lng},{destination_lat}",
                params={"overview": "full", "geometries": "geojson"},
            )
            response.raise_for_status()
            route_data = response.json().get("routes", [{}])[0]
        coordinates = route_data.get("geometry", {}).get("coordinates") or []
        geometry = [[lat, lng] for lng, lat in coordinates] if coordinates else [[origin_lat, origin_lng], [destination_lat, destination_lng]]
        distance_km = round(float(route_data.get("distance", 0)) / 1000, 1)
        base_duration_mins = max(1, round(float(route_data.get("duration", 0)) / 60))
        return distance_km, base_duration_mins, geometry, "osrm"
    except Exception:
        distance_km = round(_haversine_km(origin_lat, origin_lng, destination_lat, destination_lng), 1)
        base_duration_mins = max(1, round((distance_km / 42.0) * 60))
        return distance_km, base_duration_mins, [[origin_lat, origin_lng], [destination_lat, destination_lng]], "straight-line-fallback"


async def _fetch_weather(destination_lat: float, destination_lng: float) -> tuple[str | None, int | None, int | None, int | None]:
    try:
        async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "FleetLabs/1.0"}) as client:
            response = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": destination_lat,
                    "longitude": destination_lng,
                    "current": "temperature_2m,wind_speed_10m,weather_code",
                },
            )
            response.raise_for_status()
            current = response.json().get("current", {})
        weather_code = int(current.get("weather_code") or 0)
        weather_label = WEATHER_LABELS.get(weather_code, f"Code {weather_code}")
        temperature = round(float(current.get("temperature_2m") or 0))
        wind_speed = round(float(current.get("wind_speed_10m") or 0))
        return weather_label, temperature, wind_speed, weather_code
    except Exception:
        return None, None, None, None


async def _build_route_plan(
    origin_label: str,
    origin_lat: float,
    origin_lng: float,
    destination_label: str,
    destination_lat: float,
    destination_lng: float,
) -> dict[str, Any]:
    distance_km, base_duration_mins, route_geometry, route_source = await _fetch_route_geometry(
        origin_lat,
        origin_lng,
        destination_lat,
        destination_lng,
    )
    weather_label, temperature, wind_speed, weather_code = await _fetch_weather(destination_lat, destination_lng)

    india_now = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    rush_factor = 18 if india_now.hour in {8, 9, 10, 17, 18, 19, 20} else 10 if 11 <= india_now.hour <= 16 else 4
    weather_factor = 12 if (weather_code or 0) >= 80 else 8 if weather_code in {45, 48, 61, 63, 65} else 4 if weather_code in {1, 2, 3, 51} else 0
    route_factor = min(10, round(distance_km / 60))
    congestion_pct = min(78.0, float(max(6, rush_factor + weather_factor + route_factor)))
    predicted_delay_mins = round(base_duration_mins * (congestion_pct / 100) * 0.38)
    risk_level = _risk_level_from_delay(predicted_delay_mins)
    suggested_alternate = (
        f"Stagger departure by {min(30, max(10, predicted_delay_mins // 2))} min and re-check the corridor before dispatch."
        if risk_level in {"high", "critical"}
        else None
    )
    weather_text = (
        f"{weather_label}, {temperature}°C, wind {wind_speed} km/h"
        if weather_label is not None and temperature is not None and wind_speed is not None
        else "Weather feed unavailable"
    )
    reasons = (
        f"{origin_label} to {destination_label} is running at {round(congestion_pct)}% estimated congestion with "
        f"{predicted_delay_mins} min projected delay. Source: {route_source}."
    )

    return {
        "route": f"{origin_label} → {destination_label}",
        "origin_name": origin_label,
        "origin_lat": origin_lat,
        "origin_lng": origin_lng,
        "destination_name": destination_label,
        "destination_lat": destination_lat,
        "destination_lng": destination_lng,
        "route_geometry": route_geometry,
        "distance_km": distance_km,
        "base_duration_mins": base_duration_mins,
        "congestion_pct": congestion_pct,
        "predicted_delay_mins": predicted_delay_mins,
        "risk_level": risk_level,
        "suggested_alternate": suggested_alternate,
        "reasons": reasons,
        "weather": weather_text,
        "route_source": route_source,
    }


def _route_map_status(risk_level: str, delivery_status: str | None) -> str:
    if (delivery_status or "").lower() in {"delivered", "completed"}:
        return "delivered"
    if risk_level.lower() in {"high", "critical"} or (delivery_status or "").lower() == "delayed":
        return "delayed"
    return "in-transit"


def _extract_route_cities(route: str) -> tuple[str | None, str | None]:
    base_route = route.split(" via ", 1)[0]
    if "→" in base_route:
        origin, destination = base_route.split("→", 1)
    elif "->" in base_route:
        origin, destination = base_route.split("->", 1)
    else:
        return None, None
    return origin.strip(), destination.strip()


def _risk_level_from_delay(delay_minutes: int) -> str:
    if delay_minutes >= 60:
        return "critical"
    if delay_minutes >= 35:
        return "high"
    if delay_minutes >= 18:
        return "medium"
    return "low"


async def _build_live_route_update(route_row: dict[str, Any]) -> dict[str, Any]:
    origin_name = str(route_row.get("origin_name") or "").strip()
    destination_name = str(route_row.get("destination_name") or "").strip()
    origin_lat = route_row.get("origin_lat")
    origin_lng = route_row.get("origin_lng")
    destination_lat = route_row.get("destination_lat")
    destination_lng = route_row.get("destination_lng")

    if None in {origin_lat, origin_lng, destination_lat, destination_lng}:
        parsed_origin, parsed_destination = _extract_route_cities(str(route_row.get("route") or ""))
        origin_name = origin_name or (parsed_origin or "Origin")
        destination_name = destination_name or (parsed_destination or "Destination")
        origin = CITY_COORDS.get(parsed_origin or "")
        destination = CITY_COORDS.get(parsed_destination or "")
        if not origin or not destination:
            return route_row
        origin_lat, origin_lng = origin
        destination_lat, destination_lng = destination

    try:
        refreshed = await _build_route_plan(
            origin_name or "Origin",
            float(origin_lat),
            float(origin_lng),
            destination_name or "Destination",
            float(destination_lat),
            float(destination_lng),
        )
    except Exception:
        return route_row
    updated = dict(route_row)
    updated.update(refreshed)
    return updated


@app.post("/routes/refresh-live")
async def refresh_live_routes():
    reader = await get_db()
    try:
        route_rows = await (await reader.execute("SELECT * FROM route_risks ORDER BY id ASC")).fetchall()
        routes = [dict(row) for row in route_rows]
    finally:
        await reader.close()

    updates = []
    for route in routes:
        try:
            updates.append(await _build_live_route_update(route))
        except Exception:
            updates.append(route)

    writer = await get_db()
    try:
        for route in updates:
            await writer.execute(
                """UPDATE route_risks
                   SET distance_km = ?, base_duration_mins = ?, congestion_pct = ?,
                       predicted_delay_mins = ?, risk_level = ?, suggested_alternate = ?, reasons = ?, weather = ?,
                       origin_name = ?, origin_lat = ?, origin_lng = ?, destination_name = ?, destination_lat = ?, destination_lng = ?, route_geometry = ?
                   WHERE id = ?""",
                (
                    route.get("distance_km"),
                    route.get("base_duration_mins"),
                    route.get("congestion_pct"),
                    route.get("predicted_delay_mins"),
                    route.get("risk_level"),
                    route.get("suggested_alternate"),
                    route.get("reasons"),
                    route.get("weather"),
                    route.get("origin_name"),
                    route.get("origin_lat"),
                    route.get("origin_lng"),
                    route.get("destination_name"),
                    route.get("destination_lat"),
                    route.get("destination_lng"),
                    json.dumps(route.get("route_geometry") or []),
                    route.get("id"),
                ),
            )
        await writer.commit()
    finally:
        await writer.close()

    return {"status": "refreshed", "updated": len(updates), "traffic_source": "estimated", "weather_source": "open-meteo"}


@app.get("/locations/search")
async def search_locations(q: str, limit: int = 5):
    query = q.strip()
    if len(query) < 2:
        return []
    return await _search_locations(query, limit=max(1, min(limit, 8)))


@app.post("/routes/preview")
async def preview_route(req: RoutePreviewRequest):
    return await _build_route_plan(
        req.origin.label,
        req.origin.lat,
        req.origin.lng,
        req.destination.label,
        req.destination.lat,
        req.destination.lng,
    )


@app.post("/routes/create-delivery")
async def create_delivery_route(req: DeliveryRouteCreateRequest):
    planned_route = await _build_route_plan(
        req.origin.label,
        req.origin.lat,
        req.origin.lng,
        req.destination.label,
        req.destination.lat,
        req.destination.lng,
    )
    delivery_id = req.delivery_id or f"DLV-{datetime.utcnow():%m%d%H%M%S}"
    risk_score = min(
        100,
        round(
            planned_route["congestion_pct"]
            + planned_route["predicted_delay_mins"]
            + (15 if planned_route["risk_level"] == "critical" else 8 if planned_route["risk_level"] == "high" else 0)
        ),
    )
    created_at = datetime.utcnow().isoformat()

    db = await get_db()
    try:
        route_cursor = await db.execute(
            """INSERT INTO route_risks (
                   route, distance_km, base_duration_mins, congestion_pct, predicted_delay_mins,
                   risk_level, suggested_alternate, reasons, weather,
                   origin_name, origin_lat, origin_lng, destination_name, destination_lat, destination_lng,
                   route_geometry, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                planned_route["route"],
                planned_route["distance_km"],
                planned_route["base_duration_mins"],
                planned_route["congestion_pct"],
                planned_route["predicted_delay_mins"],
                planned_route["risk_level"],
                planned_route["suggested_alternate"],
                planned_route["reasons"],
                planned_route["weather"],
                planned_route["origin_name"],
                planned_route["origin_lat"],
                planned_route["origin_lng"],
                planned_route["destination_name"],
                planned_route["destination_lat"],
                planned_route["destination_lng"],
                json.dumps(planned_route["route_geometry"]),
                created_at,
            ),
        )
        route_id = route_cursor.lastrowid

        delivery_cursor = await db.execute(
            """INSERT INTO deliveries (
                   delivery_id, customer_name, address, pincode, time_slot, order_value,
                   risk_score, risk_level, status, route_id, destination_lat, destination_lng, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                delivery_id,
                req.customer_name,
                req.address,
                req.pincode,
                req.time_slot,
                req.order_value,
                risk_score,
                planned_route["risk_level"],
                "scheduled",
                route_id,
                req.destination.lat,
                req.destination.lng,
                created_at,
            ),
        )

        await db.commit()
        route_row = await (await db.execute("SELECT * FROM route_risks WHERE id = ?", (route_id,))).fetchone()
        delivery_row = await (await db.execute("SELECT * FROM deliveries WHERE id = ?", (delivery_cursor.lastrowid,))).fetchone()
        return {
            "status": "created",
            "route": dict(route_row) if route_row else None,
            "delivery": dict(delivery_row) if delivery_row else None,
        }
    finally:
        await db.close()


@app.get("/routes/map")
async def get_route_map():
    db = await get_db()
    try:
        route_rows = await (await db.execute("SELECT * FROM route_risks ORDER BY created_at DESC")).fetchall()
        delivery_rows = await (
            await db.execute("SELECT route_id, status FROM deliveries WHERE route_id IS NOT NULL ORDER BY created_at DESC")
        ).fetchall()
        delivery_status_by_route = {row["route_id"]: row["status"] for row in delivery_rows}

        routes = []
        for row in route_rows:
            route = dict(row)
            origin_name = str(route.get("origin_name") or "").strip()
            destination_name = str(route.get("destination_name") or "").strip()
            origin_lat = route.get("origin_lat")
            origin_lng = route.get("origin_lng")
            destination_lat = route.get("destination_lat")
            destination_lng = route.get("destination_lng")

            if None in {origin_lat, origin_lng, destination_lat, destination_lng}:
                parsed_origin, parsed_destination = _extract_route_cities(str(route.get("route") or ""))
                origin_name = origin_name or (parsed_origin or "Origin")
                destination_name = destination_name or (parsed_destination or "Destination")
                fallback_origin = CITY_COORDS.get(parsed_origin or "")
                fallback_destination = CITY_COORDS.get(parsed_destination or "")
                if not fallback_origin or not fallback_destination:
                    continue
                origin_lat, origin_lng = fallback_origin
                destination_lat, destination_lng = fallback_destination

            geometry = []
            raw_geometry = route.get("route_geometry")
            if raw_geometry:
                try:
                    parsed_geometry = json.loads(raw_geometry) if isinstance(raw_geometry, str) else raw_geometry
                    if isinstance(parsed_geometry, list):
                        geometry = parsed_geometry
                except Exception:
                    geometry = []
            if not geometry:
                geometry = [[float(origin_lat), float(origin_lng)], [float(destination_lat), float(destination_lng)]]

            routes.append(
                {
                    "id": str(route.get("id")),
                    "from": [float(origin_lat), float(origin_lng)],
                    "to": [float(destination_lat), float(destination_lng)],
                    "geometry": geometry,
                    "label": route.get("route") or f"{origin_name} → {destination_name}",
                    "status": _route_map_status(str(route.get("risk_level") or "low"), delivery_status_by_route.get(route.get("id"))),
                    "risk_level": route.get("risk_level") or "low",
                }
            )
        return routes
    finally:
        await db.close()


@app.get("/traffic/stream")
def traffic_stream(source: str = "video", path: str = "", max_seconds: int = 30, frame_stride: int = 2):
    def event_stream():
        try:
            for payload in traffic_service.stream(source.lower().strip(), path or None, max_seconds, frame_stride):
                yield f"data: {json.dumps(payload)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ──────────────────────────────────────────────
# Dashboard Stats
# ──────────────────────────────────────────────
@app.get("/stats")
async def dashboard_stats():
    db = await get_db()
    try:
        scans = await (await db.execute("SELECT COUNT(*) as c FROM inventory_scans")).fetchone()
        damage = await (await db.execute("SELECT COUNT(*) as c FROM damage_events")).fetchone()
        events = await (await db.execute("SELECT COUNT(*) as c FROM agent_events")).fetchone()
        pending = await (await db.execute("SELECT COUNT(*) as c FROM agent_events WHERE human_decision IS NULL")).fetchone()
        deliveries = await (await db.execute("SELECT COUNT(*) as c FROM deliveries")).fetchone()
        routes = await (await db.execute("SELECT COUNT(*) as c FROM route_risks")).fetchone()
        docks = await (await db.execute("SELECT COUNT(*) as c FROM dock_slots")).fetchone()
        critical_routes = await (await db.execute("SELECT COUNT(*) as c FROM route_risks WHERE lower(risk_level) IN ('high', 'critical')")).fetchone()
        critical_deliveries = await (await db.execute("SELECT COUNT(*) as c FROM deliveries WHERE lower(risk_level) IN ('high', 'critical')")).fetchone()
        avg_route_delay = await (await db.execute("SELECT COALESCE(AVG(predicted_delay_mins), 0) as c FROM route_risks")).fetchone()
        return {
            "total_scans": scans["c"],
            "total_damage_events": damage["c"],
            "total_agent_events": events["c"],
            "pending_actions": pending["c"],
            "total_deliveries": deliveries["c"],
            "total_routes": routes["c"],
            "total_docks": docks["c"],
            "critical_routes": critical_routes["c"],
            "critical_deliveries": critical_deliveries["c"],
            "avg_route_delay": round(float(avg_route_delay["c"]), 1),
        }
    finally:
        await db.close()


# ──────────────────────────────────────────────
# Clear All Data
# ──────────────────────────────────────────────
@app.delete("/db/clear-all")
async def clear_all_data():
    """Delete all rows in every table"""
    db = await get_db()
    try:
        for table in ALLOWED_TABLES:
            await db.execute(f"DELETE FROM {table}")
        await db.commit()
        return {"status": "cleared", "tables": ALLOWED_TABLES}
    finally:
        await db.close()


# ──────────────────────────────────────────────
# Seed Demo Data
# ──────────────────────────────────────────────
@app.post("/db/seed-demo")
async def seed_demo_data():
    """Populate all tables with realistic demo data for presentation"""
    import random
    from datetime import datetime, timedelta

    db = await get_db()
    try:
        # Clean first
        for table in ALLOWED_TABLES:
            await db.execute(f"DELETE FROM {table}")

        now = datetime.utcnow()

        # ── inventory_scans ──
        inventory_items = [
            {"scan_id": "SCAN-WH01-0412", "items": json.dumps([
                {"id": 0, "label": "carton", "confidence": 0.94, "bbox": [10,10,200,180], "area": 36100, "ocr_texts": ["SKU-0293", "Fragile"], "source": "gemini"},
                {"id": 1, "label": "carton", "confidence": 0.91, "bbox": [210,10,400,180], "area": 32300, "ocr_texts": ["SKU-0412"], "source": "gemini"},
                {"id": 2, "label": "pallet", "confidence": 0.89, "bbox": [0,190,400,360], "area": 68000, "ocr_texts": ["LOT-B7"], "source": "gemini"},
                {"id": 3, "label": "carton", "confidence": 0.87, "bbox": [420,10,580,180], "area": 27200, "ocr_texts": ["SKU-1104", "Handle with care"], "source": "gemini"},
                {"id": 4, "label": "drum", "confidence": 0.82, "bbox": [420,190,560,380], "area": 26600, "ocr_texts": ["CHEM-44"], "source": "gemini"},
            ]), "item_count": 5, "schema_columns": '["id","label","confidence","bbox","area","ocr_texts","source"]', "query": "Count all boxes and pallets in warehouse aisle A"},
            {"scan_id": "SCAN-WH02-0411", "items": json.dumps([
                {"id": 0, "label": "book", "confidence": 0.88, "bbox": [5,5,80,200], "area": 14625, "ocr_texts": ["Star Wars"], "source": "gemini"},
                {"id": 1, "label": "book", "confidence": 0.85, "bbox": [85,5,160,200], "area": 14625, "ocr_texts": ["Dark Force Rising"], "source": "gemini"},
                {"id": 2, "label": "book", "confidence": 0.83, "bbox": [165,5,240,200], "area": 14625, "ocr_texts": ["Outcast"], "source": "gemini"},
            ]), "item_count": 3, "schema_columns": '["id","label","confidence","bbox","area","ocr_texts","source"]', "query": "Identify all books on shelves"},
            {"scan_id": "SCAN-YD01-0410", "items": json.dumps([
                {"id": 0, "label": "container", "confidence": 0.96, "bbox": [20,30,300,250], "area": 61600, "ocr_texts": ["MAERSK", "MSKU-9281047"], "source": "gemini"},
                {"id": 1, "label": "container", "confidence": 0.93, "bbox": [310,30,590,250], "area": 61600, "ocr_texts": ["COSCO", "CCLU-7184235"], "source": "gemini"},
                {"id": 2, "label": "truck", "confidence": 0.91, "bbox": [50,260,280,420], "area": 36800, "ocr_texts": ["MH-12-AB-4321"], "source": "gemini"},
                {"id": 3, "label": "container", "confidence": 0.88, "bbox": [600,30,880,250], "area": 61600, "ocr_texts": ["EVERGREEN"], "source": "gemini"},
            ]), "item_count": 4, "schema_columns": '["id","label","confidence","bbox","area","ocr_texts","source"]', "query": "Count containers and vehicles in yard"},
        ]
        for inv in inventory_items:
            await db.execute(
                "INSERT INTO inventory_scans (scan_id, item_count, schema_columns, items, natural_language_query, created_at) VALUES (?,?,?,?,?,?)",
                (inv["scan_id"], inv["item_count"], inv["schema_columns"], inv["items"], inv["query"], (now - timedelta(hours=random.randint(1, 72))).isoformat()),
            )

        # ── damage_events ──
        damage_rows = [
            ("SHP-MUM-2640", "Mumbai Hub Inbound", "dent", 0.87, "MODERATE", 19.076, 72.8777, None),
            ("SHP-DEL-3891", "Delhi Sorting Center", "tear", 0.92, "CRITICAL", 28.6139, 77.209, None),
            ("SHP-BLR-1102", "Bangalore Last-Mile", "moisture", 0.78, "MINOR", 12.9716, 77.5946, None),
            ("SHP-HYD-4410", "Hyderabad Cross-Dock", "crushed", 0.95, "CRITICAL", 17.385, 78.4867, None),
            ("SHP-CHN-7721", "Chennai Port Entry", "contamination", 0.83, "MODERATE", 13.0827, 80.2707, None),
            ("SHP-PUN-5502", "Pune Distribution", "scratch", 0.69, "MINOR", 18.5204, 73.8567, None),
            ("SHP-KOL-9913", "Kolkata Warehouse B", "dent", 0.74, "MINOR", 22.5726, 88.3639, None),
            ("SHP-AHM-6654", "Ahmedabad Hub", "water_damage", 0.91, "CRITICAL", 23.0225, 72.5714, None),
        ]
        for d in damage_rows:
            await db.execute(
                "INSERT INTO damage_events (shipment_id, checkpoint, damage_type, confidence, severity, lat, lng, image_url, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (*d, (now - timedelta(hours=random.randint(1, 96))).isoformat()),
            )

        # ── dock_slots ──
        dock_statuses = ["active", "occupied", "reserved", "maintenance"]
        for dock_i in range(1, 4):
            for slot_i in range(1, 5):
                slot_id = f"D{dock_i}-S{slot_i}"
                status = random.choice(dock_statuses)
                trucks = json.dumps([f"MH-{random.randint(10,50)}-{chr(65+random.randint(0,25))}{chr(65+random.randint(0,25))}-{random.randint(1000,9999)}" for _ in range(random.randint(0, 3))])
                window = f"{8 + slot_i * 2}:00 – {10 + slot_i * 2}:00"
                await db.execute(
                    "INSERT INTO dock_slots (slot_id, dock_id, time_window, truck_ids, booked_count, status, created_at) VALUES (?,?,?,?,?,?,?)",
                    (slot_id, f"DOCK-{dock_i}", window, trucks, random.randint(0, 3), status, (now - timedelta(hours=random.randint(0, 48))).isoformat()),
                )

        # ── route_risks ──
        routes = [
            ("Mumbai → Pune via NH48", 150.0, 180, 42.5, 35, "high", "Mumbai → Pune via Lonavala bypass", "Road construction on NH48 near Khalapur; heavy rainfall forecast", "Rain, 28°C"),
            ("Delhi → Jaipur via NH48", 280.0, 300, 28.0, 20, "medium", "Delhi → Jaipur via Alwar", "Festival traffic near Gurugram toll; moderate fog", "Haze, 22°C"),
            ("Bangalore → Chennai via NH44", 350.0, 360, 18.0, 12, "low", None, "Normal traffic flow; clear weather", "Clear, 32°C"),
            ("Hyderabad → Vijayawada via NH65", 275.0, 280, 55.0, 45, "critical", "Hyderabad → Vijayawada via Suryapet", "Accident-prone stretch near Kodad; flooding reported", "Storm, 26°C"),
            ("Kolkata → Dhanbad via NH19", 260.0, 300, 35.0, 30, "high", "Kolkata → Dhanbad via Raniganj", "Coal truck congestion near Asansol", "Overcast, 30°C"),
            ("Pune → Nashik via NH60", 210.0, 240, 22.0, 15, "medium", None, "Ghat section speed restrictions", "Fog, 20°C"),
            ("Ahmedabad → Vadodara via NE1", 110.0, 90, 12.0, 5, "low", None, "Expressway; minimal congestion", "Clear, 35°C"),
            ("Chennai → Coimbatore via NH44", 500.0, 540, 38.0, 40, "high", "Chennai → Coimbatore via Salem bypass", "Lane closure near Krishnagiri; hilly terrain delays", "Cloudy, 27°C"),
        ]
        for r in routes:
            await db.execute(
                "INSERT INTO route_risks (route, distance_km, base_duration_mins, congestion_pct, predicted_delay_mins, risk_level, suggested_alternate, reasons, weather, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (*r, (now - timedelta(hours=random.randint(0, 24))).isoformat()),
            )

        # ── deliveries ──
        customers = [
            ("DLV-00412-A", "Rajesh Sharma", "Block C, Sector 62, Noida", "201301", "09:00-12:00", 4500.0, 22, "low", "delivered"),
            ("DLV-00413-B", "Priya Menon", "Koramangala 5th Block, Bangalore", "560095", "14:00-17:00", 12800.0, 78, "high", "in_transit"),
            ("DLV-00414-C", "Amit Patel", "CG Road, Navrangpura, Ahmedabad", "380009", "10:00-13:00", 3200.0, 35, "medium", "pending"),
            ("DLV-00415-D", "Sneha Iyer", "Anna Nagar West, Chennai", "600040", "16:00-19:00", 8900.0, 56, "medium", "in_transit"),
            ("DLV-00416-E", "Vikram Singh", "Connaught Place, New Delhi", "110001", "09:00-11:00", 22000.0, 91, "critical", "pending"),
            ("DLV-00417-F", "Anjali Deshmukh", "Kothrud, Pune", "411038", "11:00-14:00", 6700.0, 44, "medium", "delivered"),
            ("DLV-00418-G", "Rahul Bose", "Salt Lake, Kolkata", "700091", "13:00-16:00", 15400.0, 82, "high", "pending"),
            ("DLV-00419-H", "Meera Nair", "Jubilee Hills, Hyderabad", "500033", "10:00-13:00", 9200.0, 38, "low", "delivered"),
            ("DLV-00420-I", "Karan Malhotra", "Bandra West, Mumbai", "400050", "15:00-18:00", 31000.0, 88, "critical", "in_transit"),
            ("DLV-00421-J", "Deepa Krishnan", "MG Road, Kochi", "682016", "09:00-12:00", 5600.0, 29, "low", "delivered"),
            ("DLV-00422-K", "Suresh Reddy", "Madhapur, Hyderabad", "500081", "14:00-17:00", 7800.0, 62, "high", "pending"),
            ("DLV-00423-L", "Fatima Khan", "Residency Road, Lucknow", "226001", "11:00-14:00", 4100.0, 47, "medium", "in_transit"),
        ]
        for c in customers:
            await db.execute(
                "INSERT INTO deliveries (delivery_id, customer_name, address, pincode, time_slot, order_value, risk_score, risk_level, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (*c, (now - timedelta(hours=random.randint(0, 72))).isoformat()),
            )

        # ── agent_events ──
        # Agent events are generated live via OpenRouter LLM calls during demo.
        # No seed data needed — use "Run All Agents" button in Agent Monitor.

        await db.commit()
        return {"status": "seeded", "tables": ALLOWED_TABLES}
    finally:
        await db.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
