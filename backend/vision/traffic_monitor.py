from __future__ import annotations

import base64
import os
import time
from typing import Any

import cv2


TRUCK_CLASS_ID = 7
CONF_THRESHOLD = float(os.getenv("TRAFFIC_CONF_THRESHOLD", "0.35"))


def _compute_congestion(truck_count: int, avg_displacement: float) -> dict[str, Any]:
    if truck_count == 0:
        return {"level": "Empty", "pct": 0}

    move_score = min(avg_displacement / 40.0, 1.0)
    density_score = min(truck_count / 12.0, 1.0)
    congestion_score = density_score * (1 - move_score)
    pct = int(round(congestion_score * 100))

    if pct >= 70:
        level = "Severe"
    elif pct >= 45:
        level = "Moderate"
    elif pct >= 20:
        level = "Light"
    else:
        level = "Free Flow"

    return {"level": level, "pct": pct}


class TrafficAnalyticsService:
    def __init__(self):
        self.model = None

    def _resolve_model_path(self) -> str:
        configured = os.getenv("TRAFFIC_MODEL_PATH")
        candidates = [
            configured,
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "ST_Traffic_Forecasting", "models", "yolov8n.pt"),
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "yolov8n.pt"),
        ]
        for candidate in candidates:
            if candidate and os.path.exists(candidate):
                return candidate
        raise RuntimeError("No YOLO model found. Set TRAFFIC_MODEL_PATH or keep ST_Traffic_Forecasting/models/yolov8n.pt in the workspace.")

    def _resolve_video_path(self, requested_path: str | None) -> str:
        candidates = [
            requested_path,
            os.getenv("TRAFFIC_VIDEO_PATH"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "Logistics_truck_vid.mp4"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "ST_Traffic_Forecasting", "assets", "temp_video.mp4"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "ST_Traffic_Forecasting", "sttf_demo.mp4"),
        ]
        for candidate in candidates:
            if candidate and os.path.exists(candidate):
                return candidate
        raise RuntimeError("No traffic video source found. Provide a valid local path or keep Logistics_truck_vid.mp4 in the workspace root.")

    def load(self):
        if self.model is not None:
            return

        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError("Traffic analytics requires the 'ultralytics' package in the backend environment.") from exc

        self.model = YOLO(self._resolve_model_path())

    def _track_trucks(self, frame):
        try:
            results = self.model.track(
                frame,
                persist=True,
                conf=CONF_THRESHOLD,
                verbose=False,
                tracker="bytetrack.yaml",
                classes=[TRUCK_CLASS_ID],
            )
        except Exception:
            results = self.model.track(
                frame,
                persist=True,
                conf=CONF_THRESHOLD,
                verbose=False,
                classes=[TRUCK_CLASS_ID],
            )

        result = results[0]
        annotated = result.plot()
        tracks: list[tuple[float, float, int]] = []

        if result.boxes is None or len(result.boxes) == 0:
            return 0, annotated, tracks

        xyxy = result.boxes.xyxy.cpu().numpy()
        if result.boxes.id is not None:
            tracker_ids = result.boxes.id.cpu().numpy().astype(int)
        else:
            tracker_ids = list(range(len(xyxy)))

        for box, track_id in zip(xyxy, tracker_ids):
            center_x = float((box[0] + box[2]) / 2)
            center_y = float((box[1] + box[3]) / 2)
            tracks.append((center_x, center_y, int(track_id)))

        return len(tracks), annotated, tracks

    def stream(self, source: str, path: str | None, max_seconds: int | None, frame_stride: int | None):
        self.load()

        if source == "camera":
            capture = cv2.VideoCapture(0)
            source_label = "Camera 0"
        else:
            resolved_path = self._resolve_video_path(path)
            capture = cv2.VideoCapture(resolved_path)
            source_label = resolved_path

        if not capture.isOpened():
            raise RuntimeError("Unable to open the selected traffic source.")

        fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
        max_frames = int(max(5, min(int(max_seconds or 30), 90)) * fps)
        stride = max(1, min(int(frame_stride or 2), 5))

        processed_frames = 0
        sampled_frames = 0
        total_detections = 0
        peak_detections = 0
        counted_ids: set[int] = set()
        last_positions: dict[int, tuple[float, float]] = {}
        displacement_window: list[float] = []
        started_at = time.time()
        counting_line_y: int | None = None

        try:
            while processed_frames < max_frames:
                ok, frame = capture.read()
                if not ok:
                    break

                processed_frames += 1
                if processed_frames % stride != 0:
                    continue

                detections, annotated, tracks = self._track_trucks(frame)
                sampled_frames += 1
                total_detections += detections
                peak_detections = max(peak_detections, detections)

                frame_height, frame_width = annotated.shape[:2]
                if counting_line_y is None:
                    counting_line_y = int(frame_height * 0.62)

                displacements: list[float] = []
                for center_x, center_y, track_id in tracks:
                    previous = last_positions.get(track_id)
                    if previous is not None:
                        displacement = ((center_x - previous[0]) ** 2 + (center_y - previous[1]) ** 2) ** 0.5
                        displacements.append(displacement)
                        crossed_line = previous[1] < counting_line_y <= center_y or previous[1] > counting_line_y >= center_y
                        if crossed_line and track_id not in counted_ids:
                            counted_ids.add(track_id)
                    last_positions[track_id] = (center_x, center_y)

                avg_displacement = sum(displacements) / len(displacements) if displacements else 0.0
                displacement_window.append(avg_displacement)
                if len(displacement_window) > 8:
                    displacement_window.pop(0)
                smoothed_displacement = sum(displacement_window) / len(displacement_window)
                congestion = _compute_congestion(detections, smoothed_displacement)

                cv2.line(annotated, (0, counting_line_y), (frame_width, counting_line_y), (0, 214, 255), 2)
                cv2.putText(annotated, "COUNTING LINE", (16, max(24, counting_line_y - 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 214, 255), 2)
                cv2.putText(annotated, f"Trucks in frame: {detections}", (16, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                cv2.putText(annotated, f"Passed center: {len(counted_ids)}", (16, 54), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (52, 211, 153), 2)

                if frame_width > 960:
                    scale = 960 / frame_width
                    annotated = cv2.resize(annotated, (960, int(frame_height * scale)))

                ok, encoded = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 72])
                if not ok:
                    continue

                yield {
                    "frame": base64.b64encode(encoded).decode(),
                    "n": sampled_frames,
                    "det": detections,
                    "avg": round(total_detections / sampled_frames, 2),
                    "max": peak_detections,
                    "elapsed": round(time.time() - started_at, 1),
                    "congestion": congestion["level"],
                    "congestion_pct": congestion["pct"],
                    "passed": len(counted_ids),
                    "source_label": source_label,
                }
        finally:
            capture.release()

        elapsed_seconds = round(time.time() - started_at, 1)
        yield {
            "done": True,
            "frames": sampled_frames,
            "seconds": elapsed_seconds,
            "avg": round(total_detections / sampled_frames, 2) if sampled_frames else 0.0,
            "max": peak_detections,
            "passed": len(counted_ids),
            "source_label": source_label,
        }