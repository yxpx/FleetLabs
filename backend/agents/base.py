"""
Base agent helper — shared OpenRouter / Qwen3-32B call logic.
"""

import os
import json
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
MODEL = os.getenv("OPENROUTER_AGENT_MODEL", "google/gemini-2.5-flash")


def _client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=os.getenv("OPENROUTER_API_KEY", ""),
        base_url=OPENROUTER_BASE,
    )


async def llm_json(system_prompt: str, user_prompt: str) -> dict:
    """Call LLM and parse the response as JSON."""
    client = _client()
    resp = await client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
        max_tokens=2048,
    )
    text = resp.choices[0].message.content or ""
    # strip markdown fences if present
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    return json.loads(text)


async def llm_text(system_prompt: str, user_prompt: str) -> str:
    """Call LLM and return plain text response."""
    client = _client()
    resp = await client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
        max_tokens=2048,
    )
    return resp.choices[0].message.content or ""
