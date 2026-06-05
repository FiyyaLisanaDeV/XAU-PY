from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    AutoExecutionItem,
    AutoModeRequest,
    AutoModeStatus,
    AutoScanResponse,
    BackendHealth,
    BackendRestartResponse,
    ClosePositionRequest,
    ClosePositionResponse,
    ClosePositionResult,
    DataResetResponse,
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
    PendingOrder,
    PositionSetupAlert,
    RiskExposure,
    RiskExposureItem,
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
from .investing_sync import (
    all_statuses as investing_all_statuses,
    all_technicals as investing_all_technicals,
    apply_investing_filter,
    current_status as investing_current_status,
    current_technical as investing_current_technical,
    refresh_all_investing_data,
    refresh_investing_data,
)
from .mt5_bridge import MT5Bridge
from .risk import build_risk_exposure, validate_order
from .signal_logger import SIGNAL_LOG_PATH, read_signal_log, record_potential_signal
from .strategy import build_snapshot, recommend


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global auto_tp_monitor_task, auto_strategy_monitor_task, investing_sync_monitor_task
    auto_tp_monitor_task = asyncio.create_task(auto_take_profit_monitor())
    auto_strategy_monitor_task = asyncio.create_task(auto_strategy_monitor())
    investing_sync_monitor_task = asyncio.create_task(investing_sync_monitor())
    try:
        yield
    finally:
        if auto_tp_monitor_task is not None:
            auto_tp_monitor_task.cancel()
            with suppress(asyncio.CancelledError):
                await auto_tp_monitor_task
        if auto_strategy_monitor_task is not None:
            auto_strategy_monitor_task.cancel()
            with suppress(asyncio.CancelledError):
                await auto_strategy_monitor_task
        if investing_sync_monitor_task is not None:
            investing_sync_monitor_task.cancel()
            with suppress(asyncio.CancelledError):
                await investing_sync_monitor_task


