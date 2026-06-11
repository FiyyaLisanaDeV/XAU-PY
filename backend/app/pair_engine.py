from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from statistics import median

from .models import (
    Candle,
    EconomicCalendarResponse,
    OpenPosition,
    OrderRecommendation,
    PairExposureStatus,
    PairProfile,
    PairState,
    PendingOrder,
    Side,
    Symbol,
)
from .risk import risk_usd_for
from .strategy import ema


@dataclass
class PairGateResult:
    decision: str
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    regime: str = "UNKNOWN"

    @property
    def allowed(self) -> bool:
        return self.decision in {"STRONG_PASS", "PASS"}


def apply_pair_risk_model(
    signal: OrderRecommendation,
    profile: PairProfile,
    candles: list[Candle],
) -> OrderRecommendation:
    if signal.symbol != "EURUSD" or signal.entry is None or signal.side is None:
        return signal
    closed = candles[:-1] if len(candles) > 1 else candles
    sample = closed[-14:]
    if not sample:
        return signal
    pip_size = 0.0001
    atr_pips = sum(max(item.high - item.low, 0.0) for item in sample) / len(sample) / pip_size
    stop_pips = min(max(atr_pips * 2.0, profile.minStopPips), profile.maxStopPips)
    stop_distance = stop_pips * pip_size
    reward_distance = stop_distance * 1.6
    if signal.side == Side.BUY:
        stop_loss = signal.entry - stop_distance
        take_profit = signal.entry + reward_distance
    else:
        stop_loss = signal.entry + stop_distance
        take_profit = signal.entry - reward_distance
    signal.stopLoss = round(stop_loss, 5)
    signal.takeProfit = round(take_profit, 5)
    signal.reasons = list(dict.fromkeys(signal.reasons + [f"EURUSD SL clamp {stop_pips:.1f} pips; TP 1.6R"]))
    return signal


def build_pair_exposure(
    symbol: Symbol,
    profile: PairProfile,
    state: PairState,
    positions: list[OpenPosition],
    pending_orders: list[PendingOrder],
    balance_usd: float,
    equity_usd: float,
    candidate: tuple[float, float, float, Side] | None = None,
    enforce_trade_limits: bool = True,
) -> PairExposureStatus:
    pair_positions = [item for item in positions if item.symbol == symbol]
    pair_pending = [item for item in pending_orders if item.symbol == symbol]
    reasons: list[str] = []
    aggregate_risk = 0.0

    for item in pair_positions:
        if not item.stopLoss:
            reasons.append(f"{symbol} blocked: open position without SL prevents new exposure")
            continue
        aggregate_risk += risk_usd_for(symbol, item.open_price, item.stopLoss, item.volume)
    for item in pair_pending:
        if not item.stopLoss:
            reasons.append(f"{symbol} blocked: pending order without SL prevents new exposure")
            continue
        aggregate_risk += risk_usd_for(symbol, item.entry, item.stopLoss, item.volume)
    if candidate is not None:
        entry, stop_loss, lot, _candidate_side = candidate
        aggregate_risk += risk_usd_for(symbol, entry, stop_loss, lot)

    base = max(min(balance_usd, equity_usd), 0.01)
    aggregate_percent = round(aggregate_risk / base * 100, 3)
    buy_count = sum(1 for item in pair_positions if item.side == Side.BUY)
    sell_count = sum(1 for item in pair_positions if item.side == Side.SELL)
    total_lot = round(sum(item.volume for item in pair_positions) + sum(item.volume for item in pair_pending), 2)
    floating = round(sum(item.profit for item in pair_positions), 2)

    if len(pair_positions) >= profile.maxOpenPositions:
        reasons.append(f"{symbol} blocked: max open positions reached")
    if pair_pending and len(pair_pending) >= profile.maxPendingOrders:
        reasons.append(f"{symbol} blocked: max pending orders reached")
    candidate_lot = candidate[2] if candidate is not None else 0.0
    if total_lot + candidate_lot > profile.maxTotalLot:
        reasons.append(f"{symbol} blocked: max total lot per pair reached")
    candidate_side = candidate[3] if candidate is not None else None
    if candidate_side == Side.BUY and buy_count >= profile.maxSameDirectionPositions:
        reasons.append(f"{symbol} blocked: max BUY positions reached")
    if candidate_side == Side.SELL and sell_count >= profile.maxSameDirectionPositions:
        reasons.append(f"{symbol} blocked: max SELL positions reached")
    opposite_count = sell_count if candidate_side == Side.BUY else buy_count
    if candidate_side is not None and opposite_count >= profile.maxOppositeDirectionPositions and opposite_count > 0:
        reasons.append(f"{symbol} blocked: max opposite-direction positions reached")
    if profile.maxFloatingLossUsd > 0 and floating <= -profile.maxFloatingLossUsd:
        reasons.append(f"{symbol} blocked: floating loss limit reached")
    if enforce_trade_limits and profile.maxDailyTrades > 0 and state.dailyTradeCount >= profile.maxDailyTrades:
        reasons.append(f"{symbol} blocked: daily trade limit reached")
    if enforce_trade_limits and profile.maxHourlyTrades > 0 and state.hourlyTradeCount >= profile.maxHourlyTrades:
        reasons.append(f"{symbol} blocked: hourly trade limit reached")
    if aggregate_percent > profile.aggregateSlRiskCapPercent:
        reasons.append(f"{symbol} blocked: aggregate SL exposure exceeds configured limit")

    now = datetime.now(timezone.utc)
    locked = False
    if state.lockedUntil:
        try:
            locked = datetime.fromisoformat(state.lockedUntil) > now
        except ValueError:
            locked = True
    close_only = profile.closeOnly or state.closeOnlyMode or aggregate_percent > profile.aggregateSlRiskCapPercent
    if close_only:
        status = "CLOSE_ONLY"
        trade_mode = "CLOSE_ONLY"
    elif locked:
        status = "LOCKED"
        trade_mode = "LOCKED"
        reasons.append(state.lockReason or f"{symbol} blocked: pair lock active")
    elif reasons:
        status = "BLOCKED"
        trade_mode = "NORMAL"
    elif aggregate_percent >= profile.aggregateSlRiskCapPercent * 0.70:
        status = "WARNING"
        trade_mode = "NORMAL"
    else:
        status = "SAFE"
        trade_mode = "NORMAL"

    return PairExposureStatus(
        symbol=symbol,
        openPositions=len(pair_positions),
        maxOpenPositions=profile.maxOpenPositions,
        pendingOrders=len(pair_pending),
        maxPendingOrders=profile.maxPendingOrders,
        buyPositions=buy_count,
        sellPositions=sell_count,
        totalLot=total_lot,
        maxTotalLot=profile.maxTotalLot,
        floatingPnlAccount=floating,
        aggregateSlRiskUsd=round(aggregate_risk, 2),
        aggregateSlRiskPercent=aggregate_percent,
        aggregateSlRiskCapPercent=profile.aggregateSlRiskCapPercent,
        status=status,
        tradeMode=trade_mode,
        reasons=list(dict.fromkeys(reasons)),
    )


