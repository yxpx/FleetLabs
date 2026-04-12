# FleetLabs

FleetLabs is an operations dashboard for warehouse, fleet, and last-mile workflows.

## What It Includes

- Inventory image scanning and catalog extraction
- Damage assessment and load analysis views
- Route risk and last-mile monitoring
- Truck flow analytics from video input
- Agent decision workflows with approval and override actions

## Tech Stack

- Frontend: Next.js, React, Tailwind CSS, Leaflet, Recharts
- Backend: FastAPI, SQLite
- AI and vision: OpenRouter-backed vision flows and local video analytics

## Structure

- `frontend/` Next.js application
- `backend/` FastAPI services and local database logic
- `hackx/` older prototype code
- `vision/` standalone vision utilities

## Local Setup

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

## Environment

Do not commit local env files. Create them locally as needed:

### Frontend

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

### Backend

```env
OPENROUTER_API_KEY=your_key_here
OPENROUTER_INVENTORY_MODEL=google/gemini-2.5-flash
OPENROUTER_CV_MODEL=google/gemini-2.5-flash
OPENROUTER_AGENT_MODEL=google/gemini-2.5-flash
```

## Notes

- The repository is configured to ignore local env files, databases, virtual environments, model files, and local video assets.
- If you want model weights or demo media in version control, remove those patterns from `.gitignore` before committing.

---

## Phase 1 — Smart Inventory Intake (Shelf Scanner)

> **Core Idea**: Take a picture of *anything* → AI identifies, segments, counts, and catalogs every item into a structured database.

### Pipeline

```
Camera/Upload → SAM2 (Segment Anything) → Per-segment crops
                                              │
                      ┌───────────────────────┼───────────────────────┐
                      ▼                       ▼                       ▼
               YOLOv8n Detection       EasyOCR (Labels)      CLIP Embedding
               (known objects)         (text on items)       (visual similarity)
                      │                       │                       │
                      └───────────────────────┼───────────────────────┘
                                              ▼
                                   LLM (Qwen3-32B via OpenRouter)
                                   "Structure these items into inventory"
                                              │
                                              ▼
                                   JSON → Supabase inventory table
```

### How It Works

1. **Image Upload** — User takes photo of shelf/pallet/classroom/anything.
2. **SAM2 Auto-Segmentation** — Meta's Segment Anything Model 2 generates masks for every distinct object in the scene. This is the "wow factor" — it separates overlapping items, handles occlusion, works on anything.
3. **Per-Segment Analysis**:
   - **YOLOv8n** — Classify known object types (boxes, bottles, cans, furniture, etc.)
   - **EasyOCR** — Read any text/labels on the items (brand names, SKU codes, expiry dates)
   - **CLIP** (optional) — For items YOLO doesn't know, use CLIP zero-shot to classify ("this looks like a Red Bull can")
4. **LLM Structuring** — All segment data sent to Qwen3-32B:
   - User can optionally specify columns via natural language: *"I want columns for brand, quantity, condition, shelf position"*
   - LLM outputs structured JSON matching the schema
   - Supports optional parameters: item quality (good/damaged/expired), estimated weight, category
5. **Database Insert** — Structured inventory stored in SQLite with full audit trail.

### Optional Natural Language Query

Users can type things like:
- *"Just count the chairs, ignore the people"*
- *"Only catalog items on the top shelf"*
- *"Add a column for expiry date and brand color"*
- *"Group items by category and flag anything that looks damaged"*

The LLM interprets these and adjusts the database schema + filtering accordingly.

### Models Used

| Model | Purpose | Size | Why |
|-------|---------|------|-----|
| **SAM2 (Tiny)** | Instance segmentation of every object | ~40MB | State-of-the-art zero-shot segmentation, runs on CPU |
| **YOLOv8n** | Object detection & classification | ~6MB | Ultra-fast, 80 COCO classes + fine-tunable |
| **EasyOCR** | Text recognition on items | ~50MB | Lightweight, supports 80+ languages, pip install |
| **CLIP ViT-B/32** | Zero-shot image classification | ~340MB | Optional — fallback for unknown items |
| **Qwen3-32B** | Schema generation + data structuring | API | Via OpenRouter, great structured JSON output |