app = FastAPI(title="XAUGBPEUUSD Strategy API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

APP_STARTED_AT = datetime.now(timezone.utc).isoformat()
PROJECT_ROOT = Path(__file__).resolve().parents[2]
RESET_STATE_PATH = PROJECT_ROOT / "data" / "reset_state.json"
bridge = MT5Bridge()
history: list[HistoryItem] = []
journal: list[TradingJournalEntry] = []
SCAN_SYMBOLS: tuple[Symbol, ...] = ("XAUUSD", "EURUSD")
SCAN_TIMEFRAMES: tuple[Timeframe, ...] = ("M15", "M30", "H1", "H4", "D1")
EXECUTION_TIMEFRAMES: tuple[Timeframe, ...] = ("M15", "M30", "H1")
auto_config = AutoModeRequest(enabled=False)
auto_last_scan: str | None = None
auto_last_action: str | None = None
auto_blocked_reason: str | None = None
auto_executed_signatures: dict[str, datetime] = {}
AUTO_TAKE_PROFIT_USD = float(os.getenv("XAUGBPEUUSD_AUTO_TP_USD", "10"))
AUTO_TAKE_PROFIT_INTERVAL_SECONDS = float(os.getenv("XAUGBPEUUSD_AUTO_TP_INTERVAL_SECONDS", "1"))
INVESTING_SYNC_INTERVAL_SECONDS = float(os.getenv("XAUGBPEUUSD_INVESTING_SYNC_INTERVAL_SECONDS", "60"))
auto_tp_closed_tickets: set[int] = set()
auto_tp_last_attempts: dict[int, datetime] = {}
auto_tp_monitor_task: asyncio.Task[None] | None = None
auto_strategy_monitor_task: asyncio.Task[None] | None = None
investing_sync_monitor_task: asyncio.Task[None] | None = None


def active_scan_symbols() -> tuple[Symbol, ...]:
    active = [symbol for symbol in SCAN_SYMBOLS if symbol in auto_config.activeSymbols]
    return tuple(active) if active else SCAN_SYMBOLS


def is_symbol_trade_active(symbol: Symbol) -> bool:
    return symbol in active_scan_symbols()


def read_journal_reset_at() -> datetime | None:
    if not RESET_STATE_PATH.exists():
        return None
    try:
        value = json.loads(RESET_STATE_PATH.read_text(encoding="utf-8")).get("journal_reset_at")
        if not value:
            return None
        reset_at = datetime.fromisoformat(value)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
    if reset_at.tzinfo is None:
        return reset_at.replace(tzinfo=timezone.utc)
    return reset_at


def write_journal_reset_at(reset_at: datetime) -> None:
    RESET_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESET_STATE_PATH.write_text(
        json.dumps({"journal_reset_at": reset_at.isoformat()}, indent=2),
        encoding="utf-8",
    )


def is_after_journal_reset(entry: TradingJournalEntry, reset_at: datetime | None) -> bool:
    if reset_at is None:
        return True
    try:
        entry_time = datetime.fromisoformat(entry.time)
    except ValueError:
        return False
    if entry_time.tzinfo is None:
        entry_time = entry_time.replace(tzinfo=timezone.utc)
    return entry_time >= reset_at


@app.get("/api/status")
def status():
    return bridge.status()


@app.get("/api/ea/status")
def ea_status():
    account = bridge.status()
    positions = bridge.open_positions()
    return {
        "ok": True,
        "backend": "online",
        "serverTime": datetime.now(timezone.utc).isoformat(),
        "autoEnabled": auto_config.enabled,
        "maxTotalRiskPercent": auto_config.maxTotalRiskPercent,
        "minScore": auto_config.minScore,
        "tradeReady": account.trade_ready,
        "connected": account.connected,
        "demoGuardEnabled": account.demo_guard_enabled,
        "liveAccount": account.live_account,
        "openPositions": len(positions),
        "symbols": list(active_scan_symbols()),
        "availableSymbols": list(SCAN_SYMBOLS),
        "executionTimeframes": list(EXECUTION_TIMEFRAMES),
        "monitorTimeframes": [timeframe for timeframe in SCAN_TIMEFRAMES if timeframe not in EXECUTION_TIMEFRAMES],
        "lastScan": auto_last_scan,
        "lastAction": auto_last_action,
        "blockedReason": auto_blocked_reason,
        "investingDataSync": investing_current_status("EURUSD").get("investing_data_sync"),
        "investingDataSyncBySymbol": investing_all_statuses().get("items"),
    }


@app.get("/api/backend/health", response_model=BackendHealth)
def backend_health():
    return BackendHealth(
        active=True,
        service="XAUGBPEUUSD FastAPI backend",
        startedAt=APP_STARTED_AT,
        serverTime=datetime.now(timezone.utc).isoformat(),
        pid=os.getpid(),
        message="Backend is active.",
    )


@app.post("/api/backend/restart", response_model=BackendRestartResponse)
def restart_backend():
    try:
        schedule_backend_restart()
    except Exception as exc:
        return BackendRestartResponse(accepted=False, status="blocked", message=f"Backend restart could not be scheduled: {exc}")
    return BackendRestartResponse(accepted=True, status="scheduled", message="Backend restart scheduled. UI may show offline for a few seconds.")


@app.post("/api/data/reset", response_model=DataResetResponse)
def reset_data():
    global auto_last_scan, auto_last_action, auto_blocked_reason
    cleared: list[str] = []
    write_journal_reset_at(datetime.now(timezone.utc))
    cleared.append("journal_reset_baseline")
    history.clear()
    cleared.append("history")
    journal.clear()
    cleared.append("journal_cache")
    auto_executed_signatures.clear()
    auto_tp_closed_tickets.clear()
    auto_tp_last_attempts.clear()
    auto_last_scan = None
    auto_last_action = None
    auto_blocked_reason = None
    cleared.append("auto_runtime_state")
    if SIGNAL_LOG_PATH.exists():
        SIGNAL_LOG_PATH.write_text("", encoding="utf-8")
    else:
        SIGNAL_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        SIGNAL_LOG_PATH.touch()
    cleared.append("signal_log")
    return DataResetResponse(
        accepted=True,
        message="Local app data reset. Older MT5 history is hidden from this dashboard; open positions and broker records were not modified.",
        cleared=cleared,
    )


@app.post("/api/demo-guard", response_model=DemoGuardStatus)
def set_demo_guard(request: DemoGuardRequest):
    bridge.set_demo_guard(request.enabled)
    if request.enabled:
        message = "Demo guard ON. Non-demo account execution will be blocked."
    else:
        message = "Demo guard OFF. App will warn before execution, but non-demo account execution is not blocked by this guard."
    return DemoGuardStatus(enabled=bridge.demo_only, message=message)


@app.get("/api/auto-mode/status", response_model=AutoModeStatus)
def auto_mode_status():
    close_profitable_positions()
    return build_auto_status()


@app.post("/api/auto-mode", response_model=AutoModeStatus)
def set_auto_mode(request: AutoModeRequest):
    global auto_config, auto_last_action, auto_blocked_reason
    if not request.activeSymbols:
        request.activeSymbols = list(SCAN_SYMBOLS)
    auto_config = request
    auto_last_action = "Full Auto ON" if request.enabled else "Full Auto OFF"
    auto_blocked_reason = None if request.enabled else "Auto mode is OFF"
    return build_auto_status()


@app.post("/api/auto-mode/scan-now", response_model=AutoScanResponse)
def auto_mode_scan_now():
    return run_auto_scan()


@app.get("/api/market/snapshot", response_model=MarketSnapshot)
def market_snapshot(symbol: Symbol = Query("XAUUSD"), timeframe: Timeframe = Query("H1")):
    candles = bridge.fetch_candles(symbol, timeframe)
    bid, ask, spread = bridge.tick(symbol)
    return build_snapshot(symbol, timeframe, candles, bid, ask, spread)


@app.get("/api/market/ticks", response_model=dict[Symbol, MarketTick])
def market_ticks():
    now = datetime.now(timezone.utc).isoformat()
    ticks: dict[Symbol, MarketTick] = {}
    for symbol in SCAN_SYMBOLS:
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


@app.get("/api/pending-orders", response_model=list[PendingOrder])
def pending_orders():
    return bridge.pending_orders()


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
    if not is_symbol_trade_active(signal.symbol):
        signal.blockedReasons.append(f"{signal.symbol} trade is disabled in active pair settings")
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
    apply_investing_filter(signal)
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
    close_profitable_positions()
    return bridge.open_positions()


@app.get("/api/positions/alerts", response_model=list[PositionSetupAlert])
def position_alerts():
    close_profitable_positions()
    return build_position_alerts(bridge.open_positions())


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
        HistoryItem(time="10:00", symbol="EURUSD", timeframe="M30", score=58, action="NO_TRADE", status="blocked"),
        HistoryItem(time="12:30", symbol="EURUSD", timeframe="H4", score=66, action="SELL_LIMIT", status="ready"),
    ]


