from __future__ import annotations

import json
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

from .models import OrderRecommendation, Side, Symbol, Timeframe


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
INVESTING_URLS: dict[Symbol, str] = {
    "EURUSD": os.getenv("XAUGBPEUUSD_INVESTING_EURUSD_URL", "https://www.investing.com/currencies/eur-usd-technical"),
    "XAUUSD": os.getenv("XAUGBPEUUSD_INVESTING_XAUUSD_URL", "https://id.investing.com/currencies/xau-usd-technical"),
}
INVESTING_PIVOT_URLS: dict[Symbol, str] = {
    "EURUSD": os.getenv("XAUGBPEUUSD_INVESTING_EURUSD_PIVOT_URL", "https://id.investing.com/technical/pivot-points-fibonacci"),
    "XAUUSD": os.getenv("XAUGBPEUUSD_INVESTING_XAUUSD_PIVOT_URL", "https://id.investing.com/technical/pivot-points-fibonacci"),
}
SYMBOL_ALIASES: dict[Symbol, tuple[str, ...]] = {
    "EURUSD": ("eur/usd", "eur usd", "eurusd"),
    "XAUUSD": ("xau/usd", "xau usd", "xauusd", "gold", "emas"),
}
INVESTING_TIMEFRAME_MAP: dict[Timeframe, str] = {
    "M15": "15m",
    "M30": "30m",
    "H1": "1h",
    "H4": "5h",
    "D1": "1d",
}
INVESTING_TIMEFRAME_LABELS: dict[str, str] = {
    "5m": "5 minutes",
    "15m": "15 minutes",
    "30m": "30 minutes",
    "1h": "1 hour",
    "5h": "5 hours",
    "1d": "1 day",
    "1w": "1 week",
    "1mo": "1 month",
}
MAX_RETRY = int(os.getenv("XAUGBPEUUSD_INVESTING_MAX_RETRY", "3"))
RETRY_DELAY_SECONDS = float(os.getenv("XAUGBPEUUSD_INVESTING_RETRY_DELAY_SECONDS", "5"))
MAX_CACHE_AGE_SECONDS = int(os.getenv("XAUGBPEUUSD_INVESTING_MAX_CACHE_AGE_SECONDS", str(15 * 60)))

ACTION_MAP = {
    "strong buy": "strong_buy",
    "strong sell": "strong_sell",
    "buy": "buy",
    "sell": "sell",
    "neutral": "neutral",
    "sangat beli": "strong_buy",
    "sangat jual": "strong_sell",
    "beli": "buy",
    "jual": "sell",
    "netral": "neutral",
}
PIVOT_LABELS = ("S3", "S2", "S1", "PIVOT", "R1", "R2", "R3")


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def paths_for(symbol: Symbol) -> tuple[Path, Path, Path]:
    prefix = f"investing_{symbol.lower()}".replace("usd", "usd")
    return (
        DATA_DIR / f"{prefix}_technical.json",
        DATA_DIR / f"{prefix}_status.json",
        DATA_DIR / f"{prefix}_backup.json",
    )