### Libraries

```
segment-anything-2   # Meta SAM2
ultralytics           # YOLOv8
easyocr               # OCR
open-clip-torch       # CLIP (optional)
openai                # OpenRouter client (OpenAI-compatible)
```

---

## Phase 2 — Warehouse & Fleet Vision Intelligence

> **Existing features from v1, refined and expanded.**

### 2A. Damage Detection

**Pipeline**: Image → OpenCV preprocessing → Multi-modal analysis → Agent classification

| Detection Type | Method |
|---------------|--------|
| Physical damage | Canny edge detection → contour analysis → edge density scoring |
| Moisture damage | HSV color space conversion → dark pixel ratio in saturation channel |
| Contamination | HSV hue analysis → red/orange anomaly detection (rust, chemical stains) |
| Object-level | YOLOv8n bounding boxes → per-object damage assessment |

**Severity Classification**:
- `MINOR` (confidence < 0.5) → Log only
- `MODERATE` (0.5–0.75) → Route to inspection hub
- `CRITICAL` (> 0.75 or moisture) → **Hold shipment + trigger insurance claim**

### 2B. Load Estimation

**Pipeline**: Truck interior photo → Grayscale → Gaussian blur → Binary threshold → Pixel counting

**Output**: Fill percentage, loaded/remaining box count, wasted capacity in ₹ (boxes × ₹200)

| Status | Range | Action |
|--------|-------|--------|
| Underloaded | < 70% | Warn about wasted capacity, suggest consolidation |
| Optimal | 70–90% | Clear for departure |
| Overloaded | > 90% | Safety risk warning, weight check |

### 2C. Vehicle Counting & Dock Congestion

**Pipeline**: Video/CCTV feed → MOG2 background subtraction → Morphological ops → Contour detection → Vehicle count per frame

**Congestion Tracking**:
- ≤ 6 vehicles: LOW
- 7–14 vehicles: MEDIUM
- 15+ vehicles: HIGH

Timeline compression: consecutive identical levels collapsed for efficient storage.

### 2D. Chokepoint & Intrusion Detection (NEW)

**Pipeline**: CCTV feed → YOLOv8n person/vehicle detection → ByteTrack multi-object tracking → Zone-based alerting

| Feature | Method |
|---------|--------|
| **Chokepoint Detection** | Define zones on camera feed → track object density per zone → alert when threshold exceeded |
| **Intrusion Detection** | Define restricted zones → alert when any tracked object enters the zone |
| **Dwell Time** | Track how long objects stay in a zone → flag if exceeding threshold |
| **Heatmaps** | Accumulate detection centroids over time → generate warehouse traffic heatmaps |

**Libraries**: `ultralytics` (YOLOv8n) + ByteTrack (via `supervision` library) + OpenCV zone polygons

---

## Phase 3 — Multi-Agent Decision Engine

> **Agents that ACT, not just observe.** Each agent has tool-use capabilities and can take real actions with human-in-the-loop approval.

### Agent Architecture

```
                    ┌─────────────────────┐
                    │    ORCHESTRATOR      │
                    │  Concurrent runner   │
                    │  SSE event emitter   │
                    └──────────┬──────────┘
                               │
          ┌────────┬───────────┼───────────┬────────┐
          ▼        ▼           ▼           ▼        ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────┐
     │  Route  │ │  Dock   │ │LastMile │ │ Damage  │ │ Inventory │
     │  Agent  │ │  Agent  │ │  Agent  │ │  Agent  │ │   Agent   │
     └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └─────┬─────┘
          │           │           │           │             │
          ▼           ▼           ▼           ▼             ▼
    Route risks   Reschedule   Flag risky   Hold/route   Catalog &
    + reroute     dock slots   deliveries   shipments    structure
    suggestions   auto-offset  call-ahead   insurance    items
```

### LLM: Qwen3-32B via OpenRouter

All agents use **Qwen3-32B** through the **OpenRouter** API (OpenAI-compatible endpoint):

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
)

