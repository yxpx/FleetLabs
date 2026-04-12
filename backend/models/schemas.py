from pydantic import BaseModel
from typing import Optional


class InventoryScanRequest(BaseModel):
    natural_language_query: Optional[str] = None


class InventoryStructureRequest(BaseModel):
    segments: list[dict]
    natural_language_query: Optional[str] = None


class InventorySaveRequest(BaseModel):
    scan_id: str
    items: list[dict]
    schema_columns: list[str]
    natural_language_query: Optional[str] = None
    item_count: Optional[int] = None


class DamageEvent(BaseModel):
    shipment_id: str
    checkpoint: str
    damage_type: str
    confidence: float
    severity: str
    lat: Optional[float] = None
    lng: Optional[float] = None


class DockSlot(BaseModel):
    slot_id: str
    dock_id: str
    time_window: str
    truck_ids: list[str]


class AgentActionRequest(BaseModel):
    override_params: Optional[dict] = None


class LocationPoint(BaseModel):
    label: str
    lat: float
    lng: float
    address: Optional[str] = None


class RoutePreviewRequest(BaseModel):
    origin: LocationPoint
    destination: LocationPoint


class DeliveryRouteCreateRequest(BaseModel):
    origin: LocationPoint
    destination: LocationPoint
    customer_name: str
    address: str
    pincode: Optional[str] = None
    time_slot: str
    order_value: float
    delivery_id: Optional[str] = None


class VisionScanResult(BaseModel):
    damage_detected: bool
    damage_type: str
    confidence: float
    damage_regions: list[dict]
    moisture_score: float


class LoadEstimateResult(BaseModel):
    fill_percentage: float
    status: str
    boxes_loaded: int
    boxes_remaining: int
    wasted_capacity_inr: float
    message: str


class VehicleCountResult(BaseModel):
    vehicle_count: int
    congestion_level: str
    label_summary: dict[str, int] = {}


class RouteRisk(BaseModel):
    route: str
    distance_km: float
    base_duration_mins: int
    congestion_pct: float
    predicted_delay_mins: int
    risk_level: str
    suggested_alternate: str
    reasons: list[str]
