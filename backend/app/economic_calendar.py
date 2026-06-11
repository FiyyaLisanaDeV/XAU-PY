from __future__ import annotations

import json
from datetime import date, datetime, time, timezone
from hashlib import sha1
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

from .models import EconomicCalendarResponse, EconomicEvent, Symbol

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXPORT_PATH = PROJECT_ROOT / "data" / "economic_calendar.json"
DEFAULT_HTML_EXPORT_DIR = PROJECT_ROOT / "Calender Export"
CURRENCY_SYMBOLS: dict[str, list[Symbol]] = {
    "USD": ["XAUUSD", "EURUSD"],
    "EUR": ["EURUSD"],
}
VISIBLE_IMPACTS = {"medium", "high"}
COUNTRY_NAMES = {
    "US": "United States",
    "EU": "Eurozone",
    "DE": "Germany",
    "FR": "France",
    "IT": "Italy",
    "ES": "Spain",
}


def load_calendar_events(
    path: Path = DEFAULT_EXPORT_PATH,
    html_export_dir: Path = DEFAULT_HTML_EXPORT_DIR,
    now: datetime | None = None,
) -> EconomicCalendarResponse:
    html_path = latest_html_export(html_export_dir)
    if html_path is not None:
        try:
            events = parse_mt5_html_export(html_path, now=now)
            exported_at = datetime.fromtimestamp(html_path.stat().st_mtime, tz=timezone.utc).isoformat()
            return EconomicCalendarResponse(
                source="mt5_html_export",
                configured=True,
                message=f"Loaded {len(events)} Medium/High USD and EUR events from {html_path.name}. Calendar times are interpreted as UTC.",
                exportedAt=exported_at,
                timezone="UTC",
                events=events,
            )
        except Exception as exc:
            html_error = f"Could not read {html_path.name}: {exc}"
    else:
        html_error = f"No .htm or .html export found in {html_export_dir}"

    if not path.exists():
        return EconomicCalendarResponse(
            source="not_configured",
            configured=False,
            message=f"{html_error}. JSON fallback not found at {path}.",
            events=[],
        )

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return EconomicCalendarResponse(
            source="not_configured",
            configured=False,
            message=f"{html_error}. Could not read JSON fallback: {exc}",
            events=[],
        )

    raw_events = raw.get("events", raw if isinstance(raw, list) else [])
    events = [
        event
        for item in raw_events
        if (event := normalize_event(item)) is not None and event.impact in VISIBLE_IMPACTS
    ]
    events.sort(key=lambda item: item.time)
    return EconomicCalendarResponse(
        source="mql5_export",
        configured=True,
        message=f"{html_error}. Loaded {len(events)} Medium/High events from JSON fallback.",
        events=events,
    )


def latest_html_export(directory: Path) -> Path | None:
    if not directory.exists():
        return None
    candidates = [
        item
        for pattern in ("*.htm", "*.html")
        for item in directory.glob(pattern)
        if item.is_file()
    ]
    return max(candidates, key=lambda item: item.stat().st_mtime) if candidates else None


def parse_mt5_html_export(path: Path, now: datetime | None = None) -> list[EconomicEvent]:
    reference = now or datetime.now(timezone.utc)
    text = decode_html_export(path.read_bytes())
    soup = BeautifulSoup(text, "html.parser")
    events: list[EconomicEvent] = []
    current_date: date | None = None

    for row in soup.find_all("tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) == 1 and "week-days" in (cells[0].get("class") or []):
            current_date = parse_export_date(cells[0].get_text(" ", strip=True), reference.date())
            continue
        if current_date is None or len(cells) < 9:
            continue

        values = [cell.get_text(" ", strip=True) for cell in cells]
        currency = values[2].upper()
        impact = normalize_impact(values[4])
        if currency not in CURRENCY_SYMBOLS or impact not in VISIBLE_IMPACTS:
            continue

        event_time = parse_export_time(current_date, values[1])
        if event_time is None:
            continue
        title = values[3].strip() or "Economic event"
        country_code = extract_country_code(cells[0], currency)
        identity = f"{event_time.isoformat()}|{currency}|{title}"
        events.append(
            EconomicEvent(
                id=f"mt5-{sha1(identity.encode('utf-8')).hexdigest()[:16]}",
                time=event_time.isoformat(),
                currency=currency,  # type: ignore[arg-type]
                country=COUNTRY_NAMES.get(country_code, country_code),
                title=title,
                impact=impact,  # type: ignore[arg-type]
                actual=to_optional_string(values[6]),
                forecast=to_optional_string(values[7]),
                previous=to_optional_string(values[8]),
                source="mt5_html",
                affected_symbols=CURRENCY_SYMBOLS[currency],
            )
        )

    events.sort(key=lambda item: item.time)
    return events


def decode_html_export(raw: bytes) -> str:
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_export_date(value: str, reference: date) -> date:
    date_part = value.split(",", 1)[-1].strip()
    parsed = datetime.strptime(f"{date_part} {reference.year}", "%d %B %Y")
    candidates = [
        date(reference.year + offset, parsed.month, parsed.day)
        for offset in (-1, 0, 1)
    ]
    return min(candidates, key=lambda item: abs((item - reference).days))


def parse_export_time(event_date: date, value: str) -> datetime | None:
    try:
        parsed_time = datetime.strptime(value.strip(), "%H:%M").time()
    except ValueError:
        return None
    return datetime.combine(event_date, time(parsed_time.hour, parsed_time.minute), tzinfo=timezone.utc)


def extract_country_code(cell: Any, fallback: str) -> str:
    flag = cell.find("div")
    classes = flag.get("class", []) if flag is not None else []
    return str(classes[0]).upper() if classes else fallback


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
