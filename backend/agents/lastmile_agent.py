"""
Last-Mile Agent — monitors active deliveries, flags risks, proposes actions.
"""

import json
from db.database import get_db
from agents.base import llm_json
from agents.sse_events import broadcaster

SYSTEM = """You are a last-mile delivery risk agent. Given a delivery with route risk data,
decide: REROUTE, DELAY, EXPEDITE, or OK. Return JSON:
{"action": "REROUTE|DELAY|EXPEDITE|OK", "reason": "...", "new_eta": "HH:MM or null"}"""


async def evaluate_delivery(delivery_id: str, route_risk: dict):
    prompt = f"Delivery {delivery_id} route risk:\n{json.dumps(route_risk)}"

    try:
        decision = await llm_json(SYSTEM, prompt)
    except Exception:
        score = route_risk.get("risk_score", 0)
        decision = {
            "action": "REROUTE" if score > 70 else "OK",
            "reason": f"Risk score {score}",
            "new_eta": None,
        }

    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO agent_events (agent, event_type, severity, summary, payload)
               VALUES (?, ?, ?, ?, ?)""",
            (
                "lastmile_agent",
                "delivery_risk",
                "warning" if decision["action"] != "OK" else "info",
                f"Last-mile agent: {decision['action']} for {delivery_id}",
                json.dumps(decision),
            ),
        )
        await db.commit()
    finally:
        await db.close()

    await broadcaster.publish("LASTMILE_DECISION", {"delivery_id": delivery_id, **decision})
    return decision
