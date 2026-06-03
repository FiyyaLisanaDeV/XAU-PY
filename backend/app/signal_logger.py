from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .models import MarketSnapshot, OrderRecommendation, SignalLogEntry

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SIGNAL_LOG_PATH = PROJECT_ROOT / "data" / "potential_signals.jsonl"
MIN_SCORE = 60
DEDUP_WINDOW = timedelta(minutes=30)
SIGNAL_LOG_TIMEZONE = os.getenv("SIGNAL_LOG_TIMEZONE", "Asia/Makassar")
DAY_NAMES_ID = {
    "Monday": "Senin",
    "Tuesday": "Selasa",
    "Wednesday": "Rabu",
    "Thursday": "Kamis",
    "Friday": "Jumat",
    "Saturday": "Sabtu",
    "Sunday": "Minggu",
}
_LOG_LOCK = threading.Lock()


def record_potential_signal(snapshot: MarketSnapshot, signal: OrderRecommendation, path: Path = SIGNAL_LOG_PATH) -> SignalLogEntry | None:
    if signal.score < MIN_SCORE:
        return None

    now = localized_now()
    entry = SignalLogEntry(
        id=build_signal_id(signal, now),
        detected_at=now.isoformat(),
        date=now.strftime("%Y-%m-%d"),
        day=localized_day_name(now),
        time=now.strftime("%H:%M:%S"),
        symbol=signal.symbol,
        timeframe=signal.timeframe,
        score=signal.score,
        side=signal.side,
        orderType=signal.orderType,
        setupType=signal.setupType,
        entry=signal.entry,
        stopLoss=signal.stopLoss,
        takeProfit=signal.takeProfit,
        lot=signal.lot,
        riskPercent=signal.riskPercent,
        spread_points=snapshot.spread_points,
        reasons=signal.reasons,
        blockedReasons=signal.blockedReasons,
        status="blocked" if signal.blockedReasons else "potential",
    )

    with _LOG_LOCK:
        recent = read_signal_log(path, limit=100)
        if any(is_duplicate(item, entry, now) for item in recent):
            return None

        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as file:
            file.write(entry.model_dump_json() + "\n")
    return entry


def read_signal_log(path: Path = SIGNAL_LOG_PATH, limit: int = 200) -> list[SignalLogEntry]:
    if not path.exists():
        return []
    entries: list[SignalLogEntry] = []
    with path.open("r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(SignalLogEntry.model_validate(json.loads(line)))
            except Exception:
                continue
    return list(reversed(entries[-limit:]))


def build_signal_id(signal: OrderRecommendation, now: datetime) -> str:
    side = signal.side.value if signal.side else "WAIT"
    order_type = signal.orderType.value if signal.orderType else "NO_ORDER"
    entry = "none" if signal.entry is None else f"{signal.entry:.5f}"
    bucket = now.strftime("%Y%m%d%H%M")
    return f"{bucket}-{signal.symbol}-{signal.timeframe}-{side}-{order_type}-{entry}-{signal.score}"


def localized_now() -> datetime:
    try:
        return datetime.now(ZoneInfo(SIGNAL_LOG_TIMEZONE))
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).astimezone()


def localized_day_name(value: datetime) -> str:
    return DAY_NAMES_ID.get(value.strftime("%A"), value.strftime("%A"))


def is_duplicate(existing: SignalLogEntry, new_entry: SignalLogEntry, now: datetime) -> bool:
    try:
        existing_time = datetime.fromisoformat(existing.detected_at)
    except ValueError:
        return False
    if now - existing_time > DEDUP_WINDOW:
        return False
    return (
        existing.symbol == new_entry.symbol
        and existing.timeframe == new_entry.timeframe
        and existing.side == new_entry.side
        and existing.orderType == new_entry.orderType
        and existing.setupType == new_entry.setupType
    )
