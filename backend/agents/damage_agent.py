"""
Damage Agent — evaluates damage scan results, recommends hold/inspect/pass.
"""

import json
from db.database import get_db
from agents.base import llm_json
from agents.sse_events import broadcaster

SYSTEM = """You are a warehouse damage assessment agent. Given damage scan data,
decide the action: HOLD (critical), INSPECT (moderate), or PASS (minor/none).
Return JSON: {"action": "HOLD|INSPECT|PASS", "reason": "...", "priority": 1-5}"""


async def evaluate_damage(scan_result: dict, shipment_id: str = "unknown"):
    prompt = f"Damage scan for shipment {shipment_id}:\n{json.dumps(scan_result)}"

    try:
        decision = await llm_json(SYSTEM, prompt)
    except Exception:
        # fallback heuristic
        sev = scan_result.get("severity", "NONE")
        decision = {
            "action": {"CRITICAL": "HOLD", "MODERATE": "INSPECT"}.get(sev, "PASS"),
            "reason": f"Auto-classified from severity={sev}",
            "priority": {"CRITICAL": 5, "MODERATE": 3}.get(sev, 1),
        }

    # Persist event
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO agent_events (agent, event_type, severity, summary, payload)
               VALUES (?, ?, ?, ?, ?)""",
            (
                "damage_agent",
                "damage_assessment",
                scan_result.get("severity", "NONE"),
                f"Damage agent recommends {decision['action']} for {shipment_id}",
                json.dumps(decision),
            ),
        )
        await db.commit()
    finally:
        await db.close()

    await broadcaster.publish("DAMAGE_ASSESSMENT", {
        "shipment_id": shipment_id,
        **decision,
    })

    return decision
