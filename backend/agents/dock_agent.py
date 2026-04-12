"""
Dock Agent — assigns trucks to dock slots, proposes rescheduling.
"""

import json
from db.database import get_db
from agents.base import llm_json
from agents.sse_events import broadcaster

SYSTEM = """You are a dock scheduling agent. Given dock occupancy and incoming trucks,
assign optimal slots. Return JSON:
{"assignments": [{"truck_id": "...", "dock_number": 1, "window": "HH:MM-HH:MM"}],
 "reschedule": [{"truck_id": "...", "reason": "..."}]}"""


async def assign_docks(dock_slots: list[dict], incoming_trucks: list[str]):
    prompt = (
        f"Current dock slots:\n{json.dumps(dock_slots)}\n\n"
        f"Incoming trucks: {json.dumps(incoming_trucks)}"
    )

    try:
        decision = await llm_json(SYSTEM, prompt)
    except Exception:
        # simple round-robin fallback
        available = [s for s in dock_slots if s.get("status") == "available"]
        assignments = []
        reschedule = []
        for i, t in enumerate(incoming_trucks):
            if i < len(available):
                assignments.append({
                    "truck_id": t,
                    "dock_number": available[i]["dock_number"],
                    "window": "next-available",
                })
            else:
                reschedule.append({"truck_id": t, "reason": "No available docks"})
        decision = {"assignments": assignments, "reschedule": reschedule}

    # Persist
    db = await get_db()
    try:
        for a in decision.get("assignments", []):
            await db.execute(
                """UPDATE dock_slots SET status = 'reserved', vehicle_id = ?, updated_at = CURRENT_TIMESTAMP
                   WHERE dock_number = ? AND status = 'available'""",
                (a["truck_id"], a["dock_number"]),
            )
        await db.commit()
    finally:
        await db.close()

    summary = f"Assigned {len(decision.get('assignments', []))} trucks, {len(decision.get('reschedule', []))} rescheduled"
    await broadcaster.publish("DOCK_ASSIGNMENT", {"summary": summary, **decision})

    # Store event
    db2 = await get_db()
    try:
        await db2.execute(
            """INSERT INTO agent_events (agent, event_type, severity, summary, payload)
               VALUES (?, ?, ?, ?, ?)""",
            ("dock_agent", "dock_assignment", "info", summary, json.dumps(decision)),
        )
        await db2.commit()
    finally:
        await db2.close()

    return decision
