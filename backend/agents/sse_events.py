"""
SSE event broadcaster.
Agents push events here; the SSE endpoint streams them to the frontend.
"""

import asyncio
import json
from typing import AsyncGenerator


class SSEBroadcaster:
    """Simple in-memory fan-out for SSE events."""

    def __init__(self):
        self._queues: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._queues.remove(q)

    async def publish(self, event_type: str, data: dict):
        payload = json.dumps({"type": event_type, "data": data})
        for q in self._queues:
            await q.put(payload)

    async def stream(self, queue: asyncio.Queue) -> AsyncGenerator[str, None]:
        try:
            while True:
                payload = await queue.get()
                yield f"data: {payload}\n\n"
        except asyncio.CancelledError:
            pass


broadcaster = SSEBroadcaster()