def base_status(
    symbol: Symbol,
    sync_status: str,
    message: str,
    attempt: int,
    parser_status: str,
    strategy_use: str,
    data_mode: str,
    using_cache: bool,
    error: str | None,
    cache_age_seconds: int | None = None,
    last_sync_utc: str | None = None,
) -> dict[str, Any]:
    technical_path, _, _ = paths_for(symbol)
    return {
        "investing_data_sync": {
            "source": "Investing.com",
            "symbol": symbol,
            "sync_status": sync_status,
            "data_mode": data_mode,
            "last_sync_utc": last_sync_utc,
            "retry_attempt": attempt,
            "retry_max": MAX_RETRY,
            "cache_available": technical_path.exists(),
            "cache_age_seconds": cache_age_seconds,
            "parser_status": parser_status,
            "strategy_use": strategy_use,
            "using_cache": using_cache,
            "message": message,
            "error": error,
        }
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def cache_age_seconds(symbol: Symbol) -> int | None:
    technical_path, _, _ = paths_for(symbol)
    if not technical_path.exists():
        return None
    return max(0, int(time.time() - technical_path.stat().st_mtime))


def normalize_action(value: str) -> str:
    key = " ".join(value.strip().lower().replace("\xa0", " ").split())
    return ACTION_MAP.get(key, key.replace(" ", "_") or "neutral")


def action_payload(value: str) -> dict[str, str]:
    code = normalize_action(value)
    return {"label": value.strip() or "Neutral", "code": code if code in {"strong_buy", "buy", "neutral", "sell", "strong_sell"} else "neutral"}


def parse_number(value: str) -> float | None:
    cleaned = value.replace("%", "").strip()
    if "," in cleaned and "." not in cleaned:
        cleaned = cleaned.replace(",", ".")
    else:
        cleaned = cleaned.replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def fetch_url(url: str) -> str:
    response = requests.get(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,id;q=0.7",
        },
        timeout=15,
    )
    if response.status_code != 200:
        raise RuntimeError(f"HTTP status bukan 200: {response.status_code}")
    if len(response.text.strip()) < 1000:
        raise RuntimeError("HTML kosong atau terlalu pendek")
    return response.text


def fetch_html(symbol: Symbol) -> str:
    return fetch_url(INVESTING_URLS[symbol])


def fetch_pivot_html(symbol: Symbol) -> str:
    return fetch_url(INVESTING_PIVOT_URLS[symbol])


def parse_technical_html(html: str, symbol: Symbol) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    if not text:
        raise RuntimeError("Parser gagal membaca text halaman")

    indicators: dict[str, Any] = {}
    moving_averages: dict[str, Any] = {}
    pivots: dict[str, Any] = {}
    action_counts = {"buy": 0, "neutral": 0, "sell": 0}
    timeframe_signals = parse_timeframe_signals(soup)
    selected_timeframe = selected_investing_timeframe(timeframe_signals) or "1h"

    for row in soup.select("tr"):
        cells = [" ".join(cell.get_text(" ", strip=True).split()) for cell in row.select("th,td")]
        if len(cells) < 2:
            continue
        label = cells[0]
        action = action_payload(cells[-1])
        value = parse_number(cells[1]) if len(cells) >= 2 else None
        if action["code"] in {"buy", "strong_buy"}:
            action_counts["buy"] += 1
        elif action["code"] in {"sell", "strong_sell"}:
            action_counts["sell"] += 1
        elif action["code"] == "neutral":
            action_counts["neutral"] += 1

        label_upper = label.upper()
        if label_upper.startswith("MA") or "MOVING AVERAGE" in label_upper:
            moving_averages[label] = {"value": value, "action": action, "raw": cells}
        elif label_upper in set(PIVOT_LABELS) or "PIVOT" in label_upper:
            pivots[label] = {"value": value, "raw": cells}
        elif "FIBONACCI" in label_upper:
            pivots.update(extract_fibonacci_pivots(cells, source="technical_fibonacci"))
        elif any(key in label_upper for key in ("RSI", "STOCH", "MACD", "ADX", "WILLIAMS", "CCI", "ATR", "ROC", "BULL", "BEAR", "ULTIMATE")):
            indicators[label] = {"value": value, "action": action, "raw": cells}

    overall = infer_overall(action_counts)
    if not indicators and not moving_averages and overall == "neutral":
        raise RuntimeError("Parser tidak menemukan summary teknikal yang valid")

    return {
        "source": "Investing.com",
        "symbol": symbol,
        "url": INVESTING_URLS[symbol],
        "pivot_url": INVESTING_PIVOT_URLS[symbol],
        "selected_timeframe": selected_timeframe,
        "selected_timeframe_label": INVESTING_TIMEFRAME_LABELS.get(selected_timeframe, selected_timeframe),
        "timeframe_signals": timeframe_signals,
        "app_timeframe_map": INVESTING_TIMEFRAME_MAP,
        "sources": {
            "technical": INVESTING_URLS[symbol],
            "pivot_fibonacci": INVESTING_PIVOT_URLS[symbol],
        },
        "scraped_at_utc": now_utc(),
        "summary": {
            "overall": overall,
            "moving_average": {
                "signal": infer_overall(count_actions(moving_averages)),
                **count_actions(moving_averages),
            },
            "technical_indicators": {
                "signal": infer_overall(count_actions(indicators)),
                **count_actions(indicators),
            },
        },
        "indicators": indicators,
        "moving_averages": moving_averages,
        "pivot_points": pivots,
        "pivot_parser_status": "OK" if pivots else "EMPTY",
        "pivot_error": None if pivots else "Pivot data tidak ditemukan di halaman technical utama.",
    }


