import base64
import json
import os
from typing import Any

import cv2
import httpx
import numpy as np
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
INVENTORY_MODEL = os.getenv("OPENROUTER_INVENTORY_MODEL", "google/gemini-2.5-flash")
CV_MODEL = os.getenv("OPENROUTER_CV_MODEL", "google/gemini-2.5-flash")


def encode_cv_image(img: np.ndarray, quality: int = 88) -> str:
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode("utf-8")


def strip_json_fences(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def _coerce_message_text(message: Any) -> str:
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        parts: list[str] = []
        for chunk in message:
            if isinstance(chunk, dict) and isinstance(chunk.get("text"), str):
                parts.append(chunk["text"])
            elif isinstance(chunk, str):
                parts.append(chunk)
        return "\n".join(parts)
    return str(message)


def _parse_json_payload(text: str) -> tuple[dict[str, Any] | None, str | None]:
    cleaned = strip_json_fences(text)
    decoder = json.JSONDecoder()

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed, None
        return None, "Model returned JSON, but not a JSON object"
    except json.JSONDecodeError as exc:
        parse_error = exc

    first_brace = cleaned.find("{")
    while first_brace != -1:
        try:
            parsed, end_index = decoder.raw_decode(cleaned[first_brace:])
            if isinstance(parsed, dict):
                trailing = cleaned[first_brace + end_index :].strip()
                if trailing and not trailing.startswith("```"):
                    return parsed, None
                return parsed, None
        except json.JSONDecodeError:
            pass
        first_brace = cleaned.find("{", first_brace + 1)

    return None, f"Model response parse failed: {parse_error}"


def get_workflow_status(analysis: dict[str, Any] | None, error: str | None) -> str:
    if analysis is not None:
        return "success"
    if not error:
        return "unavailable"

    lowered = error.lower()
    if "api_key" in lowered or "401" in lowered or "403" in lowered or "forbidden" in lowered:
        return "unavailable"
    if "parse failed" in lowered or "json" in lowered or "unterminated string" in lowered:
        return "response_error"
    return "unavailable"


def _send_vision_request(*, api_key: str, payload: dict[str, Any]) -> httpx.Response:
    return httpx.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=45.0,
    )


def _call_vision_raw(
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    image_b64: str,
    max_tokens: int = 1800,
) -> tuple[str | None, str | None]:
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        return None, "OPENROUTER_API_KEY missing"

    base_payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                ],
            },
        ],
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }

    try:
        response = _send_vision_request(api_key=api_key, payload=base_payload)
        if response.status_code >= 400 and response.status_code < 500:
            retry_payload = dict(base_payload)
            retry_payload.pop("response_format", None)
            response = _send_vision_request(api_key=api_key, payload=retry_payload)
        response.raise_for_status()
        return _coerce_message_text(response.json()["choices"][0]["message"]["content"]), None
    except Exception as exc:
        return None, str(exc)


def call_vision_json_with_raw(
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    image_b64: str,
    max_tokens: int = 1800,
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    raw_message, error = _call_vision_raw(
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        image_b64=image_b64,
        max_tokens=max_tokens,
    )
    if raw_message is None:
        return None, error, None

    parsed, parse_error = _parse_json_payload(raw_message)
    if parse_error:
        return None, parse_error, raw_message
    return parsed, None, raw_message


def call_vision_json(
    *,
    model: str,
    system_prompt: str,
    user_prompt: str,
    image_b64: str,
    max_tokens: int = 1800,
) -> tuple[dict[str, Any] | None, str | None]:
    parsed, error, _raw_message = call_vision_json_with_raw(
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        image_b64=image_b64,
        max_tokens=max_tokens,
    )
    return parsed, error