response = client.chat.completions.create(
    model="qwen/qwen3-32b",
    messages=[...],
    response_format={"type": "json_object"},  # Structured output
)
```

### Agent Details

#### Route Agent
- **Data Sources**: OSRM (free routing) + Open-Meteo (free weather)
- **Risk Scoring**: Peak hours (+25), rain (+15/+30), fog (+20), thunderstorm (+35), wind (+15)
- **Actions**: Predicts congestion 4–6 hours ahead → pushes proactive reroute with alternate route + time savings + cost impact
- **Actionable**: User gets "Reroute via NH48-B? Saves 45 min, avoids flooding" → Approve/Reject button

#### Dock Agent
- **Context**: Real-time vehicle count from vision + dock_slots from Supabase
- **Rescheduling Logic**: >3 trucks in 30-min window → auto-offset: truck 4 (+30 min), truck 5 (+60 min), truck 6+ (+90 min)
- **Actions**: `reschedule_dock_slot()` → actually updates the DB slot assignments
- **Actionable**: "5 trucks queued at Dock B, 14:00-14:30. Reschedule trucks #4-5?" → Approve/Reject

#### Last-Mile Risk Agent
- **Risk Scoring (0–100)**: Missing landmark (+20), pincode failure rate (+25), evening slot (+15), high-value order (+10), first-time customer (+10), vague address keywords (+10)
- **Actions**: Score > 65 → `flag_delivery_risk()` + specific action (call ahead / confirm address / reschedule to morning)
- **Actionable**: "Delivery #4421 scored 78 (HIGH). Address vague + evening slot. Call customer?" → Approve/Reject/Override

#### Damage Agent
- **Context**: Latest damage_event from vision pipeline
- **Classification**: MINOR (log) / MODERATE (route to inspection) / CRITICAL (hold + insurance)
- **Actions**: Determines notification targets (sender, transporter, both), triggers insurance API
- **Actionable**: "Shipment #SH-1029 has CRITICAL moisture damage at Checkpoint 3. Hold shipment + file insurance claim?" → Approve/Reject

#### Inventory Agent (NEW)
- **Context**: SAM2 segmentation + YOLO/OCR results from Phase 1
- **Actions**: Structures detected items into inventory → dynamic column creation → Supabase insert
- **Actionable**: "Found 47 Red Bull cans, 12 Monster cans, 3 items damaged. Save to inventory?" → Approve/Edit/Reject

### Human-in-the-Loop Pattern

Every agent action follows this flow:

```
Agent Decision → SSE Event (proposal) → Dashboard Card (with context)
                                              │
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                                 Approve    Reject    Override
                                    │         │         │
                                    ▼         │         ▼
                              Execute action  │   Edit & Execute
                                    │         │         │
                                    └─────────┼─────────┘
                                              ▼
                                     Log decision + outcome
```

---

## Phase 4 — Actionable Dashboard (Human-in-the-Loop)

> **Not a passive display. Every card is interactive. Every agent proposal has Approve/Reject/Override.**

### Pages

| Page | Features |
|------|----------|
| **`/inventory`** | Camera capture/upload → live segmentation preview → item list with edit → NL query box for schema → Save to DB |
| **`/dashboard`** | Overview: KPI stat cards, event feed, route risk table, "Run All Agents" button |
| **`/dashboard/damage`** | Image upload → damage scan results → severity badges → approve/reject hold actions |
| **`/dashboard/dock`** | Live vehicle count → dock slot timeline → reschedule proposals → approve/reject |
| **`/dashboard/load`** | Truck photo upload → fill gauge → capacity warnings → consolidation suggestions |
| **`/dashboard/lastmile`** | Delivery risk table → score badges → per-delivery action buttons (call/confirm/reschedule) |
| **`/dashboard/vision`** | CCTV feed management → zone drawing → chokepoint heatmaps → intrusion alerts |

### Real-Time Architecture

```
Backend (FastAPI) ──SSE──→ useAgentStream hook ──→ EventFeed component
                                                       │
                                              ┌────────┼────────┐
                                              ▼        ▼        ▼
                                          StatCards  Tables  ActionCards