def parse_pivot_html(html: str, symbol: Symbol) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    aliases = SYMBOL_ALIASES[symbol]
    pivots: dict[str, Any] = {}

    for table in soup.select("table"):
        header_cells = [" ".join(cell.get_text(" ", strip=True).split()) for cell in table.select("thead th")]
        normalized_headers = [normalize_pivot_label(cell) for cell in header_cells]
        for row in table.select("tr"):
            cells = [" ".join(cell.get_text(" ", strip=True).split()) for cell in row.select("th,td")]
            if len(cells) < 2:
                continue

            first_cell = cells[0]
            first_label = normalize_pivot_label(first_cell)
            if first_label in PIVOT_LABELS:
                pivots[first_label] = {"value": parse_number(cells[1]), "raw": cells, "source": "pivot_fibonacci"}
                continue

            row_text = " ".join(cells).lower()
            if not any(alias in row_text for alias in aliases):
                continue

            for index, cell in enumerate(cells[1:], start=1):
                header = normalized_headers[index] if index < len(normalized_headers) else ""
                if header in PIVOT_LABELS:
                    pivots[header] = {"value": parse_number(cell), "raw": cells, "source": "pivot_fibonacci"}
                    continue
                label = normalize_pivot_label(cell)
                if label in PIVOT_LABELS:
                    next_value = cells[index + 1] if index + 1 < len(cells) else cell
                    pivots[label] = {"value": parse_number(next_value), "raw": cells, "source": "pivot_fibonacci"}

    if not pivots:
        raise RuntimeError("Parser tidak menemukan pivot Fibonacci untuk symbol")
    return pivots


def parse_timeframe_signals(soup: BeautifulSoup) -> dict[str, Any]:
    signals: dict[str, Any] = {}
    for button in soup.select('button[role="tab"][data-test]'):
        key = str(button.get("data-test") or "")
        if key not in INVESTING_TIMEFRAME_LABELS:
            continue
        spans = [" ".join(span.get_text(" ", strip=True).split()) for span in button.select("span")]
        unlocked_spans = [span for span in spans if span and span.lower() not in {"unlock", "buka"}]
        label = unlocked_spans[0] if unlocked_spans else INVESTING_TIMEFRAME_LABELS[key]
        raw_signal = unlocked_spans[-1] if len(unlocked_spans) > 1 else ""
        active = "border-inv-blue" in " ".join(button.get("class", [])) or button.get("aria-selected") == "true"
        locked = any(span.lower() in {"unlock", "buka"} for span in spans)
        signals[key] = {
            "label": label,
            "mapped_label": INVESTING_TIMEFRAME_LABELS[key],
            "signal": action_payload(raw_signal) if raw_signal else {"label": "Locked" if locked else "Neutral", "code": "locked" if locked else "neutral"},
            "active": active,
            "locked": locked,
            "raw": spans,
        }
    return signals


def selected_investing_timeframe(timeframe_signals: dict[str, Any]) -> str | None:
    for key, payload in timeframe_signals.items():
        if payload.get("active"):
            return key
    return None


def normalize_pivot_label(value: str) -> str:
    cleaned = " ".join(value.strip().upper().replace("\xa0", " ").split())
    if cleaned in {"S3", "S2", "S1", "R1", "R2", "R3"}:
        return cleaned
    if cleaned in {"P", "PP", "PIVOT POINT", "PIVOT"}:
        return "PIVOT"
    return cleaned


