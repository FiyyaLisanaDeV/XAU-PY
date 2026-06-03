from __future__ import annotations

from statistics import mean

from .models import (
    Candle,
    IndicatorSet,
    MarketSnapshot,
    OrderRecommendation,
    OrderType,
    RiskMode,
    Side,
    Symbol,
    Timeframe,
    Zone,
)

MAX_SPREAD: dict[Symbol, float] = {"XAUUSD": 350.0, "GBPUSD": 18.0, "EURUSD": 18.0}


def sma(values: list[float], period: int) -> list[float]:
    result: list[float] = []
    for idx in range(len(values)):
        start = max(0, idx - period + 1)
        result.append(round(mean(values[start : idx + 1]), 5))
    return result


def ema(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    result = [values[0]]
    for value in values[1:]:
        result.append(round(value * k + result[-1] * (1 - k), 5))
    return result


def build_indicators(candles: list[Candle]) -> IndicatorSet:
    closes = [c.close for c in candles]
    return IndicatorSet(
        ema_fast=ema(closes, 21),
        ema_slow=ema(closes, 55),
        ma_fast=sma(closes, 20),
        ma_slow=sma(closes, 50),
    )


def detect_zones(candles: list[Candle]) -> list[Zone]:
    recent = candles[-48:]
    if not recent:
        return []
    highs = sorted(c.high for c in recent)
    lows = sorted(c.low for c in recent)
    support = mean(lows[:5])
    resistance = mean(highs[-5:])
    swing_low = min(lows)
    swing_high = max(highs)
    fib_618 = swing_high - (swing_high - swing_low) * 0.618
    span = (swing_high - swing_low) * 0.015
    return [
        Zone(kind="SNR", label="Support cluster", low=round(support - span, 5), high=round(support + span, 5), strength=4),
        Zone(kind="SNR", label="Resistance cluster", low=round(resistance - span, 5), high=round(resistance + span, 5), strength=4),
        Zone(kind="SND", label="Demand zone", low=round(swing_low, 5), high=round(swing_low + span * 2, 5), strength=3),
        Zone(kind="SND", label="Supply zone", low=round(swing_high - span * 2, 5), high=round(swing_high, 5), strength=3),
        Zone(kind="FIB", label="Fib 61.8 retracement", low=round(fib_618 - span, 5), high=round(fib_618 + span, 5), strength=4),
    ]


def build_snapshot(symbol: Symbol, timeframe: Timeframe, candles: list[Candle], bid: float, ask: float, spread: float) -> MarketSnapshot:
    indicators = build_indicators(candles)
    bias = "neutral"
    if indicators.ema_fast[-1] > indicators.ema_slow[-1] and indicators.ma_fast[-1] > indicators.ma_slow[-1]:
        bias = "bullish"
    elif indicators.ema_fast[-1] < indicators.ema_slow[-1] and indicators.ma_fast[-1] < indicators.ma_slow[-1]:
        bias = "bearish"
    return MarketSnapshot(
        symbol=symbol,
        timeframe=timeframe,
        bid=bid,
        ask=ask,
        spread_points=spread,
        bias=bias,
        candles=candles,
        indicators=indicators,
        zones=detect_zones(candles),
    )


def recommend(snapshot: MarketSnapshot, risk_mode: RiskMode = RiskMode.PERCENT_EQUITY, risk_value: float = 0.5) -> OrderRecommendation:
    candles = snapshot.candles
    indicators = snapshot.indicators
    close = candles[-1].close
    ema_fast = indicators.ema_fast[-1]
    ema_slow = indicators.ema_slow[-1]
    ma_fast = indicators.ma_fast[-1]
    ma_slow = indicators.ma_slow[-1]
    atr = average_range(candles[-14:])
    bullish = ema_fast > ema_slow and ma_fast > ma_slow
    bearish = ema_fast < ema_slow and ma_fast < ma_slow
    near_zone = nearest_zone(close, snapshot.zones)
    qm = has_quasimodo_shape(candles[-12:])

    reasons: list[str] = []
    score = 0
    side: Side | None = None

    if bullish or bearish:
        score += 24
        side = Side.BUY if bullish else Side.SELL
        reasons.append("EMA/MA trend alignment")
    if near_zone is not None:
        score += 18
        reasons.append(f"Price near {near_zone.kind} {near_zone.label}")
    if pullback_to_average(close, ema_fast, atr):
        score += 16
        reasons.append("Trend pullback near EMA")
    if qm:
        score += 12
        reasons.append("Quasimodo swing structure detected")
    if any(zone.kind == "FIB" and zone.low <= close <= zone.high for zone in snapshot.zones):
        score += 14
        reasons.append("Fibonacci retracement zone active")
    if candles[-1].close > candles[-1].open and side == Side.BUY:
        score += 8
        reasons.append("Bullish confirmation candle")
    if candles[-1].close < candles[-1].open and side == Side.SELL:
        score += 8
        reasons.append("Bearish confirmation candle")

    score = min(score, 100)
    blocked: list[str] = []
    if side is None:
        blocked.append("No directional trend alignment")
    if score < 60:
        blocked.append("Confluence score below 60")
    if snapshot.spread_points > MAX_SPREAD[snapshot.symbol]:
        blocked.append(f"Spread is above strategy limit ({snapshot.spread_points:g}/{MAX_SPREAD[snapshot.symbol]:g} pts)")

    if side == Side.BUY:
        entry = round(snapshot.ask if close >= ema_fast else close, 5)
        stop = round(entry - atr * 1.45, 5)
        target = round(entry + atr * 2.2, 5)
        order_type = OrderType.BUY_MARKET if close >= ema_fast else OrderType.BUY_LIMIT
        setup = "Trend pullback buy"
    elif side == Side.SELL:
        entry = round(snapshot.bid if close <= ema_fast else close, 5)
        stop = round(entry + atr * 1.45, 5)
        target = round(entry - atr * 2.2, 5)
        order_type = OrderType.SELL_MARKET if close <= ema_fast else OrderType.SELL_LIMIT
        setup = "Trend pullback sell"
    else:
        entry = stop = target = None
        order_type = None
        setup = "No trade"

    risk_percent = 0.5 if risk_mode == RiskMode.PERCENT_EQUITY else None
    return OrderRecommendation(
        symbol=snapshot.symbol,
        timeframe=snapshot.timeframe,
        side=side,
        orderType=order_type,
        entry=entry,
        stopLoss=stop,
        takeProfit=target,
        lot=0.01 if not blocked else None,
        riskMode=risk_mode,
        riskValue=risk_value,
        riskPercent=risk_percent,
        score=score,
        setupType=setup,
        reasons=reasons,
        blockedReasons=blocked,
    )


def average_range(candles: list[Candle]) -> float:
    if not candles:
        return 0.001
    return max(mean(c.high - c.low for c in candles), 0.0001)


def nearest_zone(price: float, zones: list[Zone]) -> Zone | None:
    for zone in zones:
        band = max(zone.high - zone.low, abs(price) * 0.0008)
        if zone.low - band <= price <= zone.high + band:
            return zone
    return None


def pullback_to_average(price: float, average: float, atr: float) -> bool:
    return abs(price - average) <= atr * 0.75


def has_quasimodo_shape(candles: list[Candle]) -> bool:
    if len(candles) < 6:
        return False
    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    return highs[-5] < highs[-3] > highs[-1] and lows[-4] > lows[-2] or lows[-5] > lows[-3] < lows[-1] and highs[-4] < highs[-2]