```

- **SSE Events**: ROUTE_UPDATE, DOCK_PROPOSAL, LASTMILE_FLAG, DAMAGE_ALERT, INVENTORY_COMPLETE
- **Agent Action Cards**: Each proposal renders as an interactive card with context, reasoning, and action buttons
- **Export**: PDF/CSV reports for audit trails

---

## Tech Stack

### Frontend

| Tech | Version | Purpose |
|------|---------|---------|
| **Next.js** | 15 | React framework with App Router |
| **React** | 19 | UI library |
| **TypeScript** | 5 | Type safety |
| **Tailwind CSS** | 4 | Utility-first styling |
| **shadcn/ui** | Latest | Component library (Preset: `b1t3rYtKi`) |
| **Lucide React** | Latest | Icons |
| **Recharts** | Latest | Charts & data visualization |

### Backend

| Tech | Version | Purpose |
|------|---------|---------|
| **FastAPI** | 0.111+ | Async Python API framework |
| **Uvicorn** | 0.29+ | ASGI server |
| **SQLite** | 3 | Lightweight local database (via aiosqlite) |
| **httpx** | 0.25+ | Async HTTP client (OSRM, Open-Meteo) |
| **python-multipart** | Latest | File upload handling |

### Computer Vision

| Model/Library | Purpose | Size |
|--------------|---------|------|
| **SAM2 (Tiny/Small)** | Zero-shot instance segmentation | ~40–90MB |
| **YOLOv8n** | Object detection (nano model) | ~6MB |
| **ByteTrack** (via `supervision`) | Multi-object tracking for CCTV | Lightweight |
| **EasyOCR** | Text/label recognition | ~50MB |
| **OpenCV** | Core image/video processing | Standard |
| **CLIP ViT-B/32** | Zero-shot classification (optional) | ~340MB |

### LLM

| Provider | Model | Purpose |
|----------|-------|---------|
| **OpenRouter** | **Qwen3-32B** | All agent reasoning, inventory structuring, NL queries |

### External APIs (Free)

| API | Purpose |
|-----|---------|
| **OSRM** | Open-source route calculation (distance, duration, alternates) |
| **Open-Meteo** | Weather data for route risk scoring |

---

## Design System

Using **shadcn/ui** with a custom preset for consistent, polished design.

### Preset Configuration

| Property | Value |
|----------|-------|
| **Preset ID** | `b1t3rYtKi` |
| **Style** | Lyra |
| **Base Color** | Zinc |
| **Theme** | Blue |
| **Chart Color** | Cyan |
| **Heading Font** | Geist |

### Setup Command

```bash
npx shadcn@latest init --preset b1t3rYtKi
```

### Design Tokens

- **Background**: Dark zinc tones (zinc-950, zinc-900)
- **Primary accent**: Blue (for interactive elements, active states)
- **Charts & data viz**: Cyan (bar charts, gauges, progress indicators)
- **Typography**: Geist for headings, system sans-serif for body
- **Cards**: Rounded corners, subtle zinc-800 borders, zinc-900 backgrounds
- **Stat cards**: Large numerical values with trend indicators (↑↓) and color coding (green/yellow/red)

### Component Patterns

- **Action Cards**: Agent proposals with context panel + Approve/Reject/Override buttons
- **Stat Cards**: KPI display with label, value, trend percent, tone-based color
- **Event Feed**: Real-time scrolling log with severity icons (info/warning/critical)
- **Risk Tables**: Sortable tables with inline risk badges and action buttons
- **Segmentation Preview**: Image overlay showing SAM2 masks with item labels + counts

---

## Models & Libraries Reference

### Python Dependencies

```txt
# Core
fastapi>=0.111.0
uvicorn>=0.29.0
python-multipart
python-dotenv
httpx>=0.25.2

# Database
aiosqlite

# Computer Vision
opencv-python>=4.9.0
ultralytics              # YOLOv8
numpy>=2.0.0
Pillow>=10.3.0
easyocr                  # OCR
supervision              # ByteTrack + annotation utilities

# SAM2
segment-anything-2       # Meta's SAM2 (or sam2 from facebookresearch)
torch                    # PyTorch (CPU-only for hackathon: torch-cpu)
torchvision

# LLM
openai                   # OpenRouter uses OpenAI-compatible API