def extract_fibonacci_pivots(cells: list[str], source: str) -> dict[str, Any]:
    values = [parse_number(cell) for cell in cells[1:]]
    numeric_values = [value for value in values if value is not None]
    if len(numeric_values) < len(PIVOT_LABELS):
        return {}
    return {
        label: {"value": numeric_values[index], "raw": cells, "source": source}
        for index, label in enumerate(PIVOT_LABELS)
    }


def attach_pivot_fibonacci(technical: dict[str, Any], symbol: Symbol) -> None:
    try:
        pivots = parse_pivot_html(fetch_pivot_html(symbol), symbol)
    except Exception as exc:
        if technical.get("pivot_points"):
            technical["pivot_parser_status"] = "TECHNICAL_FALLBACK"
            technical["pivot_error"] = f"Pivot page gagal: {exc}. Memakai row Fibonacci dari halaman technical."
        else:
            technical["pivot_parser_status"] = "FAILED"
            technical["pivot_error"] = str(exc)
        return
    technical["pivot_points"] = pivots
    technical["pivot_parser_status"] = "OK"
    technical["pivot_error"] = None


def count_actions(items: dict[str, Any]) -> dict[str, int]:
    counts = {"buy": 0, "neutral": 0, "sell": 0}
    for item in items.values():
        code = item.get("action", {}).get("code")
        if code in {"buy", "strong_buy"}:
            counts["buy"] += 1
        elif code in {"sell", "strong_sell"}:
            counts["sell"] += 1
        else:
            counts["neutral"] += 1
    return counts


def infer_overall(counts: dict[str, int]) -> str:
    buy = counts.get("buy", 0)
    sell = counts.get("sell", 0)
    if buy >= sell + 6:
        return "strong_buy"
    if sell >= buy + 6:
        return "strong_sell"
    if buy > sell:
        return "buy"
    if sell > buy:
        return "sell"
    return "neutral"


def refresh_investing_data(symbol: Symbol = "EURUSD") -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    technical_path, status_path, backup_path = paths_for(symbol)
    last_error: str | None = None
    for attempt in range(1, MAX_RETRY + 1):
        try:
            technical = parse_technical_html(fetch_html(symbol), symbol)
            attach_pivot_fibonacci(technical, symbol)
            if technical_path.exists():
                shutil.copy2(technical_path, backup_path)
            write_json(technical_path, technical)
            status = base_status(
                symbol,
                "SUCCESS",
                "Scrape berhasil. Data teknikal berhasil diperbarui.",
                attempt,
                "OK",
                "ALLOWED",
                "FRESH",
                False,
                None,
                cache_age_seconds=0,
                last_sync_utc=technical["scraped_at_utc"],
            )
            write_json(status_path, status)
            return status
        except Exception as exc:
            last_error = str(exc)
            status = base_status(symbol, "FAILED", f"Scrape gagal pada percobaan {attempt}/{MAX_RETRY}", attempt, "FAILED", "BLOCKED", "NONE", False, last_error)
            write_json(status_path, status)
            if attempt < MAX_RETRY:
                time.sleep(RETRY_DELAY_SECONDS)

    age = cache_age_seconds(symbol)
    cached = read_json(technical_path)
    if cached and age is not None and age <= MAX_CACHE_AGE_SECONDS:
        status = base_status(
            symbol,
            "CACHE_USED",
            "Scrape gagal, tetapi cache lama masih fresh. Strategy boleh memakai cache.",
            MAX_RETRY,
            "OK",
            "ALLOWED",
            "CACHE",
            True,
            last_error,
            cache_age_seconds=age,
            last_sync_utc=cached.get("scraped_at_utc"),
        )
    else:
        status = base_status(
            symbol,
            "BLOCKED",
            "Scrape gagal dan cache tidak tersedia atau sudah expired. Strategy harus BLOCKED.",
            MAX_RETRY,
            "FAILED",
            "BLOCKED",
            "NONE",
            False,
            last_error,
            cache_age_seconds=age,
        )
    write_json(status_path, status)
    return status


