from __future__ import annotations

import math

from .models import OrderType, OrderValidation, RiskMode, RiskRequest, Side, Symbol

CONTRACT_SIZE: dict[Symbol, float] = {"XAUUSD": 100.0, "GBPUSD": 100000.0, "EURUSD": 100000.0}
MIN_LOT: dict[Symbol, float] = {"XAUUSD": 0.01, "GBPUSD": 0.01, "EURUSD": 0.01}
LOT_STEP: dict[Symbol, float] = {"XAUUSD": 0.01, "GBPUSD": 0.01, "EURUSD": 0.01}
MAX_RISK_PERCENT = 0.5


def validate_order(request: RiskRequest, equity: float = 10000.0, spread_points: float = 0.0) -> OrderValidation:
    blocked: list[str] = []
    if request.entry <= 0 or request.stopLoss <= 0 or request.takeProfit <= 0:
        blocked.append("Entry, stop loss, and take profit must be positive")

    if request.side == Side.BUY and not (request.stopLoss < request.entry < request.takeProfit):
        blocked.append("Buy order requires SL below entry and TP above entry")
    if request.side == Side.SELL and not (request.takeProfit < request.entry < request.stopLoss):
        blocked.append("Sell order requires TP below entry and SL above entry")

    if request.orderType in {OrderType.BUY_MARKET, OrderType.SELL_MARKET}:
        expected_side = Side.BUY if request.orderType == OrderType.BUY_MARKET else Side.SELL
        if request.side != expected_side:
            blocked.append("Market order side does not match order type")

    risk_per_lot = abs(request.entry - request.stopLoss) * CONTRACT_SIZE[request.symbol]
    if risk_per_lot <= 0:
        blocked.append("Stop loss distance is invalid")
        return OrderValidation(valid=False, lot=None, risk_usd=None, risk_percent=None, blockedReasons=blocked)

    if request.riskMode == RiskMode.FIXED_LOT:
        lot = request.riskValue
        risk_usd = risk_per_lot * lot
    elif request.riskMode == RiskMode.FIXED_USD:
        risk_usd = request.riskValue
        lot = risk_usd / risk_per_lot
    else:
        risk_usd = equity * request.riskValue / 100
        lot = risk_usd / risk_per_lot

    lot = round_down_lot(lot, LOT_STEP[request.symbol])
    if lot < MIN_LOT[request.symbol]:
        blocked.append("Calculated lot is below broker minimum")

    actual_risk_usd = round(risk_per_lot * lot, 2)
    risk_percent = round((actual_risk_usd / equity) * 100, 3) if equity > 0 else None
    if risk_percent is not None and risk_percent > MAX_RISK_PERCENT:
        blocked.append(f"Risk exceeds {MAX_RISK_PERCENT}% maximum")
    if spread_points < 0:
        blocked.append("Spread value is invalid")

    return OrderValidation(
        valid=len(blocked) == 0,
        lot=lot,
        risk_usd=actual_risk_usd,
        risk_percent=risk_percent,
        blockedReasons=blocked,
    )


def round_down_lot(value: float, step: float) -> float:
    if value <= 0:
        return 0.0
    return round(math.floor(value / step) * step, 2)