# Optional
open-clip-torch          # CLIP for zero-shot classification
```

### Model Download Checklist

```bash
# YOLOv8 nano (auto-downloads on first use)
yolo predict model=yolov8n.pt source=test.jpg

# SAM2 tiny checkpoint
wget https://dl.fbaipublicfiles.com/segment_anything_2/sam2_hiera_tiny.pt

# EasyOCR models (auto-download on first use)
python -c "import easyocr; reader = easyocr.Reader(['en'])"
```

---

## Database Schema

### SQLite Tables

```sql
-- Phase 1: Inventory
CREATE TABLE inventory_scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id TEXT NOT NULL,
    image_url TEXT,
    item_count INTEGER,
    schema_columns JSONB,        -- dynamic columns defined by user/LLM
    items JSONB,                 -- array of item objects
    natural_language_query TEXT,  -- user's optional NL instruction
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Phase 2: Vision Events
CREATE TABLE damage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id TEXT,
    checkpoint TEXT,
    damage_type TEXT,            -- physical, moisture, contamination
    confidence FLOAT,
    severity TEXT,               -- MINOR, MODERATE, CRITICAL
    lat FLOAT,
    lng FLOAT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dock_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id TEXT,
    dock_id TEXT,
    time_window TEXT,
    truck_ids JSONB,             -- array of truck IDs
    booked_count INTEGER,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Phase 3: Agent Events & Decisions
CREATE TABLE agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT,
    event_type TEXT,             -- PROPOSAL, ACTION, OVERRIDE
    payload JSONB,
    severity TEXT,               -- info, warning, critical
    human_decision TEXT,         -- approved, rejected, overridden
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE route_risks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route TEXT,
    distance_km FLOAT,
    base_duration_mins INTEGER,
    congestion_pct FLOAT,
    predicted_delay_mins INTEGER,
    risk_level TEXT,
    suggested_alternate TEXT,
    reasons JSONB,
    weather JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id TEXT,
    customer_name TEXT,
    address TEXT,
    pincode TEXT,
    time_slot TEXT,
    order_value FLOAT,
    risk_score INTEGER,
    risk_level TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## API Endpoints

### Inventory (NEW)

```
POST   /inventory/scan              → Upload image → SAM2 + YOLO + OCR → return segments
POST   /inventory/structure         → Send segments + NL query to LLM → return structured JSON
POST   /inventory/save              → Save structured inventory to Supabase
GET    /inventory/{scan_id}         → Retrieve a saved scan
```

### Vision

```
POST   /vision/scan                 → Damage detection on uploaded image
POST   /vision/process-video        → Process CCTV video for vehicle counting
POST   /vision/segment              → SAM2 segmentation of any image
POST   /vision/track                → ByteTrack multi-object tracking on video
GET    /vision/                     → Module status
```

### Agents

```
POST   /agents/dock/run             → Run dock orchestration agent
POST   /agents/lastmile/score       → Score deliveries for last-mile risk
POST   /agents/vision/assess        → Assess damage severity
POST   /agents/route/analyze        → Run route risk analysis
POST   /agents/inventory/structure  → LLM-based inventory structuring
```

### Orchestrator

```
POST   /orchestrator/run            → Run a single named agent
POST   /orchestrator/run-all        → Run all agents concurrently
GET    /orchestrator/route-risks    → List recent route risk assessments
GET    /orchestrator/events         → SSE event stream (real-time)
```

### Actions (Human-in-the-Loop)

```
POST   /actions/{event_id}/approve  → Approve an agent proposal
POST   /actions/{event_id}/reject   → Reject an agent proposal
POST   /actions/{event_id}/override → Override with custom parameters
GET    /actions/pending             → List all pending proposals
```

### Health

```
GET    /health                      → Backend status
GET    /                            → Root check
```

---

## Folder Structure