def refresh_all_investing_data() -> dict[str, Any]:
    return {"items": {symbol: refresh_investing_data(symbol) for symbol in INVESTING_URLS}}


def current_status(symbol: Symbol = "EURUSD") -> dict[str, Any]:
    _, status_path, _ = paths_for(symbol)
    status = read_json(status_path)
    if status is not None:
        return status
    status = base_status(symbol, "BLOCKED", "Investing.com sync belum pernah berhasil.", 0, "FAILED", "BLOCKED", "NONE", False, "No status file")
    write_json(status_path, status)
    return status


def all_statuses() -> dict[str, Any]:
    return {"items": {symbol: current_status(symbol) for symbol in INVESTING_URLS}}


def ensure_source_metadata(technical: dict[str, Any], symbol: Symbol) -> dict[str, Any]:
    if not technical:
        return technical
    technical.setdefault("source", "Investing.com")
    technical.setdefault("symbol", symbol)
    technical.setdefault("url", INVESTING_URLS[symbol])
    technical.setdefault("pivot_url", INVESTING_PIVOT_URLS[symbol])
    technical.setdefault("selected_timeframe", "1h")
    technical.setdefault("selected_timeframe_label", INVESTING_TIMEFRAME_LABELS["1h"])
    technical.setdefault("timeframe_signals", {})
    technical.setdefault("app_timeframe_map", INVESTING_TIMEFRAME_MAP)
    technical.setdefault(
        "sources",
        {
            "technical": INVESTING_URLS[symbol],
            "pivot_fibonacci": INVESTING_PIVOT_URLS[symbol],
        },
    )
    if not technical.get("pivot_points") and technical.get("indicators", {}).get("Fibonacci", {}).get("raw"):
        technical["pivot_points"] = extract_fibonacci_pivots(technical["indicators"]["Fibonacci"]["raw"], source="technical_fibonacci_cache")
        if technical["pivot_points"]:
            technical["pivot_parser_status"] = "TECHNICAL_FALLBACK"
            technical["pivot_error"] = "Memakai row Fibonacci dari cache technical."
    technical.setdefault("pivot_parser_status", "EMPTY" if not technical.get("pivot_points") else "OK")
    technical.setdefault("pivot_error", None if technical.get("pivot_points") else "Pivot Fibonacci belum tersimpan di cache.")
    return technical


def current_technical(symbol: Symbol = "EURUSD") -> dict[str, Any]:
    technical_path, _, _ = paths_for(symbol)
    return ensure_source_metadata(read_json(technical_path) or {}, symbol)


def all_technicals() -> dict[str, Any]:
    return {"items": {symbol: current_technical(symbol) for symbol in INVESTING_URLS}}


def apply_investing_filter(signal: OrderRecommendation) -> None:
    if signal.symbol not in INVESTING_URLS:
        return
    sync = current_status(signal.symbol).get("investing_data_sync", {})
    if sync.get("strategy_use") != "ALLOWED":
        signal.blockedReasons.append("Investing.com data sync is not ALLOWED")
        return
    technical = current_technical(signal.symbol)
    investing_timeframe = INVESTING_TIMEFRAME_MAP.get(signal.timeframe, "1h")
    timeframe_signals = technical.get("timeframe_signals", {})
    timeframe_signal = timeframe_signals.get(investing_timeframe) or timeframe_signals.get("1h") or {}
    overall = str(timeframe_signal.get("signal", {}).get("code") or technical.get("summary", {}).get("overall", "neutral"))
    if overall == "locked":
        overall = str(technical.get("summary", {}).get("overall", "neutral"))
    if signal.side == Side.BUY and overall in {"sell", "strong_sell"}:
        signal.blockedReasons.append(f"Investing.com {investing_timeframe} technical filter conflicts with BUY ({overall})")
    if signal.side == Side.SELL and overall in {"buy", "strong_buy"}:
        signal.blockedReasons.append(f"Investing.com {investing_timeframe} technical filter conflicts with SELL ({overall})")
