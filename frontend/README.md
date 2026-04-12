# FleetLabs Frontend

Frontend for the FleetLabs operations dashboard built with Next.js, React, Tailwind CSS, Leaflet, and Recharts.

## Features

- Inventory scanning UI
- Damage, load, route, and truck-flow dashboards
- Agent approval and rejection workflows
- Live SSE-backed event updates

## Stack

- Next.js 16
- React 19
- Tailwind CSS 4
- Leaflet
- Recharts
- Radix UI primitives

## Setup

```bash
npm install
```

Create a local `.env.local` file with:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

Run the app:

```bash
npm run dev
```

Build for production:

```bash
npm run build
npm run start
```

## Project Structure

- `app/` routes and layouts
- `components/` dashboard and UI components
- `hooks/` frontend hooks
- `lib/` API and utility helpers

## Notes

- Environment files are ignored by Git.
- This frontend expects the FleetLabs backend API to be running separately.