def classify_market_regime(candles: list[Candle], pivot: float | None = None) -> tuple[str, int]:
    closed = candles[:-1] if len(candles) > 1 else candles
    sample = closed[-20:]
    if len(sample) < 20:
        return "UNKNOWN", 0
    ranges = [max(item.high - item.low, 1e-9) for item in sample]
    bodies = [abs(item.close - item.open) for item in sample]
    atr = sum(ranges) / len(ranges)
    fast = ema([item.close for item in closed], 21)
    slow = ema([item.close for item in closed], 55)
    score = 0
    if abs(fast[-1] - slow[-1]) < 0.35 * atr:
        score += 1
    if count_crosses([item.close for item in sample], fast[-20:]) >= 4:
        score += 1
    if pivot is not None and count_level_crosses([item.close for item in sample], pivot) >= 3:
        score += 1
    path = sum(abs(sample[index].close - sample[index - 1].close) for index in range(1, len(sample)))
    efficiency = abs(sample[-1].close - sample[0].close) / max(path, 1e-9)
    if efficiency < 0.30:
        score += 1
    if median(bodies) < 0.35 * median(ranges):
        score += 1
    alternating = sum(
        1
        for index in range(1, len(sample))
        if (sample[index].close >= sample[index].open) != (sample[index - 1].close >= sample[index - 1].open)
    )
    if alternating >= 11:
        score += 1
    wick_ratios = [(item.high - max(item.open, item.close) + min(item.open, item.close) - item.low) / rng for item, rng in zip(sample, ranges)]
    if median(wick_ratios) > 0.60:
        score += 1
    latest_range = ranges[-1]
    if latest_range >= atr * 2.5:
        return "NEWS_SHOCK", score
    if atr <= max(abs(sample[-1].close) * 0.00008, 1e-8):
        return "LOW_VOLATILITY", score
    if score >= 4:
        return "HARD_CHOPPY", score
    if score >= 3:
        return "CHOPPY", score
    if efficiency >= 0.55:
        return "TRENDING", score
    return "RANGING", score


