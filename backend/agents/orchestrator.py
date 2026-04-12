"""
Orchestrator — generates live, schema-compatible agent events for demo sweeps.
"""

import json
import os
from typing import Any

from agents.base import llm_json
from agents.sse_events import broadcaster
from db.database import get_db

DAMAGE_SYSTEM = """You are FleetLabs' damage triage agent.
Given a warehouse damage event, decide one action: HOLD, INSPECT, or PASS.
Return strict JSON with keys: action, reason, priority, summary."""

ROUTE_SYSTEM = """You are FleetLabs' route risk analyst.
Given a risky route, decide whether the route needs REROUTE, MONITOR, or OK.
Return strict JSON with keys: action, risk_score, reason, suggested_alternate, summary."""

LASTMILE_SYSTEM = """You are FleetLabs' last-mile delivery risk agent.
Given a delivery profile, decide one action: REROUTE, DELAY, EXPEDITE, or OK.
Return strict JSON with keys: action, reason, new_eta, summary."""


def _has_openrouter() -> bool:
    return bool(os.getenv("OPENROUTER_API_KEY"))


def _damage_fallback(row: dict[str, Any]) -> dict[str, Any]:
    severity = str(row.get("severity") or "NONE").upper()
    action = "HOLD" if severity == "CRITICAL" else "INSPECT" if severity == "MODERATE" else "PASS"
    priority = 5 if severity == "CRITICAL" else 3 if severity == "MODERATE" else 1
    return {
        "action": action,
        "reason": f"Fallback from severity {severity} at {row.get('checkpoint')}",
        "priority": priority,
        "summary": f"{row.get('shipment_id')}: {action} recommended for {row.get('damage_type')} damage.",
    }


def _route_fallback(row: dict[str, Any]) -> dict[str, Any]:
    risk_level = str(row.get("risk_level") or "low").lower()
    delay = int(row.get("predicted_delay_mins") or 0)
    action = "REROUTE" if risk_level == "critical" else "MONITOR" if risk_level == "high" or delay >= 25 else "OK"
    return {
        "action": action,
        "risk_score": min(100, delay * 2 + int(float(row.get("congestion_pct") or 0))),
        "reason": row.get("reasons") or "Fallback route review based on delay and congestion.",
        "suggested_alternate": row.get("suggested_alternate") or "",
        "summary": f"{row.get('route')}: {action} due to {delay} min predicted delay.",
    }


def _lastmile_fallback(row: dict[str, Any]) -> dict[str, Any]:
    score = int(row.get("risk_score") or 0)
    action = "EXPEDITE" if score >= 85 else "REROUTE" if score >= 70 else "DELAY" if score >= 50 else "OK"
    return {
        "action": action,
        "reason": f"Fallback using delivery risk score {score} for {row.get('customer_name')}",
        "new_eta": None,
        "summary": f"{row.get('delivery_id')}: {action} recommended for {row.get('risk_level')} risk delivery.",
    }


async def _event_exists(db, agent_name: str, event_type: str, token: str) -> bool:
    cursor = await db.execute(
        """SELECT 1 FROM agent_events
           WHERE agent_name = ? AND event_type = ? AND human_decision IS NULL AND payload LIKE ?
           ORDER BY created_at DESC LIMIT 1""",
        (agent_name, event_type, f"%{token}%"),
    )
    return await cursor.fetchone() is not None


async def _insert_event(db, agent_name: str, event_type: str, severity: str, payload: dict[str, Any]):
    await db.execute(
        "INSERT INTO agent_events (agent_name, event_type, payload, severity) VALUES (?, ?, ?, ?)",
        (agent_name, event_type, json.dumps(payload), severity),
    )


async def _evaluate_damage(row: dict[str, Any]) -> dict[str, Any]:
    if not _has_openrouter():
        return _damage_fallback(row)
    try:
        return await llm_json(DAMAGE_SYSTEM, json.dumps(row))
    except Exception:
        return _damage_fallback(row)


async def _evaluate_route(row: dict[str, Any]) -> dict[str, Any]:
    if not _has_openrouter():
        return _route_fallback(row)
    try:
        return await llm_json(ROUTE_SYSTEM, json.dumps(row))
    except Exception:
        return _route_fallback(row)