@app.get("/api/economic-calendar", response_model=EconomicCalendarResponse)
def economic_calendar():
    return load_calendar_events()


@app.get("/api/investing/status")
def investing_status(symbol: Symbol | None = Query(None)):
    if symbol is None:
        return investing_all_statuses()
    return investing_current_status(symbol)


@app.get("/api/investing/technical")
def investing_technical(symbol: Symbol | None = Query(None)):
    if symbol is None:
        return investing_all_technicals()
    return investing_current_technical(symbol)


@app.post("/api/investing/sync")
def investing_sync_now(symbol: Symbol | None = Query(None)):
    if symbol is None:
        return refresh_all_investing_data()
    return refresh_investing_data(symbol)


@app.get("/api/journal", response_model=list[TradingJournalEntry])
def trading_journal():
    combined: dict[str, TradingJournalEntry] = {}
    reset_at = read_journal_reset_at()
    for entry in bridge.recent_closed_deals(date_from=reset_at):
        if not is_after_journal_reset(entry, reset_at):
            continue
        key = f"{entry.ticket}-{entry.time}-{entry.closeReason}"
        combined[key] = entry
    for entry in journal:
        if not is_after_journal_reset(entry, reset_at):
            continue
        key = f"{entry.ticket}-{entry.time}-{entry.closeReason}"
        combined[key] = entry
    return sorted(combined.values(), key=lambda item: item.time, reverse=True)


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


def build_auto_status(exposure: RiskExposure | None = None) -> AutoModeStatus:
    if exposure is None:
        account = bridge.status()
        exposure = build_risk_exposure(
            bridge.open_positions(),
            bridge.pending_orders(),
            equity=account.equity,
            max_total_risk_percent=auto_config.maxTotalRiskPercent,
        )
    return AutoModeStatus(
        enabled=auto_config.enabled,
        activeSymbols=list(active_scan_symbols()),
        maxTotalRiskPercent=auto_config.maxTotalRiskPercent,
        minScore=auto_config.minScore,
        riskMode=auto_config.riskMode,
        riskValue=auto_config.riskValue,
        scanIntervalSeconds=auto_config.scanIntervalSeconds,
        duplicateCooldownMinutes=auto_config.duplicateCooldownMinutes,
        lastScan=auto_last_scan,
        lastAction=auto_last_action,
        blockedReason=auto_blocked_reason,
        exposure=exposure,
    )


