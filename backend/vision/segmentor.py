"""Fast inventory pipeline: Gemini Vision direct extraction."""

import cv2
import numpy as np

from vision.common import INVENTORY_MODEL, call_vision_json_with_raw, encode_cv_image, get_workflow_status

PROMPT_VERSION = "inventory-v6-gemini-direct"

VLM_SYSTEM_PROMPT = """You are FleetLabs' visual inventory extraction engine powered by Gemini.
Turn a warehouse, shelf, store, or logistics image into database-ready inventory rows.
Analyze the image directly to identify all visible products, items, and objects.
Prefer specific product or SKU names over generic labels. If a brand is not visible, say "unknown".
Estimate counts conservatively.
Return strict JSON only."""


def _fallback_inventory_analysis(raw_text: str, query: str) -> dict:
    cleaned = " ".join(raw_text.split())[:1200]
    return {
        "items": [
            {
                "name": cleaned[:80] or "unstructured_inventory_result",
                "brand": "unknown",
                "category": "unknown",
                "count": 1,
                "location": "full-frame",
                "condition": "unclear",
                "confidence": 0.2,
                "evidence": cleaned[:240] or (query or "Model returned non-structured output"),
            }
        ] if cleaned else [],
        "total_items": 1 if cleaned else 0,
        "summary": cleaned or "Model returned non-structured output.",
        "query_answer": cleaned[:240] if cleaned else None,
        "raw_output": raw_text,
    }


def segment_and_analyze(image_bytes: bytes, query: str = "") -> dict:
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        return {"error": "Invalid image"}

    image_b64 = encode_cv_image(img, quality=86)

    user_prompt = (
        "Extract inventory from this image into database-ready rows.\n\n"
        "Instructions:\n"
        "1. Identify all visible products, packages, containers, and items.\n"
        "2. Prefer readable product names and brands over generic descriptions.\n"
        "3. Estimate count and location for each item.\n"
        "4. If uncertain, keep the item but lower confidence and explain why.\n"
        "5. Provide approximate bounding box as [x1, y1, x2, y2] percentage of image dimensions.\n\n"
        f"User query: {query or 'None'}\n\n"
        "Return ONLY valid JSON with this exact schema:\n"
        "{\n"
        '  "items": [\n'
        "    {\n"
        '      "name": "specific product or item name",\n'
        '      "brand": "brand name or unknown",\n'
        '      "category": "beverage|carton|electronics|apparel|tool|food|container|unknown",\n'
        '      "count": 1,\n'
        '      "location": "top-left|top-center|middle-left|middle|bottom-right|full-frame",\n'
        '      "condition": "good|damaged|unclear",\n'
        '      "confidence": 0.0,\n'
        '      "evidence": "short reason referencing visible label, brand text, or packaging shape"\n'
        "    }\n"
        "  ],\n"
        '  "total_items": 0,\n'
        '  "summary": "one short paragraph",\n'
        '  "query_answer": "short answer or null"\n'
        "}"
    )

    analysis, error, raw_output = call_vision_json_with_raw(
        model=INVENTORY_MODEL,
        system_prompt=VLM_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        image_b64=image_b64,
        max_tokens=2200,
    )

    if analysis is not None:
        raw_items = analysis.get("items")
        items = raw_items if isinstance(raw_items, list) else []
        total_items = analysis.get("total_items")
        analysis = {
            "items": items,
            "total_items": total_items if isinstance(total_items, int) else len(items),
            "summary": analysis.get("summary") if isinstance(analysis.get("summary"), str) else "",
            "query_answer": analysis.get("query_answer") if isinstance(analysis.get("query_answer"), str) else None,
            "raw_output": raw_output,
        }
    else:
        fallback_text = raw_output or ""
        analysis = _fallback_inventory_analysis(fallback_text, query) if fallback_text else None
        items = analysis.get("items", []) if analysis else []

    label_counts: dict[str, int] = {}
    for item in items:
        cat = item.get("category", "unknown")
        label_counts[cat] = label_counts.get(cat, 0) + item.get("count", 1)

    return {
        "total_segments": len(items),
        "segments": [
            {
                "id": i,
                "label": item.get("name", "unknown"),
                "confidence": item.get("confidence", 0.5),
                "bbox": [],
                "area": 0,
                "ocr_texts": [item.get("brand", "")] if item.get("brand") and item["brand"] != "unknown" else [],
                "source": "gemini",
            }
            for i, item in enumerate(items)
        ],
        "label_summary": label_counts,
        "preview_b64": image_b64,
        "segmentation_model": "gemini-2.5-flash",
        "query": query,
        "ai_analysis": analysis,
        "ai_workflow": {
            "enabled": analysis is not None,
            "status": get_workflow_status(analysis, error),
            "provider": "openrouter",
            "model": INVENTORY_MODEL,
            "prompt_version": PROMPT_VERSION,
            "image_strategy": "single_image_direct",
            "context_strategy": "strict_json_with_raw_fallback",
            "pipeline": "gemini_vision_direct",
            "reason": error,
        },
    }
