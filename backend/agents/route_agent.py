"""
Route Agent — scores delivery routes using OSRM + Open-Meteo + LLM.
"""

import json
import httpx
from db.database import get_db
from agents.base import llm_json
from agents.sse_events import broadcaster

SYSTEM = """You are a logistics route risk analyst. Given route data, weather, and traffic info,
return JSON: {"risk_score": 0-100, "risk_level": "LOW|MODERATE|HIGH|CRITICAL",
"reasons": ["..."], "suggested_alternate": "route description or empty string"}"""

OSRM_URL = "https://router.project-osrm.org/route/v1/driving"
METEO_URL = "https://api.open-meteo.com/v1/forecast"


async def _get_route(origin: tuple[float, float], dest: tuple[float, float]) -> dict:
    """Fetch route from OSRM (free, no key)."""
    coords = f"{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{OSRM_URL}/{coords}", params={"overview": "false"})
        data = r.json()
    if data.get("routes"):
        leg = data["routes"][0]
        return {"distance_km": round(leg["distance"] / 1000, 1), "duration_mins": round(leg["duration"] / 60)}
    return {"distance_km": 0, "duration_mins": 0}


async def _get_weather(lat: float, lon: float) -> dict:
    """Fetch current weather from Open-Meteo (free, no key)."""
    async with httpx.AsyncClient() as client:
        r = await client.get(METEO_URL, params={
            "latitude": lat,
            "longitude": lon,
            "current_weather": "true",
        })
        data = r.json()
    cw = data.get("current_weather", {})
    return {
        "temp_c": cw.get("temperature", 0),
        "windspeed_kmh": cw.get("windspeed", 0),
        "weathercode": cw.get("weathercode", 0),
    }


async def score_route(
    origin: tuple[float, float],
    dest: tuple[float, float],
    delivery_id: str = "unknown",
):
    route = await _get_route(origin, dest)
    weather = await _get_weather(dest[0], dest[1])

    prompt = (
        f"Delivery {delivery_id}\n"
        f"Route: {json.dumps(route)}\n"
        f"Destination weather: {json.dumps(weather)}"
    )

    try:
        decision = await llm_json(SYSTEM, prompt)
    except Exception:
        # heuristic fallback
        score = min(100, int(weather.get("windspeed_kmh", 0) * 1.2 + weather.get("weathercode", 0) * 0.8))
        decision = {
            "risk_score": score,
            "risk_level": "HIGH" if score > 60 else "MODERATE" if score > 30 else "LOW",
            "reasons": [],
            "suggested_alternate": "",
        }

    decision.update(route)

    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO route_risks (delivery_id, origin, destination, risk_score, risk_factors, recommendation)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                delivery_id,
                json.dumps(origin),
                json.dumps(dest),
                decision["risk_score"],
                json.dumps(decision.get("reasons", [])),
                decision.get("suggested_alternate", ""),
            ),
        )
        await db.commit()
    finally:
        await db.close()

    await broadcaster.publish("ROUTE_RISK", {"delivery_id": delivery_id, **decision})
    return decision