def evaluate_pair_gate(
    signal: OrderRecommendation,
    profile: PairProfile,
    exposure: PairExposureStatus,
    candles: list[Candle],
    spread_points: float,
    real_data: bool,
    investing_status: dict,
    investing_technical: dict,
    calendar: EconomicCalendarResponse,
    now: datetime | None = None,
) -> PairGateResult:
    now = now or datetime.now(timezone.utc)
    reasons: list[str] = []
    warnings: list[str] = []
    prefix = signal.symbol
    if not profile.enabled:
        return PairGateResult("HARD_BLOCK", [f"{prefix} blocked: pair profile disabled"])
    if profile.mt5RealDataRequired and not real_data:
        reasons.append("AUTO blocked: candle or tick source is mock")
    if spread_points > profile.maxSpread:
        reasons.append(f"{prefix} blocked: spread exceeds pair profile")
    if exposure.status in {"BLOCKED", "CLOSE_ONLY", "LOCKED"}:
        reasons.extend(exposure.reasons or [f"{prefix} blocked: exposure state {exposure.status}"])
    if signal.entry and signal.stopLoss and signal.takeProfit:
        risk = abs(signal.entry - signal.stopLoss)
        reward = abs(signal.takeProfit - signal.entry)
        if risk <= 0 or reward / risk < profile.minRiskReward:
            reasons.append(f"{prefix} blocked: invalid risk reward")

    pivot_values = investing_technical.get("pivot_points", {})
    pivot = value_of(pivot_values.get("PIVOT"))
    regime, _score = classify_market_regime(candles, pivot)
    if signal.symbol == "EURUSD":
        if regime == "HARD_CHOPPY":
            reasons.append("EURUSD blocked: hard choppy market regime")
        elif regime == "CHOPPY":
            reasons.append("EURUSD blocked: choppy market regime")
        elif regime == "LOW_VOLATILITY":
            reasons.append("EURUSD blocked: low volatility range")
        elif regime == "NEWS_SHOCK":
            reasons.append("EURUSD blocked: high volatility news shock")
    elif regime in {"CHOPPY", "HARD_CHOPPY", "NEWS_SHOCK"}:
        warnings.append(f"XAUUSD advisory: {regime.lower().replace('_', ' ')}")

    closed = candles[-2] if len(candles) >= 2 else None
    if closed is None:
        reasons.append(f"{prefix} blocked: no completed confirmation candle")
    else:
        try:
            candle_time = datetime.fromisoformat(closed.time)
            if candle_time.tzinfo is None:
                candle_time = candle_time.replace(tzinfo=timezone.utc)
            ttl_minutes = {"M15": 16, "M30": 32, "H1": 62}.get(signal.timeframe, 0)
            if ttl_minutes and now - candle_time > timedelta(minutes=ttl_minutes):
                reasons.append(f"{prefix} blocked: signal expired")
        except ValueError:
            reasons.append(f"{prefix} blocked: signal candle time invalid")
        if signal.side == Side.BUY and closed.close <= closed.open:
            reasons.append(f"{prefix} BUY blocked: latest closed candle is not bullish")
        elif signal.side == Side.SELL and closed.close >= closed.open:
            reasons.append(f"{prefix} SELL blocked: latest closed candle is not bearish")

    investing = evaluate_investing(signal, profile, investing_status, investing_technical, now)
    reasons.extend(investing[0])
    warnings.extend(investing[1])

    if profile.pivotRequired:
        reasons.extend(evaluate_pivot(signal, investing_technical, spread_points))
    if profile.newsFilterEnabled:
        reasons.extend(evaluate_news(signal.symbol, calendar, now))

    decision = "HARD_BLOCK" if any("AUTO blocked" in item or "expired" in item for item in reasons) else "BLOCK"
    if not reasons:
        decision = "STRONG_PASS" if not warnings and regime == "TRENDING" else "PASS"
    return PairGateResult(decision, list(dict.fromkeys(reasons)), list(dict.fromkeys(warnings)), regime)