def close_profitable_positions() -> list[ClosePositionResult]:
    global auto_last_action
    results: list[ClosePositionResult] = []
    now = datetime.now(timezone.utc)
    for position in bridge.open_positions():
        if position.ticket in auto_tp_closed_tickets:
            continue
        if position.profit < AUTO_TAKE_PROFIT_USD:
            continue
        last_attempt = auto_tp_last_attempts.get(position.ticket)
        if last_attempt is not None and now - last_attempt < timedelta(seconds=3):
            continue
        auto_tp_last_attempts[position.ticket] = now
        accepted, ticket, message, closed_position = bridge.close_position(ticket=position.ticket)
        close_result = ClosePositionResult(
            accepted=accepted,
            ticket=ticket,
            symbol=position.symbol,
            message=message,
        )
        results.append(close_result)
        if accepted and closed_position:
            auto_tp_closed_tickets.add(closed_position.ticket)
            record_auto_take_profit(ticket, closed_position)
            auto_last_action = f"Auto TP closed {closed_position.symbol} ticket {ticket} at ${closed_position.profit:.2f} profit"
    return results


async def auto_take_profit_monitor() -> None:
    while True:
        try:
            await asyncio.to_thread(close_profitable_positions)
        except Exception:
            pass
        await asyncio.sleep(AUTO_TAKE_PROFIT_INTERVAL_SECONDS)


async def auto_strategy_monitor() -> None:
    while True:
        interval_seconds = max(auto_config.scanIntervalSeconds, 5)
        await asyncio.sleep(interval_seconds)
        if not auto_config.enabled:
            continue
        try:
            await asyncio.to_thread(run_auto_scan)
        except Exception:
            pass


async def investing_sync_monitor() -> None:
    while True:
        try:
            await asyncio.to_thread(refresh_all_investing_data)
        except Exception:
            pass
        await asyncio.sleep(INVESTING_SYNC_INTERVAL_SECONDS)


def record_auto_take_profit(ticket: int | None, position: OpenPosition) -> None:
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
            closeReason="tp",
            source="app",
            note=f"Auto take profit closed at ${AUTO_TAKE_PROFIT_USD:.2f} profit threshold",
        )
    )
    add_history(position.symbol, "H1", 0, "AUTO_TP_10_USD", "closed")


