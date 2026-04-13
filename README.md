# FleetLabs

FleetLabs is an operations dashboard for warehouse, fleet, and last-mile workflows.

It combines the following features:
- AI inventory extraction from images
- Cargo damage and load analysis
- Route risk and last-mile monitoring
- Dock vehicle counting and congestion
- Agent-driven proposals with approve/reject workflow

## Demo

https://www.youtube.com/watch?v=wHr2eFKRF-8

## Run locally

### Backend

```bash
cd backend

uv venv .venv
.\.venv\Scripts\Activate.ps1    # Windows PowerShell
# source .venv/bin/activate     # Linux/macOS
uv pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```