```
FleetLabs/
├── README.md
├── backend/
│   ├── main.py                      # FastAPI app, routers, CORS, SSE
│   ├── requirements.txt
│   ├── agents/
│   │   ├── orchestrator.py          # Concurrent agent runner + SSE emitter
│   │   ├── route_agent.py           # OSRM + weather → risk scoring
│   │   ├── dock_agent.py            # Vehicle count → slot rescheduling
│   │   ├── lastmile_agent.py        # Delivery risk scoring
│   │   ├── damage_agent.py          # Damage classification + actions
│   │   ├── inventory_agent.py       # NEW: LLM-based inventory structuring
│   │   ├── vision_agent.py          # Vision → agent bridge
│   │   └── sse_events.py            # Event types + broadcast
│   ├── vision/
│   │   ├── segmentor.py             # NEW: SAM2 segmentation pipeline
│   │   ├── damage_detector.py       # OpenCV + YOLO damage analysis
│   │   ├── load_estimator.py        # Fill percentage estimation
│   │   ├── vehicle_counter.py       # MOG2 background subtraction
│   │   ├── tracker.py               # NEW: ByteTrack multi-object tracking
│   │   ├── ocr_reader.py            # NEW: EasyOCR wrapper
│   │   └── zone_monitor.py          # NEW: Chokepoint + intrusion detection
│   ├── db/
│   │   └── database.py              # SQLite connection + init
│   ├── models/
│   │   └── schemas.py               # Pydantic models
│   └── memory/
│       ├── context.txt              # Project context for agents
│       └── prompts.txt              # System prompts for each agent
├── frontend/
│   ├── package.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── app/
│   │   ├── layout.tsx               # Root layout (Geist font, dark theme)
│   │   ├── page.tsx                 # Landing / redirect
│   │   ├── globals.css              # Tailwind + shadcn theme variables
│   │   ├── inventory/
│   │   │   └── page.tsx             # NEW: Shelf scanner + NL query
│   │   └── dashboard/
│   │       ├── page.tsx             # Overview dashboard
│   │       ├── damage/page.tsx
│   │       ├── dock/page.tsx
│   │       ├── load/page.tsx
│   │       ├── lastmile/page.tsx
│   │       └── vision/page.tsx      # NEW: CCTV zone monitoring
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── DashboardShell.tsx
│   │   │   ├── SidebarNav.tsx
│   │   │   ├── TopActionBar.tsx
│   │   │   ├── HeaderBar.tsx
│   │   │   ├── StatCard.tsx
│   │   │   ├── EventFeed.tsx
│   │   │   ├── RouteRiskTable.tsx
│   │   │   └── ActionCard.tsx       # NEW: Agent proposal with approve/reject
│   │   ├── inventory/
│   │   │   ├── CameraCapture.tsx    # NEW: Camera/upload interface
│   │   │   ├── SegmentPreview.tsx   # NEW: SAM2 mask overlay display
│   │   │   ├── ItemList.tsx         # NEW: Editable detected items
│   │   │   └── NLQueryBox.tsx       # NEW: Natural language schema input
│   │   └── vision/
│   │       ├── ZoneDrawer.tsx       # NEW: Draw zones on camera feed
│   │       └── Heatmap.tsx          # NEW: Traffic heatmap overlay
│   └── hooks/
│       ├── useAgentStream.ts        # SSE subscription hook
│       └── useInventoryScan.ts      # NEW: Scan + structure flow
└── models/
    ├── yolov8n.pt                   # YOLOv8 nano weights
    └── sam2_hiera_tiny.pt           # SAM2 tiny checkpoint
```

---

## Development Plan & Task Breakdown

### Sprint 1: Inventory Scanner (Core Differentiator) — PRIORITY

| # | Task | Details | Est. |
|---|------|---------|------|
| 1.1 | SAM2 segmentation endpoint | `/vision/segment` — accept image, return masks + crops | Backend |
| 1.2 | YOLOv8n + EasyOCR per-segment | Run detection + OCR on each SAM2 crop, merge results | Backend |
| 1.3 | LLM inventory structuring | `/inventory/structure` — Qwen3-32B structures segments into JSON with dynamic columns | Backend |
| 1.4 | NL query parsing | Parse user instructions like "just count chairs" into filter/schema config | Backend |
| 1.5 | Inventory scan page (frontend) | Camera capture + upload + segmentation mask preview + item list + NL box | Frontend |
| 1.6 | Supabase inventory table | Create table + insert endpoint + retrieval | Backend |