def run_auto_scan() -> AutoScanResponse:
    global auto_last_scan, auto_last_action, auto_blocked_reason
    auto_last_scan = datetime.now(timezone.utc).isoformat()
    account = bridge.status()
    exposure = build_risk_exposure(
        bridge.open_positions(),
        bridge.pending_orders(),
        equity=account.equity,
        max_total_risk_percent=auto_config.maxTotalRiskPercent,
    )
    blocked: list[str] = []
    actions: list[AutoExecutionItem] = []

    if not auto_config.enabled:
        auto_blocked_reason = "Auto mode is OFF"
        return AutoScanResponse(status=build_auto_status(exposure), scanned=0, eligible=0, executed=0, blocked=[auto_blocked_reason], actions=[])
    close_profitable_positions()
    if not account.connected:
        auto_blocked_reason = "MT5 is offline"
        return AutoScanResponse(status=build_auto_status(exposure), scanned=0, eligible=0, executed=0, blocked=[auto_blocked_reason], actions=[])
    if not account.trade_ready:
        auto_blocked_reason = "MT5 AutoTrading/Algo Trading is disabled"
        return AutoScanResponse(status=build_auto_status(exposure), scanned=0, eligible=0, executed=0, blocked=[auto_blocked_reason], actions=[])
    if account.demo_guard_enabled and account.live_account:
        auto_blocked_reason = "Demo guard blocks non-demo account execution"
        return AutoScanResponse(status=build_auto_status(exposure), scanned=0, eligible=0, executed=0, blocked=[auto_blocked_reason], actions=[])
    if exposure.blocked:
        auto_blocked_reason = "; ".join(exposure.blockedReasons)
        return AutoScanResponse(status=build_auto_status(exposure), scanned=0, eligible=0, executed=0, blocked=exposure.blockedReasons, actions=[])

    candidates: list[tuple[OrderRecommendation, OrderValidation]] = []
    scanned = 0
    for symbol in active_scan_symbols():
        for timeframe in SCAN_TIMEFRAMES:
            scanned += 1
            snapshot = market_snapshot(symbol, timeframe)
            signal = recommend(snapshot, auto_config.riskMode, auto_config.riskValue)
            enrich_signal(snapshot, signal, auto_config.riskMode, auto_config.riskValue)
            if timeframe not in EXECUTION_TIMEFRAMES:
                blocked.append(f"{symbol} {timeframe}: monitor trend only, excluded from auto execution")
                continue
            if signal.score < auto_config.minScore:
                continue
            if not signal.side or not signal.orderType or not signal.entry or not signal.stopLoss or not signal.takeProfit:
                continue
            if signal.blockedReasons:
                blocked.extend(f"{signal.symbol} {signal.timeframe}: {reason}" for reason in signal.blockedReasons)
                continue
            validation = validate_order(
                RiskRequest(
                    symbol=signal.symbol,
                    timeframe=signal.timeframe,
                    side=signal.side,
                    orderType=signal.orderType,
                    entry=signal.entry,
                    stopLoss=signal.stopLoss,
                    takeProfit=signal.takeProfit,
                    riskMode=auto_config.riskMode,
                    riskValue=auto_config.riskValue,
                ),
                equity=account.equity,
                spread_points=snapshot.spread_points,
            )
            if not validation.valid or validation.lot is None:
                blocked.extend(f"{signal.symbol} {signal.timeframe}: {reason}" for reason in validation.blockedReasons)
                continue
            candidates.append((signal, validation))

    candidates.sort(key=lambda item: item[0].score, reverse=True)
    executed = 0
    current_positions = bridge.open_positions()
    current_pending = bridge.pending_orders()
    for signal, validation in candidates:
        signature = build_auto_signature(signal)
        if is_auto_duplicate(signature):
            blocked.append(f"{signal.symbol} {signal.timeframe}: duplicate signal cooldown")
            continue
        candidate_item = RiskExposureItem(
            symbol=signal.symbol,
            source="candidate",
            entry=signal.entry or 0.0,
            stopLoss=signal.stopLoss,
            lot=validation.lot or 0.0,
        )
        candidate_exposure = build_risk_exposure(
            current_positions,
            current_pending,
            equity=account.equity,
            max_total_risk_percent=auto_config.maxTotalRiskPercent,
            candidate=candidate_item,
        )
        if candidate_exposure.blocked:
            blocked.extend(f"{signal.symbol} {signal.timeframe}: {reason}" for reason in candidate_exposure.blockedReasons)
            continue
        request = ExecuteOrderRequest(
            symbol=signal.symbol,
            timeframe=signal.timeframe,
            side=signal.side,
            orderType=signal.orderType,
            entry=signal.entry,
            stopLoss=signal.stopLoss,
            takeProfit=signal.takeProfit,
            riskMode=auto_config.riskMode,
            riskValue=auto_config.riskValue,
            lot=validation.lot,
            confirmed=True,
        )
        accepted, ticket, message = bridge.send_order(request, fallback_lot=validation.lot)
        add_history(signal.symbol, signal.timeframe, signal.score, f"AUTO_{signal.orderType.value}", "sent" if accepted else "blocked")
        actions.append(
            AutoExecutionItem(
                symbol=signal.symbol,
                timeframe=signal.timeframe,
                score=signal.score,
                orderType=signal.orderType,
                accepted=accepted,
                ticket=ticket,
                message=message,
                riskPercent=validation.risk_percent,
            )
        )
        if accepted:
            executed += 1
            auto_executed_signatures[signature] = datetime.now(timezone.utc)
            auto_last_action = f"Auto sent {signal.orderType.value} {signal.symbol} {signal.timeframe} ticket {ticket}"
            current_positions = bridge.open_positions()
            current_pending = bridge.pending_orders()
        else:
            blocked.append(f"{signal.symbol} {signal.timeframe}: {message}")
    if executed == 0 and not blocked:
        blocked.append("No eligible auto signal found")
    auto_blocked_reason = None if executed > 0 else (blocked[-1] if blocked else None)
    final_exposure = build_risk_exposure(
        bridge.open_positions(),
        bridge.pending_orders(),
        equity=account.equity,
        max_total_risk_percent=auto_config.maxTotalRiskPercent,
    )
    return AutoScanResponse(
        status=build_auto_status(final_exposure),
        scanned=scanned,
        eligible=len(candidates),
        executed=executed,
        blocked=unique_recent(blocked),
        actions=actions,
    )