def evaluate_investing(
    signal: OrderRecommendation,
    profile: PairProfile,
    status_payload: dict,
    technical: dict,
    now: datetime,
) -> tuple[list[str], list[str]]:
    if profile.investingMode == "disabled":
        return [], []
    reasons: list[str] = []
    warnings: list[str] = []
    sync = status_payload.get("investing_data_sync", {})
    scraped_at = technical.get("scraped_at_utc") or sync.get("last_sync_utc")
    fresh = False
    if scraped_at:
        try:
            value = datetime.fromisoformat(scraped_at)
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            fresh = now - value <= timedelta(minutes=5)
        except ValueError:
            fresh = False
    usable = sync.get("strategy_use") == "ALLOWED" and fresh and int(sync.get("retry_attempt") or 0) < 3
    if not usable:
        message = f"{signal.symbol} blocked: Investing data unavailable or stale"
        if profile.investingMode == "required":
            reasons.append(message)
        else:
            warnings.append(message.replace("blocked", "advisory"))
        return reasons, warnings

    signals = technical.get("timeframe_signals", {})
    codes = {
        key: normalize_investing_code(signals.get(key, {}).get("signal", {}).get("code"))
        for key in ("15m", "30m", "1h")
    }
    conflicts = {"sell", "strong_sell"} if signal.side == Side.BUY else {"buy", "strong_buy"}
    for key, code in codes.items():
        if code in conflicts and (key == "1h" or code.startswith("strong_")):
            message = f"{signal.symbol} {signal.side.value} blocked: Investing {key} disagrees"
            if profile.investingMode == "required":
                reasons.append(message)
            else:
                warnings.append(message.replace("blocked", "advisory"))
    return reasons, warnings


def evaluate_pivot(signal: OrderRecommendation, technical: dict, spread_points: float) -> list[str]:
    pivots = technical.get("pivot_points", {})
    s1 = value_of(pivots.get("S1"))
    pivot = value_of(pivots.get("PIVOT"))
    r1 = value_of(pivots.get("R1"))
    if s1 is None or pivot is None or r1 is None or signal.entry is None:
        return [f"{signal.symbol} blocked: Fibonacci pivot S1/PIVOT/R1 unavailable"]
    tolerance = min(max(0.0003, spread_points * 0.00001 + 0.0002), 0.0005)
    reasons: list[str] = []
    if signal.side == Side.BUY:
        if abs(signal.entry - r1) <= tolerance and signal.takeProfit and signal.takeProfit <= r1 + tolerance:
            reasons.append("EURUSD BUY blocked: price near Fibonacci resistance")
        if signal.entry < pivot:
            reasons.append("EURUSD BUY blocked: price below pivot without bullish confirmation")
    elif signal.side == Side.SELL:
        if abs(signal.entry - s1) <= tolerance and signal.takeProfit and signal.takeProfit >= s1 - tolerance:
            reasons.append("EURUSD SELL blocked: price near Fibonacci support")
        if signal.entry > pivot:
            reasons.append("EURUSD SELL blocked: price above pivot without bearish confirmation")
    return reasons


def evaluate_news(symbol: Symbol, calendar: EconomicCalendarResponse, now: datetime) -> list[str]:
    if not calendar.configured:
        return [f"{symbol} blocked: news data unavailable"]
    keywords = ("CPI", "NFP", "FOMC", "ECB", "PPI", "GDP", "PMI", "POWELL", "LAGARDE")
    for event in calendar.events:
        if symbol not in event.affected_symbols or event.impact != "high":
            continue
        if not any(keyword in event.title.upper() for keyword in keywords):
            continue
        try:
            event_time = datetime.fromisoformat(event.time)
            if event_time.tzinfo is None:
                event_time = event_time.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        window = 60 if any(key in event.title.upper() for key in ("FOMC", "ECB", "POWELL", "LAGARDE")) else 30
        if abs((event_time - now).total_seconds()) <= window * 60:
            return [f"{symbol} blocked: high-impact news window ({event.title})"]
    return []


def normalize_investing_code(value: object) -> str:
    text = str(value or "").strip().lower().replace(" ", "_")
    mapping = {
        "strong_buy": "strong_buy",
        "buy": "buy",
        "neutral": "neutral",
        "sell": "sell",
        "strong_sell": "strong_sell",
    }
    return mapping.get(text, "unavailable")


def value_of(payload: object) -> float | None:
    if not isinstance(payload, dict):
        return None
    try:
        return float(payload.get("value"))
    except (TypeError, ValueError):
        return None


def count_crosses(values: list[float], averages: list[float]) -> int:
    return sum(
        1
        for index in range(1, min(len(values), len(averages)))
        if (values[index] >= averages[index]) != (values[index - 1] >= averages[index - 1])
    )


def count_level_crosses(values: list[float], level: float) -> int:
    return sum(
        1
        for index in range(1, len(values))
        if (values[index] >= level) != (values[index - 1] >= level)
    )