### Sprint 2: Vision Pipeline Completion

| # | Task | Details |
|---|------|---------|
| 2.1 | Refine damage detector | Ensure YOLO + OpenCV multi-modal scoring works end-to-end |
| 2.2 | Load estimator endpoint | Clean up binary threshold pipeline, add API endpoint |
| 2.3 | Vehicle counter (video) | MOG2 pipeline with configurable frame stride |
| 2.4 | ByteTrack tracking | Add `supervision` library for multi-object tracking |
| 2.5 | Zone monitoring | Define zones via coordinates, detect chokepoints + intrusions |
| 2.6 | Damage page (frontend) | Upload → results → severity → action buttons |
| 2.7 | Load page (frontend) | Upload → fill gauge → status → suggestions |

### Sprint 3: Agent System

| # | Task | Details |
|---|------|---------|
| 3.1 | Migrate to OpenRouter + Qwen3 | Replace Anthropic client with OpenAI client pointing to OpenRouter |
| 3.2 | Route agent | OSRM + Open-Meteo → risk scoring → reroute proposals |
| 3.3 | Dock agent | Vision vehicle count → slot rescheduling with DB writes |
| 3.4 | Last-mile agent | Delivery risk scoring → flag + action recommendations |
| 3.5 | Damage agent | Vision results → severity → hold/route/insurance actions |
| 3.6 | Inventory agent | SAM2 results → LLM structuring → DB insert |
| 3.7 | Orchestrator | Concurrent execution + SSE broadcast |

### Sprint 4: Dashboard & Human-in-the-Loop

| # | Task | Details |
|---|------|---------|
| 4.1 | ActionCard component | Generic card for agent proposals with Approve/Reject/Override |
| 4.2 | Action endpoints | `/actions/{id}/approve`, `/reject`, `/override` |
| 4.3 | SSE event feed | Real-time event stream with severity filtering |
| 4.4 | Dock management page | Live vehicle count + slot timeline + reschedule controls |
| 4.5 | Last-mile risk page | Risk table + per-delivery actions |
| 4.6 | Overview dashboard | KPI cards + event feed + route risks + stat trends |
| 4.7 | CCTV zone page | Zone drawing + heatmap + intrusion alerts |

### Sprint 5: Polish & Demo Prep

| # | Task | Details |
|---|------|---------|
| 5.1 | Demo flow | Scripted walkthrough: shelf scan → inventory → dock → route → delivery |
| 5.2 | Error states | Loading skeletons, error boundaries, empty states |
| 5.3 | Export/reports | PDF/CSV export for audit trails |
| 5.4 | Mobile responsiveness | Ensure dashboard works on tablet for warehouse workers |

---

## Setup & Running

### Prerequisites

- Python 3.10+
- Node.js 18+
- Supabase project (free tier)

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Download models
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# Run
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npx shadcn@latest init --preset b1t3rYtKi
npm run dev
```

### Both (development)

```bash
# Terminal 1
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

---

## Environment Variables

### Backend (`.env`)

```env
OPENROUTER_API_KEY=sk-or-...        # OpenRouter API key for Qwen3-32B
```

### Frontend (`.env.local`)

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

---

## Key Decisions & Rationale

| Decision | Why |
|----------|-----|
| **SAM2 Tiny** over SAM2 Large | Hackathon = speed. Tiny is ~40MB vs 2.5GB, runs on CPU |
| **YOLOv8n** over larger variants | 6MB nano model, sub-10ms inference, 80 COCO classes |
| **EasyOCR** over Tesseract | Better accuracy on scene text, supports curved text, pip install |
| **Qwen3-32B** via OpenRouter | Great structured JSON output, cost-effective, single API for all agents |
| **ByteTrack** via supervision | State-of-the-art MOT, integrates natively with YOLO, pip install |
| **SQLite** over Supabase/PostgreSQL | Zero setup, no external services, single file DB, perfect for hackathon |
| **SSE** over WebSockets | Simpler protocol, sufficient for server→client push, native browser support |
| **Human-in-the-loop** over full automation | Hackathon judges love seeing agency + control. Real-world logistics needs oversight |

---

*FleetLabs — Built for HackX 2026*