def build_auto_signature(signal: OrderRecommendation) -> str:
    entry = "none" if signal.entry is None else f"{signal.entry:.5f}"
    side = signal.side.value if signal.side else "WAIT"
    order_type = signal.orderType.value if signal.orderType else "NO_ORDER"
    return f"{signal.symbol}-{signal.timeframe}-{side}-{order_type}-{entry}-{signal.score}"


def is_auto_duplicate(signature: str) -> bool:
    if auto_config.duplicateCooldownMinutes <= 0:
        return False
    last_seen = auto_executed_signatures.get(signature)
    if last_seen is None:
        return False
    return datetime.now(timezone.utc) - last_seen < timedelta(minutes=auto_config.duplicateCooldownMinutes)


def unique_recent(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))[-20:]


def schedule_backend_restart() -> None:
    pid = os.getpid()
    python_exe = sys.executable
    root = str(PROJECT_ROOT)
    logs = PROJECT_ROOT / "logs"
    logs.mkdir(exist_ok=True)
    backend_log = str(logs / "backend-restart.log")
    backend_err = str(logs / "backend-restart.err.log")
    helper = (
        "Start-Sleep -Seconds 1; "
        f"Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue; "
        "Start-Sleep -Milliseconds 600; "
        f"Start-Process -FilePath '{python_exe}' "
        f"-ArgumentList '-m','uvicorn','backend.app.main:app','--host','127.0.0.1','--port','9000' "
        f"-WorkingDirectory '{root}' "
        f"-RedirectStandardOutput '{backend_log}' "
        f"-RedirectStandardError '{backend_err}' "
        "-WindowStyle Hidden"
    )
    subprocess.Popen(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", helper],
        cwd=root,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def build_position_alerts(open_items: list[OpenPosition]) -> list[PositionSetupAlert]:
    alerts: list[PositionSetupAlert] = []
    for position in open_items:
        signals: list[OrderRecommendation] = []
        for timeframe in EXECUTION_TIMEFRAMES:
            snapshot = market_snapshot(position.symbol, timeframe)
            signal = recommend(snapshot, auto_config.riskMode, auto_config.riskValue)
            enrich_signal(snapshot, signal, auto_config.riskMode, auto_config.riskValue)
            signals.append(signal)
        alerts.append(classify_position_setup(position, signals))
    return alerts


def classify_position_setup(position: OpenPosition, signals: list[OrderRecommendation]) -> PositionSetupAlert:
    checked = [signal.timeframe for signal in signals]
    supporting = [
        signal.timeframe
        for signal in signals
        if signal.side == position.side and signal.score >= auto_config.minScore and not signal.blockedReasons
    ]
    opposing = [
        signal.timeframe
        for signal in signals
        if signal.side is not None and signal.side != position.side and signal.score >= auto_config.minScore and not signal.blockedReasons
    ]
    reasons: list[str] = []
    best_score = max((signal.score for signal in signals), default=0)
    if supporting:
        status_value = "valid"
        title = "Setup masih valid"
        message = f"{position.symbol} {position.side.value} masih didukung timeframe {', '.join(supporting)}."
        reasons.append(f"Same-side confluence active on {', '.join(supporting)}")
    elif opposing:
        status_value = "invalid"
        title = "Setup posisi tidak valid"
        message = f"{position.symbol} {position.side.value} tidak lagi didukung; sinyal lawan muncul di {', '.join(opposing)}."
        reasons.append(f"Opposite confluence active on {', '.join(opposing)}")
    else:
        status_value = "warning"
        title = "Setup melemah"
        message = f"{position.symbol} {position.side.value} belum punya konfirmasi intraday aktif. Monitor ketat atau kurangi risiko."
        reasons.append(f"No same-side setup with score >= {auto_config.minScore}; best current score {best_score}")
    return PositionSetupAlert(
        ticket=position.ticket,
        symbol=position.symbol,
        side=position.side,
        status=status_value,
        title=title,
        message=message,
        checkedTimeframes=checked,
        supportingTimeframes=supporting,
        opposingTimeframes=opposing,
        reasons=reasons,
    )
