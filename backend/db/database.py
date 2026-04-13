import aiosqlite
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "fleetlabs.db")


async def _ensure_columns(db: aiosqlite.Connection, table: str, columns: dict[str, str]):
    schema_rows = await (await db.execute(f"PRAGMA table_info({table})")).fetchall()
    existing = {row["name"] for row in schema_rows}
    for column, definition in columns.items():
        if column not in existing:
            await db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH, timeout=20)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA busy_timeout = 20000")
    await db.execute("PRAGMA journal_mode = WAL")
    await db.execute("PRAGMA synchronous = NORMAL")
    return db

async def init_db():
    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS inventory_scans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id TEXT NOT NULL,
                image_url TEXT,
                item_count INTEGER,
                schema_columns TEXT,
                items TEXT,
                natural_language_query TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS inventory_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id TEXT NOT NULL,
                item_id INTEGER,
                label TEXT,
                confidence REAL,
                bbox TEXT,
                area REAL,
                ocr_texts TEXT,
                source TEXT,
                brand TEXT,
                category TEXT,
                count INTEGER,
                location TEXT,
                condition TEXT,
                evidence TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS damage_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                shipment_id TEXT,
                checkpoint TEXT,
                damage_type TEXT,
                confidence REAL,
                severity TEXT,
                lat REAL,
                lng REAL,
                image_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS dock_slots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slot_id TEXT,
                dock_id TEXT,
                time_window TEXT,
                truck_ids TEXT,
                booked_count INTEGER,
                status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS agent_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_name TEXT,
                event_type TEXT,
                payload TEXT,
                severity TEXT,
                human_decision TEXT,
                decided_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS route_risks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                route TEXT,
                distance_km REAL,
                base_duration_mins INTEGER,
                congestion_pct REAL,
                predicted_delay_mins INTEGER,
                risk_level TEXT,
                suggested_alternate TEXT,
                reasons TEXT,
                weather TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                delivery_id TEXT,
                customer_name TEXT,
                address TEXT,
                pincode TEXT,
                time_slot TEXT,
                order_value REAL,
                risk_score INTEGER,
                risk_level TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        await _ensure_columns(
            db,
            "route_risks",
            {
                "origin_name": "TEXT",
                "origin_lat": "REAL",
                "origin_lng": "REAL",
                "destination_name": "TEXT",
                "destination_lat": "REAL",
                "destination_lng": "REAL",
                "route_geometry": "TEXT",
            },
        )
        await _ensure_columns(
            db,
            "deliveries",
            {
                "route_id": "INTEGER",
                "destination_lat": "REAL",
                "destination_lng": "REAL",
            },
        )
        await db.commit()
    finally:
        await db.close()
