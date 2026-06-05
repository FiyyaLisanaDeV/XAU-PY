from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import EconomicCalendarResponse, EconomicEvent, Symbol

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXPORT_PATH = PROJECT_ROOT / "data" / "economic_calendar.json"
CURRENCY_SYMBOLS: dict[str, list[Symbol]] = {
    "USD": ["XAUUSD", "EURUSD"],
    "EUR": ["EURUSD"],
}


def load_calendar_events(path: Path = DEFAULT_EXPORT_PATH) -> EconomicCalendarResponse:
    if not path.exists():
        return EconomicCalendarResponse(
            source="not_configured",
            configured=False,
            message=f"MQL5 calendar export not found at {path}. Run the MQL5 exporter script from MetaTrader 5 to enable real economic events.",
            events=[],
        )

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return EconomicCalendarResponse(
            source="not_configured",
            configured=False,
            message=f"Could not read MQL5 calendar export: {exc}",
            events=[],
        )

    raw_events = raw.get("events", raw if isinstance(raw, list) else [])
    events = [event for item in raw_events if (event := normalize_event(item)) is not None]
    events.sort(key=lambda item: item.time)
    return EconomicCalendarResponse(
        source="mql5_export",
        configured=True,
        message=f"Loaded {len(events)} economic events from MQL5 export. Times are expected in broker/server or ISO export time.",
        events=events,
    )


def normalize_event(item: dict[str, Any]) -> EconomicEvent | None:
    currency = str(item.get("currency", "")).upper()
    if currency not in CURRENCY_SYMBOLS:
        return None
    impact = normalize_impact(item.get("impact") or item.get("importance"))
    event_time = normalize_time(item.get("time") or item.get("datetime"))
    title = str(item.get("title") or item.get("name") or item.get("event") or "Economic event").strip()
    return EconomicEvent(
        id=str(item.get("id") or f"{currency}-{event_time}-{title}"),
        time=event_time,
        currency=currency,  # type: ignore[arg-type]
        country=str(item.get("country") or currency),
        title=title,
        impact=impact,
        actual=to_optional_string(item.get("actual")),
        forecast=to_optional_string(item.get("forecast")),
        previous=to_optional_string(item.get("previous") or item.get("prev")),
        source="mql5",
        affected_symbols=CURRENCY_SYMBOLS[currency],
    )


def normalize_impact(value: Any) -> str:
    text = str(value).lower()
    if text in {"3", "high", "important"} or "high" in text:
        return "high"
    if text in {"2", "medium", "moderate"} or "medium" in text:
        return "medium"
    return "low"


def normalize_time(value: Any) -> str:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
    text = str(value or "").strip()
    if not text:
        return datetime.now(timezone.utc).isoformat()
    return text


def to_optional_string(value: Any) -> str | None:
    if value is None or value == "":
        return None
    return str(value)
