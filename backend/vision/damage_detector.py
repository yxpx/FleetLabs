import cv2
import numpy as np

from vision.common import CV_MODEL, call_vision_json, encode_cv_image, get_workflow_status

PROMPT_VERSION = "damage-v3-gemini"

DAMAGE_SYSTEM_PROMPT = """You are FleetLabs' damage control engine powered by Gemini.
Assess package, pallet, carton, and cargo damage from images.
Analyze the image directly — look for tears, dents, moisture marks, crushing,
contamination, and any visible packaging compromise.
Return strict JSON only."""


def _fallback_damage() -> dict:
    return {
        "damage_detected": False,
        "damage_type": "unclear",
        "confidence": 0.0,
        "severity": "NONE",
        "damage_regions": [],
        "moisture_score": 0.0,
        "contamination_score": 0.0,
        "message": "AI analysis unavailable. Upload again or check API key.",
        "recommendation": "Manual inspection advised.",
        "evidence": "No AI model response available.",
    }


def detect_damage(image_bytes: bytes) -> dict:
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        return {"error": "Invalid image"}

    image_b64 = encode_cv_image(img, quality=86)

    user_prompt = (
        "Assess cargo or package damage from this image.\n\n"
        "Instructions:\n"
        "1. Carefully examine the image for signs of damage.\n"
        "2. Focus on moisture, tearing, crushing, dents, contamination, and visible packaging compromise.\n"
        "3. Be conservative: if evidence is weak, lower confidence and say unclear.\n"
        "4. Identify specific regions where damage is visible.\n\n"
        "Return ONLY valid JSON with this exact schema:\n"
        "{\n"
        '  "damage_detected": true,\n'
        '  "damage_type": "tear|crush|moisture|contamination|none|unclear",\n'
        '  "confidence": 0.0,\n'
        '  "severity": "NONE|MINOR|MODERATE|CRITICAL",\n'
        '  "damage_regions": [{"label": "top carton corner", "detail": "visible tear on top edge"}],\n'
        '  "moisture_score": 0.0,\n'
        '  "contamination_score": 0.0,\n'
        '  "message": "one short paragraph for operator",\n'
        '  "recommendation": "one action line",\n'
        '  "evidence": "what in the image led to this assessment"\n'
        "}"
    )

    analysis, error = call_vision_json(
        model=CV_MODEL,
        system_prompt=DAMAGE_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        image_b64=image_b64,
        max_tokens=1400,
    )

    result = analysis or _fallback_damage()
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
