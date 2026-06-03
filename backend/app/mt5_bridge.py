from __future__ import annotations

import math
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from .models import AccountStatus, Candle, Symbol, Timeframe

try:
    import MetaTrader5 as mt5  # type: ignore
except Exception:  # pragma: no cover - depends on local terminal/Python version
    mt5 = None


TIMEFRAME_MINUTES: dict[Timeframe, int] = {
    "M15": 15,
    "M30": 30,
    "H1": 60,
    "H4": 240,
    "D1": 1440,
}

BASE_PRICE: dict[Symbol, float] = {
    "XAUUSD": 2348.0,
    "GBPUSD": 1.273,
    "EURUSD": 1.084,
}

POINT_SIZE: dict[Symbol, float] = {
    "XAUUSD": 0.01,
    "GBPUSD": 0.00001,
    "EURUSD": 0.00001,
}


class MT5Bridge:
    def __init__(self) -> None:
        self.demo_only = os.getenv("XAUGBPEUUSD_DEMO_ONLY", "true").lower() != "false"
        self._initialized = False
        self._symbol_map: dict[Symbol, str] = {}

    def initialize(self) -> bool:
        if mt5 is None:
            return False
        if self._initialized:
            return True
        path = os.getenv("MT5_TERMINAL_PATH")
        self._initialized = bool(mt5.initialize(path=path) if path else mt5.initialize())
        return self._initialized

    def status(self) -> AccountStatus:
        if mt5 is None:
            return AccountStatus(
                connected=False,
                demo_mode=True,
                terminal_found=False,
                message="MetaTrader5 Python package or terminal is not available. Market data uses mock mode; execution is blocked.",
            )

        connected = self.initialize()
        if not connected:
            return AccountStatus(
                connected=False,
                demo_mode=True,
                terminal_found=True,
                message="MetaTrader5 package is installed, but no Exness MT5 terminal session is connected.",
            )

        account = mt5.account_info()
        if account is None:
            return AccountStatus(
                connected=False,
                demo_mode=True,
                terminal_found=True,
                message="MT5 initialized, but account info is unavailable. Log in to an Exness demo account.",
            )

        server = getattr(account, "server", None)
        trade_mode = str(getattr(account, "trade_mode", "")).lower()
        return AccountStatus(
            connected=True,
            demo_mode=self.demo_only or "demo" in str(server).lower() or trade_mode == "0",
            terminal_found=True,
            account_login=getattr(account, "login", None),
            server=server,
            equity=float(getattr(account, "equity", 10000.0)),
            balance=float(getattr(account, "balance", 10000.0)),
            currency=getattr(account, "currency", "USD"),
            message="Connected to MT5. Demo-first execution guard is active.",
        )

    def fetch_candles(self, symbol: Symbol, timeframe: Timeframe, count: int = 120) -> list[Candle]:
        if mt5 is not None and self.initialize():
            broker_symbol = self.resolve_symbol(symbol)
            mt5_timeframe = self._map_timeframe(timeframe)
            rates = mt5.copy_rates_from_pos(broker_symbol, mt5_timeframe, 0, count) if broker_symbol else None
            if rates is not None and len(rates) > 0:
                return [
                    Candle(
                        time=datetime.fromtimestamp(int(row["time"]), tz=timezone.utc).isoformat(),
                        open=float(row["open"]),
                        high=float(row["high"]),
                        low=float(row["low"]),
                        close=float(row["close"]),
                        volume=int(row["tick_volume"]),
                    )
                    for row in rates
                ]
        return self._mock_candles(symbol, timeframe, count)

    def tick(self, symbol: Symbol) -> tuple[float, float, float]:
        if mt5 is not None and self.initialize():
            broker_symbol = self.resolve_symbol(symbol)
            tick = mt5.symbol_info_tick(broker_symbol) if broker_symbol else None
            info = mt5.symbol_info(broker_symbol) if broker_symbol else None
            if tick is not None and info is not None:
                point = float(getattr(info, "point", POINT_SIZE[symbol]))
                bid = float(tick.bid)
                ask = float(tick.ask)
                if bid > 0 and ask > 0:
                    return bid, ask, round((ask - bid) / point, 1)

        base = BASE_PRICE[symbol]
        point = POINT_SIZE[symbol]
        spread = 28.0 if symbol == "XAUUSD" else 12.0
        bid = base + math.sin(datetime.now().minute / 7) * point * 120
        ask = bid + spread * point
        return round(bid, 5), round(ask, 5), spread

    def resolve_symbol(self, symbol: Symbol) -> str | None:
        if mt5 is None or not self.initialize():
            return None
        cached = self._symbol_map.get(symbol)
        if cached:
            return cached

        candidates: list[str] = []
        exact = mt5.symbol_info(symbol)
        if exact is not None:
            candidates.append(symbol)

        for pattern in (f"{symbol}*", f"*{symbol}*"):
            matches = mt5.symbols_get(pattern)
            if matches:
                candidates.extend(match.name for match in matches)

        def score(name: str) -> tuple[int, int, int]:
            info = mt5.symbol_info(name)
            tick = mt5.symbol_info_tick(name)
            visible = 1 if info is not None and getattr(info, "visible", False) else 0
            live = 1 if tick is not None and float(getattr(tick, "bid", 0.0)) > 0 and float(getattr(tick, "ask", 0.0)) > 0 else 0
            suffix_penalty = len(name.replace(symbol, ""))
            return live, visible, -suffix_penalty

        unique_candidates = list(dict.fromkeys(candidates))
        unique_candidates.sort(key=score, reverse=True)
        for candidate in unique_candidates:
            info = mt5.symbol_info(candidate)
            if info is None:
                continue
            if not getattr(info, "visible", False):
                mt5.symbol_select(candidate, True)
            tick = mt5.symbol_info_tick(candidate)
            if tick is not None and float(getattr(tick, "bid", 0.0)) > 0 and float(getattr(tick, "ask", 0.0)) > 0:
                self._symbol_map[symbol] = candidate
                return candidate
        return None

    def send_order(self, payload: dict[str, Any]) -> tuple[bool, int | None, str]:
        if mt5 is None or not self.initialize():
            return False, None, "MT5 is not connected; order was not sent."
        if self.demo_only:
            account = mt5.account_info()
            server = str(getattr(account, "server", "")).lower() if account else ""
            if "demo" not in server:
                return False, None, "Demo-only guard blocked execution on a non-demo account."
        result = mt5.order_send(payload)
        if result is None:
            return False, None, "MT5 order_send returned no result."
        retcode = getattr(result, "retcode", None)
        ticket = getattr(result, "order", None) or getattr(result, "deal", None)
        ok = retcode in {10008, 10009}
        return ok, int(ticket) if ticket else None, str(getattr(result, "comment", retcode))

    @staticmethod
    def _map_timeframe(timeframe: Timeframe) -> int:
        if mt5 is None:
            return 0
        return {
            "M15": mt5.TIMEFRAME_M15,
            "M30": mt5.TIMEFRAME_M30,
            "H1": mt5.TIMEFRAME_H1,
            "H4": mt5.TIMEFRAME_H4,
            "D1": mt5.TIMEFRAME_D1,
        }[timeframe]

    @staticmethod
    def _mock_candles(symbol: Symbol, timeframe: Timeframe, count: int) -> list[Candle]:
        seed = f"{symbol}-{timeframe}"
        rng = random.Random(seed)
        minutes = TIMEFRAME_MINUTES[timeframe]
        base = BASE_PRICE[symbol]
        point = POINT_SIZE[symbol]
        drift = 0.18 if symbol == "XAUUSD" else 0.00004
        if timeframe in {"H4", "D1"}:
            drift *= 1.8
        price = base - drift * count * 0.35
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        candles: list[Candle] = []
        for idx in range(count):
            wave = math.sin(idx / 7.5) * point * (260 if symbol == "XAUUSD" else 90)
            impulse = drift + wave
            open_price = price
            close = open_price + impulse + rng.uniform(-1, 1) * point * (80 if symbol == "XAUUSD" else 35)
            high = max(open_price, close) + abs(rng.uniform(12, 80) * point)
            low = min(open_price, close) - abs(rng.uniform(12, 80) * point)
            price = close
            candles.append(
                Candle(
                    time=(now - timedelta(minutes=minutes * (count - idx))).isoformat(),
                    open=round(open_price, 5),
                    high=round(high, 5),
                    low=round(low, 5),
                    close=round(close, 5),
                    volume=rng.randint(350, 2200),
                )
            )
        return candles
