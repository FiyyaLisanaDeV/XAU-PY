from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    ClosePositionRequest,
    ClosePositionResponse,
    ClosePositionResult,
    DemoGuardRequest,
    DemoGuardStatus,
    EconomicCalendarResponse,
    ExecuteOrderRequest,
    ExecuteOrderResponse,
    HistoryItem,
    MarketSnapshot,
    MarketTick,
    OpenPosition,
    OrderRecommendation,
    OrderValidation,
    RiskMode,
    RiskRequest,
    SignalLogEntry,
    Symbol,
    Timeframe,
    TradingJournalEntry,
    TrailingStopRequest,
    TrailingStopResponse,
)
from .economic_calendar import load_calendar_events
from .mt5_bridge import MT5Bridge
from .risk import validate_order
from .signal_logger import read_signal_log, record_potential_signal
from .strategy import build_snapshot, recommend

app = FastAPI(title="XAUGBPEUUSD Strategy API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

bridge = MT5Bridge()
history: list[HistoryItem] = []
journal: list[TradingJournalEntry] = []
SCAN_SYMBOLS: tuple[Symbol, ...] = ("XAUUSD", "GBPUSD", "EURUSD")
SCAN_TIMEFRAMES: tuple[Timeframe, ...] = ("M15", "M30", "H1", "H4", "D1")


@app.get("/api/status")
def status():
    return bridge.status()


@app.post("/api/demo-guard", response_model=DemoGuardStatus)
def set_demo_guard(request: DemoGuardRequest):
    bridge.set_demo_guard(request.enabled)
    if request.enabled:
        message = "Demo guard ON. Non-demo account execution will be blocked."
    else:
        message = "Demo guard OFF. App will warn before execution, but non-demo account execution is not blocked by this guard."
    return DemoGuardStatus(enabled=bridge.demo_only, message=message)


@app.get("/api/market/snapshot", response_model=MarketSnapshot)
def market_snapshot(symbol: Symbol = Query("XAUUSD"), timeframe: Timeframe = Query("H1")):
    candles = bridge.fetch_candles(symbol, timeframe)
    bid, ask, spread = bridge.tick(symbol)
    return build_snapshot(symbol, timeframe, candles, bid, ask, spread)


@app.get("/api/market/ticks", response_model=dict[Symbol, MarketTick])
def market_ticks():
    now = datetime.now(timezone.utc).isoformat()
    ticks: dict[Symbol, MarketTick] = {}
    for symbol in ("XAUUSD", "GBPUSD", "EURUSD"):
        broker_symbol = bridge.resolve_symbol(symbol)
        bid, ask, spread = bridge.tick(symbol)
        ticks[symbol] = MarketTick(
            symbol=symbol,
            broker_symbol=broker_symbol,
            bid=bid,
            ask=ask,
            mid=round((bid + ask) / 2, 5),
            spread_points=spread,
            server_time=now,
            source="mt5" if broker_symbol else "mock",
        )
    return ticks


@app.get("/api/signals")
def signals(
    symbol: Symbol = Query("XAUUSD"),
    timeframe: Timeframe = Query("H1"),
    riskMode: RiskMode = Query(RiskMode.PERCENT_EQUITY),
    riskValue: float = Query(0.5, gt=0),
):
    snapshot = market_snapshot(symbol, timeframe)
    signal = recommend(snapshot, riskMode, riskValue)
    enrich_signal(snapshot, signal, riskMode, riskValue)
    return signal


@app.post("/api/signals/scan", response_model=list[OrderRecommendation])
def scan_signals(
    riskMode: RiskMode = Query(RiskMode.PERCENT_EQUITY),
    riskValue: float = Query(0.5, gt=0),
):
    results: list[OrderRecommendation] = []
    for symbol in SCAN_SYMBOLS:
        for timeframe in SCAN_TIMEFRAMES:
            snapshot = market_snapshot(symbol, timeframe)
            signal = recommend(snapshot, riskMode, riskValue)
            enrich_signal(snapshot, signal, riskMode, riskValue)
            results.append(signal)
    return results


def enrich_signal(
    snapshot: MarketSnapshot,
    signal: OrderRecommendation,
    riskMode: RiskMode,
    riskValue: float,
) -> None:
    if signal.entry and signal.stopLoss and signal.takeProfit and signal.side and signal.orderType:
        validation = validate_order(
            RiskRequest(
                symbol=signal.symbol,
                timeframe=signal.timeframe,
                side=signal.side,
                orderType=signal.orderType,
                entry=signal.entry,
                stopLoss=signal.stopLoss,
                takeProfit=signal.takeProfit,
                riskMode=riskMode,
                riskValue=riskValue,
            ),
            equity=bridge.status().equity,
            spread_points=snapshot.spread_points,
        )
        signal.lot = validation.lot if validation.valid else None
        signal.riskPercent = validation.risk_percent
        signal.blockedReasons.extend(validation.blockedReasons)
    record_potential_signal(snapshot, signal)


@app.post("/api/orders/validate", response_model=OrderValidation)
def validate_order_endpoint(request: RiskRequest):
    _, _, spread = bridge.tick(request.symbol)
    return validate_order(request, equity=bridge.status().equity, spread_points=spread)


@app.post("/api/orders/execute", response_model=ExecuteOrderResponse)
def execute_order(request: ExecuteOrderRequest):
    if not request.confirmed:
        raise HTTPException(status_code=400, detail="Order confirmation is required before execution.")
    _, _, spread = bridge.tick(request.symbol)
    validation = validate_order(request, equity=bridge.status().equity, spread_points=spread)
    if not validation.valid:
        add_history(request.symbol, request.timeframe, 0, f"{request.orderType.value}", "blocked")
        return ExecuteOrderResponse(
            accepted=False,
            ticket=None,
            status="blocked",
            message="Order blocked by risk validation.",
            validation=validation,
        )

    accepted, ticket, message = bridge.send_order(request, fallback_lot=validation.lot)
    add_history(request.symbol, request.timeframe, 0, f"{request.orderType.value}", "sent" if accepted else "blocked")
    return ExecuteOrderResponse(
        accepted=accepted,
        ticket=ticket,
        status="sent" if accepted else "blocked",
        message=message,
        validation=validation,
    )


@app.get("/api/positions", response_model=list[OpenPosition])
def positions():
    return bridge.open_positions()


@app.post("/api/positions/close", response_model=ClosePositionResponse)
def close_position(request: ClosePositionRequest):
    if not request.confirmed:
        raise HTTPException(status_code=400, detail="Position close confirmation is required.")
    if not request.all and request.ticket is None and request.symbol is None:
        raise HTTPException(status_code=400, detail="Provide either a ticket or symbol to close one position.")
    if request.all:
        positions_to_close = bridge.open_positions()
        if not positions_to_close:
            return ClosePositionResponse(
                accepted=False,
                ticket=None,
                status="blocked",
                message="No open positions to close.",
                closedCount=0,
                failedCount=0,
                results=[],
            )
        results: list[ClosePositionResult] = []
        for position_item in positions_to_close:
            accepted, ticket, message, position = bridge.close_position(ticket=position_item.ticket)
            if accepted and position:
                record_force_close(ticket, position)
            results.append(ClosePositionResult(accepted=accepted, ticket=ticket, symbol=position_item.symbol, message=message))
        closed_count = sum(1 for item in results if item.accepted)
        failed_count = len(results) - closed_count
        return ClosePositionResponse(
            accepted=closed_count > 0 and failed_count == 0,
            ticket=None,
            status="closed" if closed_count > 0 else "blocked",
            message=f"Close all completed: {closed_count} closed, {failed_count} failed.",
            closedCount=closed_count,
            failedCount=failed_count,
            results=results,
        )
    accepted, ticket, message, position = bridge.close_position(ticket=request.ticket, symbol=request.symbol)
    if accepted and position:
        record_force_close(ticket, position)
    return ClosePositionResponse(
        accepted=accepted,
        ticket=ticket,
        status="closed" if accepted else "blocked",
        message=message,
        closedCount=1 if accepted else 0,
        failedCount=0 if accepted else 1,
        results=[ClosePositionResult(accepted=accepted, ticket=ticket, symbol=position.symbol if position else request.symbol, message=message)],
    )


@app.post("/api/positions/trailing-stop", response_model=TrailingStopResponse)
def trailing_stop(request: TrailingStopRequest):
    if not request.confirmed:
        raise HTTPException(status_code=400, detail="Trailing stop confirmation is required.")
    position = next((item for item in bridge.open_positions() if item.ticket == request.ticket), None)
    accepted, message, old_sl, new_sl, profit_pips = bridge.apply_trailing_stop(
        request.ticket,
        trigger_pips=request.trigger_pips,
        distance_pips=request.distance_pips,
        step_pips=request.step_pips,
    )
    if accepted and position:
        add_history(position.symbol, "H1", 0, "TRAILING_STOP", "updated")
    return TrailingStopResponse(
        accepted=accepted,
        ticket=request.ticket,
        status="updated" if accepted else "blocked",
        message=message,
        oldStopLoss=old_sl,
        newStopLoss=new_sl,
        profitPips=profit_pips,
    )


@app.get("/api/history", response_model=list[HistoryItem])
def get_history():
    if history:
        return history[-40:]
    return [
        HistoryItem(time="09:15", symbol="XAUUSD", timeframe="H1", score=74, action="BUY_LIMIT", status="watching"),
        HistoryItem(time="10:00", symbol="GBPUSD", timeframe="M30", score=58, action="NO_TRADE", status="blocked"),
        HistoryItem(time="12:30", symbol="EURUSD", timeframe="H4", score=66, action="SELL_LIMIT", status="ready"),
    ]


@app.get("/api/economic-calendar", response_model=EconomicCalendarResponse)
def economic_calendar():
    return load_calendar_events()


@app.get("/api/journal", response_model=list[TradingJournalEntry])
def trading_journal():
    combined: dict[str, TradingJournalEntry] = {}
    for entry in bridge.recent_closed_deals():
        key = f"{entry.ticket}-{entry.time}-{entry.closeReason}"
        combined[key] = entry
    for entry in journal:
        key = f"{entry.ticket}-{entry.time}-{entry.closeReason}"
        combined[key] = entry
    return sorted(combined.values(), key=lambda item: item.time, reverse=True)[:100]


@app.get("/api/signal-log", response_model=list[SignalLogEntry])
def signal_log(limit: int = Query(100, ge=1, le=500)):
    return read_signal_log(limit=limit)


def add_journal(entry: TradingJournalEntry) -> None:
    journal.append(entry)


def record_force_close(ticket: int | None, position: OpenPosition) -> None:
    add_journal(
        TradingJournalEntry(
            time=datetime.now(timezone.utc).isoformat(),
            ticket=ticket,
            symbol=position.symbol,
            side=position.side,
            volume=position.volume,
            entry=position.open_price,
            exit=position.current_price,
            profit=position.profit,
            closeReason="force_close_user",
            source="app",
            note="Closed by user from Position card",
        )
    )
    add_history(position.symbol, "H1", 0, "FORCE_CLOSE", "closed")


def add_history(symbol: Symbol, timeframe: Timeframe, score: int, action: str, status_value: str) -> None:
    history.append(
        HistoryItem(
            time=datetime.now(timezone.utc).strftime("%H:%M:%S"),
            symbol=symbol,
            timeframe=timeframe,
            score=score,
            action=action,
            status=status_value,
        )
    )
