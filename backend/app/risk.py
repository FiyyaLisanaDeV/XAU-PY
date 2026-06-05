from __future__ import annotations

import math

from .models import (
    OpenPosition,
    OrderType,
    OrderValidation,
    PendingOrder,
    RiskExposure,
    RiskExposureItem,
    RiskMode,
    RiskRequest,
    Side,
    Symbol,
)

CONTRACT_SIZE: dict[Symbol, float] = {"XAUUSD": 100.0, "EURUSD": 100000.0}
MIN_LOT: dict[Symbol, float] = {"XAUUSD": 0.01, "EURUSD": 0.01}
LOT_STEP: dict[Symbol, float] = {"XAUUSD": 0.01, "EURUSD": 0.01}
MAX_RISK_PERCENT = 0.5
MAX_LOT_PER_POSITION = 0.10


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

    lot = min(lot, MAX_LOT_PER_POSITION)
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


def risk_usd_for(symbol: Symbol, entry: float, stop_loss: float, lot: float) -> float:
    return round(abs(entry - stop_loss) * CONTRACT_SIZE[symbol] * lot, 2)


def build_risk_exposure(
    positions: list[OpenPosition],
    pending_orders: list[PendingOrder],
    equity: float,
    max_total_risk_percent: float = 20.0,
    candidate: RiskExposureItem | None = None,
) -> RiskExposure:
    items: list[RiskExposureItem] = []
    blocked_reasons: list[str] = []
    total_risk_usd = 0.0

    def add_item(item: RiskExposureItem) -> None:
        nonlocal total_risk_usd
        if item.stopLoss is None or item.stopLoss <= 0:
            item.blockedReason = f"{item.source} {item.ticket or item.symbol} has no stop loss"
            blocked_reasons.append(item.blockedReason)
            items.append(item)
            return
        if item.entry <= 0 or item.lot <= 0:
            item.blockedReason = f"{item.source} {item.ticket or item.symbol} has invalid entry or lot"
            blocked_reasons.append(item.blockedReason)
            items.append(item)
            return
        risk_usd = risk_usd_for(item.symbol, item.entry, item.stopLoss, item.lot)
        item.riskUsd = risk_usd
        item.riskPercent = round((risk_usd / equity) * 100, 3) if equity > 0 else None
        total_risk_usd += risk_usd
        items.append(item)

    for position in positions:
        add_item(
            RiskExposureItem(
                ticket=position.ticket,
                symbol=position.symbol,
                source="position",
                entry=position.open_price,
                stopLoss=position.stopLoss,
                lot=position.volume,
            )
        )
    for order in pending_orders:
        add_item(
            RiskExposureItem(
                ticket=order.ticket,
                symbol=order.symbol,
                source="pending_order",
                entry=order.entry,
                stopLoss=order.stopLoss,
                lot=order.volume,
            )
        )
    if candidate is not None:
        add_item(candidate)

    total_risk_percent = round((total_risk_usd / equity) * 100, 3) if equity > 0 else 0.0
    if total_risk_percent > max_total_risk_percent:
        blocked_reasons.append(f"Total risk {total_risk_percent}% exceeds {max_total_risk_percent}% maximum")
    return RiskExposure(
        equity=equity,
        maxTotalRiskPercent=max_total_risk_percent,
        totalRiskUsd=round(total_risk_usd, 2),
        totalRiskPercent=total_risk_percent,
        availableRiskPercent=round(max(max_total_risk_percent - total_risk_percent, 0.0), 3),
        blocked=bool(blocked_reasons),
        blockedReasons=blocked_reasons,
        items=items,
    )


def round_down_lot(value: float, step: float) -> float:
    if value <= 0:
        return 0.0
    return round(math.floor(value / step) * step, 2)
