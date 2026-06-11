from __future__ import annotations

from statistics import mean

from .models import Candle, Side
from .strategy import ema


def reversal_score(
    main_side: Side,
    m15_candles: list[Candle],
    m30_candles: list[Candle],
    shock_atr_multiplier: float = 1.5,
) -> tuple[int, list[str]]:
    m15_score, m15_reversal, m15_reasons = _timeframe_reversal_score(
        main_side, m15_candles, shock_atr_multiplier, "M15"
    )
    m30_score, m30_reversal, m30_reasons = _timeframe_reversal_score(
        main_side, m30_candles, shock_atr_multiplier, "M30"
    )
    score = m15_score + m30_score
    reasons = m15_reasons + m30_reasons
    if m15_reversal and m30_reversal:
        score += 15
        reasons.append("M15 and M30 confirm the same reversal")
    return min(score, 100), reasons


def recovery_confirmed(main_side: Side, candles: list[Candle]) -> bool:
    closed = _closed_candles(candles)
    if len(closed) < 22:
        return False
    latest = closed[-1]
    previous = closed[-2]
    fast = ema([candle.close for candle in closed], 21)
    if main_side == Side.BUY:
        return (
            latest.close > latest.open
            and latest.close > fast[-1]
            and latest.close > previous.high
        )
    return (
        latest.close < latest.open
        and latest.close < fast[-1]
        and latest.close < previous.low
    )


def atr_price(candles: list[Candle], period: int = 14) -> float:
    closed = _closed_candles(candles)
    sample = closed[-period:]
    if not sample:
        return 0.0
    return mean(candle.high - candle.low for candle in sample)


def _timeframe_reversal_score(
    main_side: Side,
    candles: list[Candle],
    shock_atr_multiplier: float,
    label: str,
) -> tuple[int, bool, list[str]]:
    closed = _closed_candles(candles)
    if len(closed) < 56:
        return 0, False, []
    latest = closed[-1]
    previous = closed[-2]
    recent = closed[-15:]
    average_range = max(mean(candle.high - candle.low for candle in recent[:-1]), 1e-9)
    average_volume = max(mean(candle.volume for candle in recent[:-1]), 1)
    body = abs(latest.close - latest.open)
    closes = [candle.close for candle in closed]
    fast = ema(closes, 21)
    slow = ema(closes, 55)
    opposite_candle = latest.close < latest.open if main_side == Side.BUY else latest.close > latest.open
    opposite_trend = fast[-1] < slow[-1] if main_side == Side.BUY else fast[-1] > slow[-1]
    crossed_fast = (
        previous.close >= fast[-2] and latest.close < fast[-1]
        if main_side == Side.BUY
        else previous.close <= fast[-2] and latest.close > fast[-1]
    )
    structure_break = (
        latest.close < min(candle.low for candle in closed[-7:-1])
        if main_side == Side.BUY
        else latest.close > max(candle.high for candle in closed[-7:-1])
    )

    score = 0
    reasons: list[str] = []
    if opposite_candle:
        score += 8
        reasons.append(f"{label} candle opposes the main position")
    if body >= average_range * shock_atr_multiplier:
        score += 12
        reasons.append(f"{label} shock candle exceeds ATR threshold")
    if crossed_fast:
        score += 8
        reasons.append(f"{label} close crossed EMA21")
    if opposite_trend:
        score += 10
        reasons.append(f"{label} EMA21/EMA55 reversal alignment")
    if structure_break:
        score += 10
        reasons.append(f"{label} broke recent structure")
    if latest.volume >= average_volume * 1.5:
        score += 5
        reasons.append(f"{label} volume expanded")
    reversal_confirmed = opposite_candle and (opposite_trend or structure_break or crossed_fast)
    return score, reversal_confirmed, reasons


def _closed_candles(candles: list[Candle]) -> list[Candle]:
    return candles[:-1] if len(candles) > 1 else candles