async def _evaluate_lastmile(row: dict[str, Any]) -> dict[str, Any]:
    if not _has_openrouter():
        return _lastmile_fallback(row)
    try:
        return await llm_json(LASTMILE_SYSTEM, json.dumps(row))
    except Exception:
        return _lastmile_fallback(row)


async def _read_sweep_inputs() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    db = await get_db()
    try:
        damage_rows = await (
            await db.execute(
                """SELECT shipment_id, checkpoint, damage_type, confidence, severity, created_at
                   FROM damage_events
                   WHERE severity IN ('CRITICAL', 'MODERATE')
                   ORDER BY created_at DESC LIMIT 2"""
            )
        ).fetchall()
        route_rows = await (
            await db.execute(
                """SELECT route, distance_km, congestion_pct, predicted_delay_mins, risk_level,
                          suggested_alternate, reasons, weather, created_at
                   FROM route_risks
                   WHERE lower(risk_level) IN ('high', 'critical')
                   ORDER BY predicted_delay_mins DESC, created_at DESC LIMIT 2"""
            )
        ).fetchall()
        delivery_rows = await (
            await db.execute(
                """SELECT delivery_id, customer_name, address, time_slot, order_value,
                          risk_score, risk_level, status, created_at
                   FROM deliveries
                   WHERE lower(risk_level) IN ('high', 'critical')
                   ORDER BY risk_score DESC, created_at DESC LIMIT 2"""
            )
        ).fetchall()
        return [dict(row) for row in damage_rows], [dict(row) for row in route_rows], [dict(row) for row in delivery_rows]
    finally:
        await db.close()


async def run_all_agents() -> dict[str, Any]:
    damage_rows, route_rows, delivery_rows = await _read_sweep_inputs()

    evaluated_damage = []
    for row in damage_rows:
        decision = await _evaluate_damage(row)
        evaluated_damage.append((row, decision))

    evaluated_routes = []
    for row in route_rows:
        decision = await _evaluate_route(row)
        evaluated_routes.append((row, decision))

    evaluated_deliveries = []
    for row in delivery_rows:
        decision = await _evaluate_lastmile(row)
        evaluated_deliveries.append((row, decision))

    created = {"damage_events": 0, "route_events": 0, "lastmile_events": 0}

    db = await get_db()
    try:
        for row, decision in evaluated_damage:
            token = str(row["shipment_id"])
            if await _event_exists(db, "damage_agent", "damage_assessment", token):
                continue
            payload = {"summary": decision.get("summary"), "decision": decision, "input": row}
            severity = "critical" if str(row.get("severity", "")).upper() == "CRITICAL" else "warning"
            await _insert_event(db, "damage_agent", "damage_assessment", severity, payload)
            created["damage_events"] += 1

        for row, decision in evaluated_routes:
            token = str(row["route"])
            if await _event_exists(db, "route_agent", "route_risk_alert", token):
                continue
            payload = {"summary": decision.get("summary"), "decision": decision, "input": row}
            severity = "critical" if str(row.get("risk_level", "")).lower() == "critical" else "warning"
            await _insert_event(db, "route_agent", "route_risk_alert", severity, payload)
            created["route_events"] += 1

        for row, decision in evaluated_deliveries:
            token = str(row["delivery_id"])
            if await _event_exists(db, "lastmile_agent", "delivery_risk", token):
                continue
            payload = {"summary": decision.get("summary"), "decision": decision, "input": row}
            severity = "critical" if int(row.get("risk_score") or 0) >= 85 else "warning"
            await _insert_event(db, "lastmile_agent", "delivery_risk", severity, payload)
            created["lastmile_events"] += 1

        pending = await (await db.execute("SELECT COUNT(*) as c FROM agent_events WHERE human_decision IS NULL")).fetchone()
        summary = {
            "summary": (
                f"Sweep created {created['damage_events']} damage, {created['route_events']} route, "
                f"and {created['lastmile_events']} last-mile proposals."
            ),
            "created": created,
            "pending_after_sweep": pending["c"],
            "llm_enabled": _has_openrouter(),
        }
        await _insert_event(db, "orchestrator", "sweep_complete", "info", summary)
        await db.commit()
    finally:
        await db.close()

    await broadcaster.publish("ORCHESTRATOR_SWEEP", summary)
    return summary
