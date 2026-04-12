import cv2
import numpy as np

from vision.common import CV_MODEL, call_vision_json, encode_cv_image, get_workflow_status

PROMPT_VERSION = "load-v3-gemini"

LOAD_SYSTEM_PROMPT = """You are FleetLabs' load intelligence engine powered by Gemini.
Estimate cargo fill from truck-bed, cargo-bay, or container images.
Analyze the image directly — look at how full the space is, count visible packages,
assess remaining capacity, and estimate economic waste.
Return strict JSON only."""


def _fallback_load() -> dict:
    return {
        "fill_percentage": 50,
        "status": "unclear",
        "boxes_loaded": 0,
        "boxes_remaining": 0,
        "wasted_capacity_inr": 0,
        "message": "AI analysis unavailable. Upload again or check API key.",
        "recommendation": "Manual inspection recommended.",
        "evidence": "No AI model response available.",
    }


def estimate_load(image_bytes: bytes) -> dict:
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        return {"error": "Invalid image"}

    image_b64 = encode_cv_image(img, quality=86)

    user_prompt = (
        "Analyze this truck, container, or cargo bay image for load utilization.\n\n"
        "Instructions:\n"
        "1. Estimate how full the cargo space is as a percentage.\n"
        "2. Count or estimate visible loaded units (boxes, pallets, items).\n"
        "3. Estimate remaining capacity in units.\n"
        "4. Calculate wasted capacity cost in INR (assume ~₹200 per empty unit slot).\n"
        "5. Provide a practical recommendation for the logistics operator.\n\n"
        "Return ONLY valid JSON with this exact schema:\n"
        "{\n"
        '  "fill_percentage": 0,\n'
        '  "status": "underloaded|balanced|optimal|overloaded",\n'
        '  "boxes_loaded": 0,\n'
        '  "boxes_remaining": 0,\n'
        '  "wasted_capacity_inr": 0,\n'
        '  "message": "one short paragraph for operator",\n'
        '  "recommendation": "one action line",\n'
        '  "evidence": "what in the image led to this estimate"\n'
        "}"
    )

    analysis, error = call_vision_json(
        model=CV_MODEL,
        system_prompt=LOAD_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        image_b64=image_b64,
        max_tokens=1200,
    )

    result = analysis or _fallback_load()
    result["preview_b64"] = image_b64
    result["ai_workflow"] = {
        "enabled": analysis is not None,
        "status": get_workflow_status(analysis, error),
        "provider": "openrouter",
        "model": CV_MODEL,
        "prompt_version": PROMPT_VERSION,
        "pipeline": "gemini_vision_direct",
        "reason": error,
    }
    return result
