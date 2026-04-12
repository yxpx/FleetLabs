import cv2
import numpy as np
from vision.common import CV_MODEL, call_vision_json, encode_cv_image, get_workflow_status


def _fallback_count() -> dict:
    return {
        "vehicle_count": 0,
        "congestion_level": "UNKNOWN",
        "over_capacity_count": 0,
        "estimated_wait_minutes": 0,
        "vehicles": [],
        "message": "AI analysis unavailable. Upload again or check API key.",
    }


def count_vehicles(image_bytes: bytes) -> dict:
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        return {"error": "Invalid image"}

    image_b64 = encode_cv_image(img, quality=86)

    user_prompt = (
        "Count all vehicles visible in this image (cars, trucks, buses, motorcycles, etc).\n\n"
        "Instructions:\n"
        "1. Count every distinct vehicle you can see.\n"
        "2. Classify each vehicle type.\n"
        "3. Assess congestion level: LOW (0-6), MEDIUM (7-14), HIGH (15+).\n"
        "4. Calculate over capacity (vehicles beyond dock capacity of 3).\n"
        "5. Estimate wait time (20 min per over-capacity vehicle).\n\n"
        "Return ONLY valid JSON with this exact schema:\n"
        "{\n"
        '  "vehicle_count": 0,\n'
        '  "congestion_level": "LOW|MEDIUM|HIGH",\n'
        '  "over_capacity_count": 0,\n'
        '  "estimated_wait_minutes": 0,\n'
        '  "vehicles": [{"type": "car|truck|bus|motorcycle|bicycle", "count": 1}],\n'
        '  "message": "one short sentence about the scene"\n'
        "}"
    )

    analysis, error = call_vision_json(
        model=CV_MODEL,
        system_prompt="You are FleetLabs' dock vehicle counting agent powered by Gemini. Count vehicles from dock/yard images. Return strict JSON only.",
        user_prompt=user_prompt,
        image_b64=image_b64,
        max_tokens=800,
    )

    if analysis:
        vehicle_count = int(analysis.get("vehicle_count", 0))
        label_summary: dict[str, int] = {}
        for v in analysis.get("vehicles", []):
            label_summary[v.get("type", "vehicle")] = int(v.get("count", 1))
    else:
        analysis = _fallback_count()
        vehicle_count = 0
        label_summary = {}

    return {
        "vehicle_count": vehicle_count,
        "congestion_level": analysis.get("congestion_level", "UNKNOWN"),
        "over_capacity_count": analysis.get("over_capacity_count", 0),
        "estimated_wait_minutes": analysis.get("estimated_wait_minutes", 0),
        "bounding_boxes": [],
        "preview_b64": image_b64,
        "label_summary": label_summary,
        "model": "gemini-2.5-flash",
        "method": "gemini_vision_direct",
        "message": analysis.get("message", ""),
        "ai_workflow": {
            "enabled": error is None,
            "status": get_workflow_status(analysis if error is None else None, error),
            "provider": "openrouter",
            "model": CV_MODEL,
            "pipeline": "gemini_vision_direct",
            "reason": error,
        },
    }
