from __future__ import annotations

import asyncio
import json
import math
import os
import socket
import subprocess
import sys
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    AutoExecutionItem,
    AutoModeRequest,
    AutoModeStatus,
    AutoScanResponse,
    AutoTrailingRule,
    AutoTrailingStateItem,
    AutoTrailingStatus,
    AllServicesRestartResponse,
    BackendHealth,
    BackendRestartResponse,
    Candle,
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
    MarketRegimeCollection,
    MarketTick,
    MinimumBalanceEstimate,
    MinimumBalancePair,
    OpenPosition,
    OrderRecommendation,
    OrderType,
    OrderValidation,
    PendingOrder,
    PairExposureStatus,
    PositionSetupAlert,
    RiskExposure,
    RiskExposureItem,
    RiskMode,
    RiskRequest,
    RecoveryCycleStatus,
    RecoveryEngineStatus,
    ServiceRestartAction,
    Side,
    SignalLogEntry,
    Symbol,
    Timeframe,
    TradingJournalEntry,
    TrailingStopRequest,
    TrailingStopResponse,
)
from .economic_calendar import load_calendar_events
from .audit_logger import append_audit
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
from .pair_engine import apply_pair_risk_model, build_pair_exposure, classify_market_regime, evaluate_pair_gate
from .pair_state import PairStateStore
from .risk import MAX_RISK_PERCENT, MIN_LOT, build_risk_exposure, risk_usd_for, round_down_lot, validate_order
from .recovery import atr_price, recovery_confirmed, reversal_score
from .signal_logger import SIGNAL_LOG_PATH, read_signal_log, record_potential_signal
from .strategy import MAX_SPREAD, build_snapshot, recommend
from .strategy_profiles import apply_strategy_profile


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global trailing_monitor_task, recovery_monitor_task, auto_strategy_monitor_task, investing_sync_monitor_task
    trailing_monitor_task = asyncio.create_task(trailing_monitor_loop())
    recovery_monitor_task = asyncio.create_task(recovery_monitor_loop())
    auto_strategy_monitor_task = asyncio.create_task(auto_strategy_monitor())
    investing_sync_monitor_task = asyncio.create_task(investing_sync_monitor())
    try:
        yield
    finally:
        if trailing_monitor_task is not None:
            trailing_monitor_task.cancel()
            with suppress(asyncio.CancelledError):
                await trailing_monitor_task
        if recovery_monitor_task is not None:
            recovery_monitor_task.cancel()
            with suppress(asyncio.CancelledError):
                await recovery_monitor_task
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
STRATEGY_SETTINGS_PATH = PROJECT_ROOT / "data" / "strategy_settings.json"
RECOVERY_STATE_PATH = PROJECT_ROOT / "data" / "recovery_state.json"
PAIR_STATE_PATH = PROJECT_ROOT / "data" / "pair_state.json"
SETTINGS_V2_BACKUP_PATH = PROJECT_ROOT / "data" / "settings.backup-before-v2.json"
MIGRATION_V2_LOG_PATH = PROJECT_ROOT / "data" / "migration-v2.log"
SIGNAL_AUDIT_PATH = PROJECT_ROOT / "data" / "signal_audit.jsonl"
bridge = MT5Bridge()
history: list[HistoryItem] = []
journal: list[TradingJournalEntry] = []
SCAN_SYMBOLS: tuple[Symbol, ...] = ("XAUUSD", "EURUSD")
SCAN_TIMEFRAMES: tuple[Timeframe, ...] = ("M15", "M30", "H1", "H4", "D1")
EXECUTION_TIMEFRAMES: tuple[Timeframe, ...] = ("M15", "M30", "H1")


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.stem}.tmp{path.suffix}")
    with temp.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2)
        file.flush()
        os.fsync(file.fileno())
    temp.replace(path)


def load_strategy_settings() -> AutoModeRequest:
    if not STRATEGY_SETTINGS_PATH.exists():
        config = AutoModeRequest(enabled=False)
        write_json_atomic(STRATEGY_SETTINGS_PATH, config.model_dump(mode="json"))
        return config
    try:
        raw = json.loads(STRATEGY_SETTINGS_PATH.read_text(encoding="utf-8"))
        if "strategyProfile" not in raw:
            raw["strategyProfile"] = "CUSTOM"
            write_json_atomic(STRATEGY_SETTINGS_PATH, raw)
        if int(raw.get("configVersion", 1)) < 2:
            SETTINGS_V2_BACKUP_PATH.write_text(json.dumps(raw, indent=2), encoding="utf-8")
            raw["configVersion"] = 2
            raw["shadowMode"] = True
            migrated = AutoModeRequest.model_validate(raw)
            write_json_atomic(STRATEGY_SETTINGS_PATH, migrated.model_dump(mode="json"))
            MIGRATION_V2_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            MIGRATION_V2_LOG_PATH.write_text(
                f"{datetime.now(timezone.utc).isoformat()} migrated config v1 to v2; XAU behavior preserved; EUR strict profile added; shadow mode enabled.\n",
                encoding="utf-8",
            )
            return migrated
        return AutoModeRequest.model_validate(raw)
    except Exception as exc:
        if SETTINGS_V2_BACKUP_PATH.exists():
            try:
                return AutoModeRequest.model_validate_json(SETTINGS_V2_BACKUP_PATH.read_text(encoding="utf-8"))
            except Exception:
                pass
        MIGRATION_V2_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        MIGRATION_V2_LOG_PATH.write_text(
            f"{datetime.now(timezone.utc).isoformat()} migration/settings load failed: {exc}\n",
            encoding="utf-8",
        )
        return AutoModeRequest(enabled=False, shadowMode=True)


auto_config = load_strategy_settings()
pair_state_store = PairStateStore(PAIR_STATE_PATH)
auto_last_scan: str | None = None
auto_last_action: str | None = None
auto_blocked_reason: str | None = None
auto_executed_signatures: dict[str, datetime] = {}
AUTO_TAKE_PROFIT_USD = float(os.getenv("XAUGBPEUUSD_AUTO_TP_USD", "10"))
TRAILING_MONITOR_INTERVAL_SECONDS = float(os.getenv("XAUGBPEUUSD_TRAILING_INTERVAL_SECONDS", "1"))
INVESTING_SYNC_INTERVAL_SECONDS = float(os.getenv("XAUGBPEUUSD_INVESTING_SYNC_INTERVAL_SECONDS", "60"))
RECOVERY_MONITOR_INTERVAL_SECONDS = float(os.getenv("XAUGBPEUUSD_RECOVERY_INTERVAL_SECONDS", "5"))
TRAILING_CONFIG: dict[Symbol, dict[str, float]] = {
    "XAUUSD": {"trigger_usd": AUTO_TAKE_PROFIT_USD, "distance_pips": 150.0, "step_pips": 50.0, "pip_size": 0.01},
    "EURUSD": {"trigger_usd": AUTO_TAKE_PROFIT_USD, "distance_pips": 20.0, "step_pips": 8.0, "pip_size": 0.0001},
}
trailing_states: dict[int, "TrailingState"] = {}
trailing_last_attempts: dict[int, datetime] = {}
hard_tp_last_attempts: dict[int, datetime] = {}
trailing_monitor_task: asyncio.Task[None] | None = None
recovery_monitor_task: asyncio.Task[None] | None = None
auto_strategy_monitor_task: asyncio.Task[None] | None = None
investing_sync_monitor_task: asyncio.Task[None] | None = None
HEDGE_COMMENT_PREFIX = "XAPY-H-"
RECOVERY_COMMENT_PREFIX = "XAPY-R"
recovery_lock = Lock()
pair_exposure_locks: dict[Symbol, Lock] = {symbol: Lock() for symbol in SCAN_SYMBOLS}
minimum_balance_cache: tuple[datetime, tuple[Symbol, ...], str, MinimumBalanceEstimate] | None = None


def load_recovery_cycles() -> dict[Symbol, RecoveryCycleStatus]:
    try:
        raw = json.loads(RECOVERY_STATE_PATH.read_text(encoding="utf-8"))
        return {
            symbol: RecoveryCycleStatus.model_validate(value)
            for symbol, value in raw.items()
            if symbol in SCAN_SYMBOLS
        }
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return {}


recovery_cycles: dict[Symbol, RecoveryCycleStatus] = load_recovery_cycles()


def save_recovery_cycles() -> None:
    RECOVERY_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    RECOVERY_STATE_PATH.write_text(
        json.dumps(
            {
                symbol: cycle.model_dump(mode="json")
                for symbol, cycle in recovery_cycles.items()
            },
            indent=2,
        ),
        encoding="utf-8",
    )


@dataclass
class TrailingState:
    ticket: int
    symbol: Symbol
    side: Side
    open_price: float
    original_sl: float
    current_sl: float
    trailing_active: bool = False
    peak_price: float = 0.0


def active_scan_symbols() -> tuple[Symbol, ...]:
    active = [
        symbol
        for symbol in SCAN_SYMBOLS
        if symbol in auto_config.activeSymbols and auto_config.pairProfiles[symbol].enabled
    ]
    return tuple(active) if active else SCAN_SYMBOLS


def pair_profile(symbol: Symbol):
    return auto_config.pairProfiles[symbol]


def account_money_factor() -> float:
    return 100.0 if auto_config.accountMode == "USC" else 1.0


def broker_money_from_usd(value_usd: float) -> float:
    return value_usd * account_money_factor()


def usd_from_broker_money(value: float) -> float:
    return value / account_money_factor()


def format_account_money(value: float) -> str:
    if auto_config.accountMode == "USC":
        return f"{value:.2f} USC"
    return f"${value:.2f}"


def account_equity_usd(account=None) -> float:
    current = account or bridge.status()
    return usd_from_broker_money(current.equity)


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
        "accountMode": auto_config.accountMode,
        "accountMoneyFactor": account_money_factor(),
        "configVersion": auto_config.configVersion,
        "strategyProfile": auto_config.strategyProfile,
        "shadowMode": auto_config.shadowMode,
        "pairStateHealthy": not pair_state_store.corrupt,
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
        "eaChartTimeframeIndependent": True,
        "executionOwner": "FastAPI backend via MT5 Python bridge",
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


@app.post("/api/services/restart-all", response_model=AllServicesRestartResponse)
def restart_all_services():
    actions: list[ServiceRestartAction] = []
    try:
        if is_port_listening(5174):
            actions.append(
                ServiceRestartAction(
                    service="frontend",
                    accepted=True,
                    status="running",
                    port=5174,
                    message="Frontend is already running on port 5174.",
                )
            )
        else:
            schedule_frontend_start()
            actions.append(
                ServiceRestartAction(
                    service="frontend",
                    accepted=True,
                    status="scheduled",
                    port=5174,
                    message="Frontend start scheduled on port 5174.",
                )
            )
    except Exception as exc:
        actions.append(
            ServiceRestartAction(
                service="frontend",
                accepted=False,
                status="blocked",
                port=5174,
                message=f"Frontend could not be started: {exc}",
            )
        )
    try:
        schedule_backend_restart()
        actions.append(
            ServiceRestartAction(
                service="backend",
                accepted=True,
                status="scheduled",
                port=9000,
                message="Backend restart scheduled on port 9000.",
            )
        )
    except Exception as exc:
        actions.append(
            ServiceRestartAction(
                service="backend",
                accepted=False,
                status="blocked",
                port=9000,
                message=f"Backend restart could not be scheduled: {exc}",
            )
        )
    accepted_count = sum(1 for item in actions if item.accepted)
    if accepted_count == len(actions):
        status = "scheduled"
    elif accepted_count > 0:
        status = "partial"
    else:
        status = "blocked"
    return AllServicesRestartResponse(
        accepted=accepted_count > 0,
        status=status,
        message="Service restart request processed. Backend may be offline for a few seconds.",
        actions=actions,
    )


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
    trailing_states.clear()
    trailing_last_attempts.clear()
    hard_tp_last_attempts.clear()
    recovery_cycles.clear()
    if RECOVERY_STATE_PATH.exists():
        RECOVERY_STATE_PATH.unlink()
    auto_last_scan = None
    auto_last_action = None
    auto_blocked_reason = None
    pair_state_store.reset()
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
    process_trailing_positions()
    return build_auto_status()


@app.get("/api/auto-trailing/status", response_model=AutoTrailingStatus)
def auto_trailing_status():
    process_trailing_positions()
    return build_auto_trailing_status()


@app.get("/api/recovery/status", response_model=RecoveryEngineStatus)
def recovery_status():
    return build_recovery_engine_status()


@app.post("/api/recovery/scan-now", response_model=RecoveryEngineStatus)
def recovery_scan_now():
    return process_recovery_engine()


@app.post("/api/auto-mode", response_model=AutoModeStatus)
def set_auto_mode(request: AutoModeRequest):
    global auto_config, auto_last_action, auto_blocked_reason
    if request.accountMode != auto_config.accountMode:
        active_cycles = any(symbol_has_active_recovery_cycle(symbol) for symbol in SCAN_SYMBOLS)
        engine_positions = any(is_recovery_engine_position(position) for position in bridge.open_positions())
        if active_cycles or engine_positions:
            raise HTTPException(
                status_code=409,
                detail="Account mode cannot change while a hedge/recovery basket is active. Close or finish the basket first.",
            )
        recovery_cycles.clear()
        save_recovery_cycles()
    if not request.activeSymbols:
        request.activeSymbols = list(SCAN_SYMBOLS)
    request = apply_strategy_profile(request)
    auto_config = request
    write_json_atomic(STRATEGY_SETTINGS_PATH, auto_config.model_dump(mode="json"))
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


@app.get("/api/market/regimes", response_model=MarketRegimeCollection)
def market_regimes():
    items = []
    for symbol in SCAN_SYMBOLS:
        technical = investing_current_technical(symbol)
        pivot = None
        pivot_raw = technical.get("pivot_points", {}).get("PIVOT")
        if isinstance(pivot_raw, dict):
            pivot = pivot_raw.get("value")
        elif isinstance(pivot_raw, (int, float)):
            pivot = float(pivot_raw)
        for timeframe in SCAN_TIMEFRAMES:
            candles = bridge.fetch_candles(symbol, timeframe)
            items.append(classify_market_regime(candles, pivot, symbol, timeframe))
    return MarketRegimeCollection(generatedAt=datetime.now(timezone.utc).isoformat(), items=items)


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
            equity=account_equity_usd(),
            spread_points=snapshot.spread_points,
        )
        signal.lot = validation.lot if validation.valid else None
        signal.riskPercent = validation.risk_percent
        signal.blockedReasons.extend(validation.blockedReasons)
    apply_investing_filter(signal, pair_profile(signal.symbol).investingMode)
    record_potential_signal(snapshot, signal)


@app.post("/api/orders/validate", response_model=OrderValidation)
def validate_order_endpoint(request: RiskRequest):
    _, _, spread = bridge.tick(request.symbol)
    return validate_order(request, equity=account_equity_usd(), spread_points=spread)


@app.post("/api/orders/execute", response_model=ExecuteOrderResponse)
def execute_order(request: ExecuteOrderRequest):
    if not request.confirmed:
        raise HTTPException(status_code=400, detail="Order confirmation is required before execution.")
    _, _, spread = bridge.tick(request.symbol)
    validation = validate_order(request, equity=account_equity_usd(), spread_points=spread)
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
    process_trailing_positions()
    return bridge.open_positions()


@app.get("/api/positions/alerts", response_model=list[PositionSetupAlert])
def position_alerts():
    process_trailing_positions()
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
    result = sorted(combined.values(), key=lambda item: item.time, reverse=True)
    sync_pair_states_from_closed_trades(result)
    return result


@app.get("/api/signal-log", response_model=list[SignalLogEntry])
def signal_log(limit: int = Query(100, ge=1, le=500)):
    return read_signal_log(limit=limit)


@app.get("/api/signal-audit")
def signal_audit(limit: int = Query(100, ge=1, le=500)):
    if not SIGNAL_AUDIT_PATH.exists():
        return []
    records: list[dict] = []
    try:
        with SIGNAL_AUDIT_PATH.open("r", encoding="utf-8") as file:
            for line in file:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return []
    return records[-limit:][::-1]


@app.get("/api/pair-state")
def pair_state_status():
    sync_pair_states_from_closed_trades()
    return {
        "healthy": not pair_state_store.corrupt,
        "error": pair_state_store.error,
        "states": {
            symbol: pair_state_store.get(symbol).model_dump(mode="json")
            for symbol in SCAN_SYMBOLS
        },
    }


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
            equity=account_equity_usd(account),
            max_total_risk_percent=auto_config.maxTotalRiskPercent,
        )
    return AutoModeStatus(
        configVersion=auto_config.configVersion,
        strategyProfile=auto_config.strategyProfile,
        shadowMode=auto_config.shadowMode,
        enabled=auto_config.enabled,
        accountMode=auto_config.accountMode,
        pairProfiles=auto_config.pairProfiles,
        activeSymbols=list(active_scan_symbols()),
        hardTakeProfitUsd=auto_config.hardTakeProfitUsd,
        recoveryEnabled=auto_config.recoveryEnabled,
        reversalHedgeScore=auto_config.reversalHedgeScore,
        recoveryResumeScore=auto_config.recoveryResumeScore,
        hedgeRatio=auto_config.hedgeRatio,
        hedgeProfitUsd=auto_config.hedgeProfitUsd,
        recoveryMultiplier=auto_config.recoveryMultiplier,
        maxRecoveryLayers=auto_config.maxRecoveryLayers,
        basketTargetUsd=auto_config.basketTargetUsd,
        basketMaxLossUsd=auto_config.basketMaxLossUsd,
        recoveryCooldownSeconds=auto_config.recoveryCooldownSeconds,
        shockAtrMultiplier=auto_config.shockAtrMultiplier,
        maxTotalRiskPercent=auto_config.maxTotalRiskPercent,
        maxTotalOpenPositionsAllPairs=auto_config.maxTotalOpenPositionsAllPairs,
        minScore=auto_config.minScore,
        riskMode=auto_config.riskMode,
        riskValue=auto_config.riskValue,
        scanIntervalSeconds=auto_config.scanIntervalSeconds,
        duplicateCooldownMinutes=auto_config.duplicateCooldownMinutes,
        lastScan=auto_last_scan,
        lastAction=auto_last_action,
        blockedReason=auto_blocked_reason,
        exposure=exposure,
        minimumBalance=build_minimum_balance_estimate(exposure.equity),
        pairExposure=build_all_pair_exposure(),
    )


def build_all_pair_exposure() -> list[PairExposureStatus]:
    account = bridge.status()
    balance_usd = usd_from_broker_money(account.balance)
    equity_usd = usd_from_broker_money(account.equity)
    positions = bridge.open_positions()
    pending = bridge.pending_orders()
    return [
        build_pair_exposure(
            symbol,
            pair_profile(symbol),
            pair_state_store.get(symbol),
            positions,
            pending,
            balance_usd,
            equity_usd,
            shadow_transition=auto_config.shadowMode,
        )
        for symbol in SCAN_SYMBOLS
    ]


def sync_pair_states_from_closed_trades(entries: list[TradingJournalEntry] | None = None) -> None:
    if pair_state_store.corrupt:
        return
    source = entries if entries is not None else bridge.recent_closed_deals()
    now = datetime.now(timezone.utc)
    today = now.date()
    hour_ago = now - timedelta(hours=1)
    for symbol in SCAN_SYMBOLS:
        profile = pair_profile(symbol)
        pair_entries = sorted(
            [entry for entry in source if entry.symbol == symbol],
            key=lambda item: item.time,
        )
        daily_entries: list[TradingJournalEntry] = []
        hourly_entries: list[TradingJournalEntry] = []
        for entry in pair_entries:
            try:
                closed_at = datetime.fromisoformat(entry.time)
                if closed_at.tzinfo is None:
                    closed_at = closed_at.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if closed_at.date() == today:
                daily_entries.append(entry)
            if closed_at >= hour_ago:
                hourly_entries.append(entry)
        loss_streak = 0
        for entry in reversed(pair_entries):
            if entry.closeReason == "sl" or (entry.profit or 0) < 0:
                loss_streak += 1
            else:
                break
        latest_sl = next(
            (entry for entry in reversed(pair_entries) if entry.closeReason == "sl"),
            None,
        )
        locked_until = None
        lock_reason = None
        if latest_sl and profile.cooldownAfterSlMinutes > 0:
            try:
                latest_sl_at = datetime.fromisoformat(latest_sl.time)
                if latest_sl_at.tzinfo is None:
                    latest_sl_at = latest_sl_at.replace(tzinfo=timezone.utc)
                candidate_lock = latest_sl_at + timedelta(minutes=profile.cooldownAfterSlMinutes)
                if candidate_lock > now:
                    locked_until = candidate_lock.isoformat()
                    lock_reason = f"{symbol} blocked: cooldown after stop loss"
            except ValueError:
                pass
        if profile.lockAfterConsecutiveSl > 0 and loss_streak >= profile.lockAfterConsecutiveSl:
            locked_until = (now + timedelta(days=1)).isoformat()
            lock_reason = f"{symbol} blocked: consecutive stop-loss lock"
        daily_loss_usd = abs(sum(min(usd_from_broker_money(entry.profit or 0), 0) for entry in daily_entries))
        try:
            equity_usd = max(account_equity_usd(), 0.01)
        except AttributeError:
            equity_usd = 0.01
        daily_loss_percent = round(daily_loss_usd / equity_usd * 100, 3)
        if profile.dailyLossLimitPercent > 0 and daily_loss_percent >= profile.dailyLossLimitPercent:
            locked_until = datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).isoformat()
            lock_reason = f"{symbol} blocked: daily loss limit reached"
        current = pair_state_store.get(symbol)
        changes = {
            "lossStreak": loss_streak,
            "lastSlAt": latest_sl.time if latest_sl else None,
            "lockedUntil": locked_until,
            "lockReason": lock_reason,
            "dailyLossUsd": round(daily_loss_usd, 2),
            "dailyLossPercent": daily_loss_percent,
            "dailyTradeCount": len(daily_entries),
            "hourlyTradeCount": len(hourly_entries),
            "lastProcessedCloseTime": pair_entries[-1].time if pair_entries else None,
        }
        if any(getattr(current, key) != value for key, value in changes.items()):
            pair_state_store.update(symbol, **changes)


@app.get("/api/pair-exposure", response_model=list[PairExposureStatus])
def pair_exposure_status():
    sync_pair_states_from_closed_trades()
    return build_all_pair_exposure()


def build_minimum_balance_estimate(current_equity_usd: float, force: bool = False) -> MinimumBalanceEstimate:
    global minimum_balance_cache
    symbols = active_scan_symbols()
    now = datetime.now(timezone.utc)
    if (
        not force
        and minimum_balance_cache is not None
        and minimum_balance_cache[1] == symbols
        and minimum_balance_cache[2] == auto_config.accountMode
        and now - minimum_balance_cache[0] < timedelta(seconds=60)
    ):
        cached = minimum_balance_cache[3].model_copy(
            update={
                "currentEquityUsd": round(current_equity_usd, 2),
                "sufficient": current_equity_usd >= minimum_balance_cache[3].recommendedUsd,
            }
        )
        return cached

    fallback_risk_usd: dict[Symbol, float] = {"XAUUSD": 30.0, "EURUSD": 3.0}
    pair_estimates: list[MinimumBalancePair] = []
    for symbol in symbols:
        worst_risk = 0.0
        source_timeframe: Timeframe | None = None
        for timeframe in EXECUTION_TIMEFRAMES:
            try:
                snapshot = market_snapshot(symbol, timeframe)
                signal = recommend(snapshot, RiskMode.FIXED_LOT, MIN_LOT[symbol])
            except Exception:
                continue
            if signal.entry and signal.stopLoss:
                candidate_risk = risk_usd_for(symbol, signal.entry, signal.stopLoss, MIN_LOT[symbol])
                if candidate_risk > worst_risk:
                    worst_risk = candidate_risk
                    source_timeframe = timeframe
        if worst_risk <= 0:
            worst_risk = fallback_risk_usd[symbol]
        required_equity = worst_risk / (MAX_RISK_PERCENT / 100)
        pair_estimates.append(
            MinimumBalancePair(
                symbol=symbol,
                riskAtMinLotUsd=round(worst_risk, 2),
                requiredEquityUsd=round(required_equity, 2),
                sourceTimeframe=source_timeframe,
            )
        )

    minimum_usd = max((item.requiredEquityUsd for item in pair_estimates), default=0.0)
    reserve_percent = 25.0
    recommended_usd = math.ceil((minimum_usd * (1 + reserve_percent / 100)) / 100) * 100
    factor = account_money_factor()
    estimate = MinimumBalanceEstimate(
        minimumUsd=round(minimum_usd, 2),
        recommendedUsd=round(recommended_usd, 2),
        minimumAccountUnits=round(minimum_usd * factor, 2),
        recommendedAccountUnits=round(recommended_usd * factor, 2),
        currentEquityUsd=round(current_equity_usd, 2),
        sufficient=current_equity_usd >= recommended_usd,
        reservePercent=reserve_percent,
        minLot=0.01,
        maxRiskPerPositionPercent=MAX_RISK_PERCENT,
        pairs=pair_estimates,
        message=(
            "Recommended balance uses the widest current M15/M30/H1 strategy stop at 0.01 lot, "
            "the 0.5% per-position risk guard, and a 25% operating reserve."
        ),
    )
    minimum_balance_cache = (now, symbols, auto_config.accountMode, estimate)
    return estimate


def default_recovery_cycle(symbol: Symbol) -> RecoveryCycleStatus:
    return RecoveryCycleStatus(symbol=symbol, phase="NORMAL")


def is_recovery_engine_position(position: OpenPosition) -> bool:
    comment = (position.comment or "").upper()
    return comment.startswith(HEDGE_COMMENT_PREFIX) or comment.startswith(RECOVERY_COMMENT_PREFIX)


def is_hedge_position(position: OpenPosition) -> bool:
    return (position.comment or "").upper().startswith(HEDGE_COMMENT_PREFIX)


def is_recovery_position(position: OpenPosition) -> bool:
    return (position.comment or "").upper().startswith(RECOVERY_COMMENT_PREFIX)


def symbol_has_active_recovery_cycle(symbol: Symbol) -> bool:
    cycle = recovery_cycles.get(symbol)
    return cycle is not None and cycle.phase in {"HEDGE_ACTIVE", "WAIT_RECOVERY", "RECOVERY_ACTIVE"}


def build_recovery_engine_status(message: str | None = None) -> RecoveryEngineStatus:
    enabled = auto_config.enabled and auto_config.recoveryEnabled
    cycles = [
        recovery_cycles.get(symbol, default_recovery_cycle(symbol))
        for symbol in SCAN_SYMBOLS
    ]
    if message is None:
        if enabled:
            message = "Recovery engine active: partial hedge, confirmed recovery entry, and basket exit."
        elif not auto_config.enabled:
            message = "Recovery engine stopped because Full Auto is OFF."
        else:
            message = "Recovery engine is OFF. Enable it in Strategy & risk settings."
    return RecoveryEngineStatus(
        enabled=enabled,
        monitorIntervalSeconds=RECOVERY_MONITOR_INTERVAL_SECONDS,
        cycles=cycles,
        message=message,
    )


def recovery_cooldown_elapsed(cycle: RecoveryCycleStatus, now: datetime) -> bool:
    if not cycle.updatedAt:
        return True
    try:
        last_action = datetime.fromisoformat(cycle.updatedAt)
    except ValueError:
        return True
    if last_action.tzinfo is None:
        last_action = last_action.replace(tzinfo=timezone.utc)
    return now - last_action >= timedelta(seconds=auto_config.recoveryCooldownSeconds)


def set_recovery_action(cycle: RecoveryCycleStatus, action: str, now: datetime) -> None:
    cycle.lastAction = action
    cycle.updatedAt = now.isoformat()


def record_recovery_close(position: OpenPosition, reason: str) -> None:
    add_journal(
        TradingJournalEntry(
            time=datetime.now(timezone.utc).isoformat(),
            ticket=position.ticket,
            symbol=position.symbol,
            side=position.side,
            volume=position.volume,
            entry=position.open_price,
            exit=position.current_price,
            profit=position.profit,
            closeReason="tp" if position.profit >= 0 else "sl",
            source="app",
            note=reason,
        )
    )
    add_history(position.symbol, "M15", 0, "RECOVERY_CLOSE", "closed")


def close_recovery_positions(
    positions_to_close: list[OpenPosition],
    reason: str,
) -> tuple[int, int, float]:
    closed = 0
    failed = 0
    realized_profit = 0.0
    for position in positions_to_close:
        accepted, _ticket, _message, closed_position = bridge.close_position(ticket=position.ticket)
        if accepted:
            closed += 1
            realized_profit += position.profit
            record_recovery_close(closed_position or position, reason)
        else:
            failed += 1
    return closed, failed, round(realized_profit, 2)


def open_recovery_order(
    symbol: Symbol,
    side: Side,
    requested_lot: float,
    candles: list[Candle],
    comment: str,
    current_positions: list[OpenPosition],
    account_equity: float,
) -> tuple[bool, int | None, str]:
    profile = pair_profile(symbol)
    if not profile.recoveryEnabled:
        return False, None, f"{symbol} recovery is disabled by pair profile."
    state = pair_state_store.get(symbol)
    if profile.closeOnly or state.closeOnlyMode:
        return False, None, f"{symbol} recovery blocked: pair is CLOSE_ONLY."
    lot = round_down_lot(min(requested_lot, 0.10), 0.01)
    lot = min(lot, profile.maxLot)
    if lot < 0.01:
        return False, None, "Recovery lot is below broker minimum."
    bid, ask, spread = bridge.tick(symbol)
    if spread > MAX_SPREAD[symbol]:
        return False, None, f"Recovery order blocked by spread {spread:g}/{MAX_SPREAD[symbol]:g} pts."
    atr = atr_price(candles)
    if atr <= 0:
        return False, None, "Recovery order blocked because ATR is unavailable."
    entry = ask if side == Side.BUY else bid
    if side == Side.BUY:
        stop_loss = entry - atr * 1.2
        take_profit = entry + atr * 2.0
        order_type = OrderType.BUY_MARKET
    else:
        stop_loss = entry + atr * 1.2
        take_profit = entry - atr * 2.0
        order_type = OrderType.SELL_MARKET
    request = ExecuteOrderRequest(
        symbol=symbol,
        timeframe="M15",
        side=side,
        orderType=order_type,
        entry=entry,
        stopLoss=stop_loss,
        takeProfit=take_profit,
        riskMode=RiskMode.FIXED_LOT,
        riskValue=lot,
        lot=lot,
        confirmed=True,
        comment=comment,
    )
    validation = validate_order(request, equity=account_equity, spread_points=spread)
    if not validation.valid or validation.lot is None:
        return False, None, "; ".join(validation.blockedReasons) or "Recovery order failed validation."
    candidate_exposure = build_risk_exposure(
        current_positions,
        bridge.pending_orders(),
        equity=account_equity,
        max_total_risk_percent=auto_config.maxTotalRiskPercent,
        candidate=RiskExposureItem(
            symbol=symbol,
            source="candidate",
            entry=entry,
            stopLoss=stop_loss,
            lot=validation.lot,
        ),
    )
    if candidate_exposure.blocked:
        return False, None, "; ".join(candidate_exposure.blockedReasons)
    lock = pair_exposure_locks[symbol]
    if not lock.acquire(timeout=2):
        return False, None, f"{symbol} blocked: exposure check lock unavailable"
    try:
        account = bridge.status() if hasattr(bridge, "status") else None
        positions_snapshot = bridge.open_positions() if hasattr(bridge, "open_positions") else current_positions
        pair_exposure = build_pair_exposure(
            symbol,
            profile,
            state,
            positions_snapshot,
            bridge.pending_orders(),
            usd_from_broker_money(account.balance) if account else account_equity,
            usd_from_broker_money(account.equity) if account else account_equity,
            (entry, stop_loss, validation.lot, side),
            enforce_trade_limits=False,
            shadow_transition=auto_config.shadowMode,
        )
        if pair_exposure.status in {"BLOCKED", "CLOSE_ONLY", "LOCKED"}:
            return False, None, "; ".join(pair_exposure.reasons) or f"{symbol} recovery blocked by exposure state."
        if auto_config.shadowMode:
            return False, None, "SHADOW PASS: recovery order not sent"
        return bridge.send_order(request, fallback_lot=validation.lot)
    finally:
        lock.release()


def process_recovery_engine() -> RecoveryEngineStatus:
    with recovery_lock:
        if not auto_config.enabled or not auto_config.recoveryEnabled:
            return build_recovery_engine_status()

        account = bridge.status()
        if not account.connected:
            return build_recovery_engine_status("Recovery engine waiting: MT5 is offline.")
        if not account.trade_ready:
            return build_recovery_engine_status("Recovery engine waiting: enable Algo Trading in MT5.")
        if account.demo_guard_enabled and account.live_account:
            return build_recovery_engine_status("Recovery engine blocked by demo guard on a live account.")

        now = datetime.now(timezone.utc)
        all_positions = bridge.open_positions()
        state_changed = False

        for symbol in active_scan_symbols():
            if not pair_profile(symbol).recoveryEnabled:
                continue
            cycle = recovery_cycles.get(symbol)
            if cycle is None:
                cycle = default_recovery_cycle(symbol)
                recovery_cycles[symbol] = cycle
                state_changed = True

            symbol_positions = [position for position in all_positions if position.symbol == symbol]
            hedge_positions = [position for position in symbol_positions if is_hedge_position(position)]
            recovery_positions = [position for position in symbol_positions if is_recovery_position(position)]
            main_positions = [position for position in symbol_positions if not is_recovery_engine_position(position)]

            cycle.mainTickets = [position.ticket for position in main_positions]
            cycle.hedgeTickets = [position.ticket for position in hedge_positions]
            cycle.recoveryTickets = [position.ticket for position in recovery_positions]
            cycle.openBasketProfit = round(sum(position.profit for position in symbol_positions), 2)
            cycle.basketProfit = round(cycle.openBasketProfit + cycle.realizedHedgeProfit, 2)

            if not main_positions:
                if hedge_positions or recovery_positions:
                    closed, failed, _profit = close_recovery_positions(
                        hedge_positions + recovery_positions,
                        "Recovery engine closed orphaned protection positions because the main position no longer exists.",
                    )
                    set_recovery_action(cycle, f"Closed {closed} orphaned recovery position(s); {failed} failed.", now)
                    state_changed = True
                elif cycle.phase not in {"BASKET_EXIT", "EMERGENCY_EXIT", "NORMAL"}:
                    recovery_cycles[symbol] = default_recovery_cycle(symbol)
                    state_changed = True
                continue

            main_sides = {position.side for position in main_positions}
            if len(main_sides) != 1:
                cycle.lastAction = "Recovery blocked: untagged main positions have mixed BUY and SELL sides."
                continue
            main_side = next(iter(main_sides))

            if cycle.phase in {"BASKET_EXIT", "EMERGENCY_EXIT"}:
                cycle = default_recovery_cycle(symbol)
                recovery_cycles[symbol] = cycle
                state_changed = True
            if cycle.mainSide is not None and cycle.mainSide != main_side and (hedge_positions or recovery_positions):
                closed, failed, _profit = close_recovery_positions(
                    hedge_positions + recovery_positions,
                    "Recovery engine closed protection positions after the main direction changed.",
                )
                cycle = default_recovery_cycle(symbol)
                cycle.lastAction = f"Main direction changed; closed {closed} engine position(s), {failed} failed."
                recovery_cycles[symbol] = cycle
                state_changed = True
                continue

            cycle.mainSide = main_side
            cycle.mainTickets = [position.ticket for position in main_positions]
            cycle.hedgeTickets = [position.ticket for position in hedge_positions]
            cycle.recoveryTickets = [position.ticket for position in recovery_positions]

            m15_candles = bridge.fetch_candles(symbol, "M15")
            m30_candles = bridge.fetch_candles(symbol, "M30")
            score, reasons = reversal_score(
                main_side,
                m15_candles,
                m30_candles,
                auto_config.shockAtrMultiplier,
            )
            cycle.reversalScore = score
            active_cycle = (
                cycle.phase != "NORMAL"
                or bool(hedge_positions)
                or bool(recovery_positions)
                or cycle.recoveryLayers > 0
                or cycle.realizedHedgeProfit != 0
            )

            basket_target = broker_money_from_usd(auto_config.basketTargetUsd[symbol])
            basket_max_loss = broker_money_from_usd(auto_config.basketMaxLossUsd[symbol])
            hedge_target = broker_money_from_usd(auto_config.hedgeProfitUsd[symbol])
            if active_cycle and cycle.basketProfit >= basket_target:
                closed, failed, _profit = close_recovery_positions(
                    symbol_positions,
                    f"Recovery basket target reached at {format_account_money(cycle.basketProfit)}.",
                )
                if failed == 0:
                    cycle.phase = "BASKET_EXIT"
                set_recovery_action(cycle, f"Basket target exit: {closed} closed, {failed} failed.", now)
                state_changed = True
                continue
            if active_cycle and cycle.basketProfit <= -basket_max_loss:
                closed, failed, _profit = close_recovery_positions(
                    symbol_positions,
                    f"Recovery emergency loss cap reached at {format_account_money(cycle.basketProfit)}.",
                )
                if failed == 0:
                    cycle.phase = "EMERGENCY_EXIT"
                set_recovery_action(cycle, f"Emergency basket exit: {closed} closed, {failed} failed.", now)
                state_changed = True
                continue

            if hedge_positions:
                cycle.phase = "HEDGE_ACTIVE"
                hedge_profit = round(sum(position.profit for position in hedge_positions), 2)
                if hedge_profit >= hedge_target:
                    closed, failed, realized = close_recovery_positions(
                        hedge_positions,
                        f"Partial hedge target reached at {format_account_money(hedge_profit)}.",
                    )
                    cycle.realizedHedgeProfit = round(cycle.realizedHedgeProfit + realized, 2)
                    if failed == 0:
                        cycle.phase = "WAIT_RECOVERY"
                        cycle.hedgeTickets = []
                    set_recovery_action(
                        cycle,
                        f"Hedge target: {closed} closed, {failed} failed, {format_account_money(realized)} realized.",
                        now,
                    )
                    state_changed = True
                continue

            cooldown_ready = recovery_cooldown_elapsed(cycle, now)
            if (
                cycle.phase == "WAIT_RECOVERY"
                and cycle.recoveryLayers < auto_config.maxRecoveryLayers
                and score <= auto_config.recoveryResumeScore
                and recovery_confirmed(main_side, m15_candles)
                and cooldown_ready
            ):
                base_lot = max(position.volume for position in main_positions)
                requested_lot = base_lot * (auto_config.recoveryMultiplier ** (cycle.recoveryLayers + 1))
                next_layer = cycle.recoveryLayers + 1
                accepted, ticket, message = open_recovery_order(
                    symbol,
                    main_side,
                    requested_lot,
                    m15_candles,
                    f"{RECOVERY_COMMENT_PREFIX}{next_layer}-{symbol}",
                    all_positions,
                    account_equity_usd(account),
                )
                if accepted:
                    cycle.phase = "RECOVERY_ACTIVE"
                    cycle.recoveryLayers = next_layer
                    set_recovery_action(cycle, f"Recovery layer {next_layer} opened {main_side.value} ticket {ticket}.", now)
                    add_history(symbol, "M15", score, f"RECOVERY_{main_side.value}", "sent")
                    state_changed = True
                else:
                    cycle.lastAction = f"Recovery layer {next_layer} blocked: {message}"
                continue

            if score >= auto_config.reversalHedgeScore and cooldown_ready:
                directional_positions = [
                    position
                    for position in main_positions + recovery_positions
                    if position.side == main_side
                ]
                requested_lot = sum(position.volume for position in directional_positions) * auto_config.hedgeRatio
                hedge_side = Side.SELL if main_side == Side.BUY else Side.BUY
                accepted, ticket, message = open_recovery_order(
                    symbol,
                    hedge_side,
                    requested_lot,
                    m15_candles,
                    f"{HEDGE_COMMENT_PREFIX}{symbol}",
                    all_positions,
                    account_equity_usd(account),
                )
                if accepted:
                    cycle.phase = "HEDGE_ACTIVE"
                    set_recovery_action(
                        cycle,
                        f"Partial hedge opened {hedge_side.value} ticket {ticket}; score {score}: {', '.join(reasons[-3:])}.",
                        now,
                    )
                    add_history(symbol, "M15", score, f"HEDGE_{hedge_side.value}", "sent")
                    state_changed = True
                else:
                    cycle.lastAction = f"Hedge blocked at score {score}: {message}"
            elif cycle.phase == "NORMAL":
                cycle.lastAction = f"Monitoring reversal score {score}/{auto_config.reversalHedgeScore}."

        if state_changed:
            save_recovery_cycles()
        return build_recovery_engine_status()


def cleanup_trailing_states(open_tickets: set[int]) -> None:
    closed_tickets = [ticket for ticket in trailing_states if ticket not in open_tickets]
    for ticket in closed_tickets:
        trailing_states.pop(ticket, None)
        trailing_last_attempts.pop(ticket, None)
        hard_tp_last_attempts.pop(ticket, None)


def get_or_create_trailing_state(position: OpenPosition) -> TrailingState:
    if position.stopLoss is None:
        raise ValueError("Trailing state requires an existing stop loss")
    state = trailing_states.get(position.ticket)
    if state is None:
        state = TrailingState(
            ticket=position.ticket,
            symbol=position.symbol,
            side=position.side,
            open_price=position.open_price,
            original_sl=position.stopLoss,
            current_sl=position.stopLoss,
        )
        trailing_states[position.ticket] = state
    return state


def process_trailing_position(
    position: OpenPosition,
    state: TrailingState,
    current_bid: float,
    current_ask: float,
    config: dict[str, float],
) -> float | None:
    current_price = current_bid if position.side == Side.BUY else current_ask
    if "trigger_pips" in config:
        profit_pips = (
            (current_price - position.open_price) / config["pip_size"]
            if position.side == Side.BUY
            else (position.open_price - current_price) / config["pip_size"]
        )
        if profit_pips >= config.get("break_even_trigger_pips", config["trigger_pips"]):
            lock_distance = config.get("break_even_lock_pips", 0.0) * config["pip_size"]
            break_even_sl = position.open_price + lock_distance if position.side == Side.BUY else position.open_price - lock_distance
            improves = break_even_sl > state.current_sl if position.side == Side.BUY else break_even_sl < state.current_sl
            if improves and profit_pips < config["trigger_pips"]:
                state.current_sl = break_even_sl
                return break_even_sl
        if profit_pips < config["trigger_pips"]:
            return None

    if not state.trailing_active:
        if "trigger_pips" in config or position.profit >= config["trigger_usd"]:
            state.trailing_active = True
            state.peak_price = current_bid if position.side == Side.BUY else current_ask
        else:
            return None

    if position.side == Side.BUY:
        if current_price > state.peak_price:
            state.peak_price = current_price
    elif current_price < state.peak_price:
        state.peak_price = current_price

    distance = config["distance_pips"] * config["pip_size"]
    step = config["step_pips"] * config["pip_size"]

    if position.side == Side.BUY:
        ideal_sl = state.peak_price - distance
        ideal_sl = max(ideal_sl, state.original_sl)
        if ideal_sl <= state.current_sl:
            return None
    else:
        ideal_sl = state.peak_price + distance
        ideal_sl = min(ideal_sl, state.original_sl)
        if ideal_sl >= state.current_sl:
            return None

    if abs(ideal_sl - state.current_sl) < step:
        return None

    state.current_sl = ideal_sl
    return ideal_sl


def process_trailing_positions() -> list[ClosePositionResult]:
    global auto_last_action
    results: list[ClosePositionResult] = []
    now = datetime.now(timezone.utc)
    positions = bridge.open_positions()
    cleanup_trailing_states({position.ticket for position in positions})
    for position in positions:
        if is_recovery_engine_position(position) or symbol_has_active_recovery_cycle(position.symbol):
            continue
        hard_tp_usd = auto_config.hardTakeProfitUsd.get(position.symbol, AUTO_TAKE_PROFIT_USD)
        hard_tp_broker = broker_money_from_usd(hard_tp_usd)
        if position.profit >= hard_tp_broker:
            last_attempt = hard_tp_last_attempts.get(position.ticket)
            if last_attempt is not None and now - last_attempt < timedelta(seconds=3):
                continue
            hard_tp_last_attempts[position.ticket] = now
            accepted, ticket, message, closed_position = bridge.close_position(ticket=position.ticket)
            results.append(
                ClosePositionResult(
                    accepted=accepted,
                    ticket=ticket or position.ticket,
                    symbol=position.symbol,
                    message=message,
                )
            )
            if accepted and closed_position:
                record_hard_take_profit(ticket, closed_position, hard_tp_usd)
                auto_last_action = (
                    f"Hard TP closed {closed_position.symbol} ticket {ticket} "
                    f"at {format_account_money(closed_position.profit)} floating profit"
                )
            continue
        if position.stopLoss is None:
            continue
        base_config = TRAILING_CONFIG.get(position.symbol)
        if base_config is None:
            continue
        config = {
            **base_config,
            "trigger_usd": broker_money_from_usd(base_config["trigger_usd"]),
        }
        if position.symbol == "EURUSD":
            profile = pair_profile("EURUSD")
            config.update(
                {
                    "trigger_pips": profile.trailingTriggerPips,
                    "break_even_trigger_pips": profile.trailingBreakEvenTriggerPips,
                    "break_even_lock_pips": profile.trailingBreakEvenLockPips,
                    "distance_pips": profile.trailingDistancePips,
                    "step_pips": profile.trailingStepPips,
                }
            )
        state = get_or_create_trailing_state(position)
        last_attempt = trailing_last_attempts.get(position.ticket)
        if last_attempt is not None and now - last_attempt < timedelta(seconds=3):
            continue
        bid, ask, _spread = bridge.tick(position.symbol)
        new_sl = process_trailing_position(position, state, bid, ask, config)
        if new_sl is None:
            continue
        trailing_last_attempts[position.ticket] = now
        accepted, message, old_sl, modified_sl = bridge.modify_position_stop(
            ticket=position.ticket,
            stop_loss=new_sl,
            take_profit=position.takeProfit,
        )
        close_result = ClosePositionResult(
            accepted=accepted,
            ticket=position.ticket,
            symbol=position.symbol,
            message=message,
        )
        results.append(close_result)
        if accepted:
            auto_last_action = f"Trailing SL updated {position.symbol} ticket {position.ticket} from {old_sl} to {modified_sl}"
        else:
            state.current_sl = position.stopLoss
    return results


def record_hard_take_profit(ticket: int | None, position: OpenPosition, hard_tp_usd: float) -> None:
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
            note=f"Hard take profit requested at floating profit >= ${hard_tp_usd:.2f}",
        )
    )
    add_history(position.symbol, "H1", 0, "HARD_TP_10_USD", "closed")


def build_auto_trailing_status() -> AutoTrailingStatus:
    rules = [
        AutoTrailingRule(
            symbol=symbol,
            triggerUsd=auto_config.hardTakeProfitUsd.get(symbol, config["trigger_usd"]),
            distancePips=pair_profile(symbol).trailingDistancePips if symbol == "EURUSD" else config["distance_pips"],
            stepPips=pair_profile(symbol).trailingStepPips if symbol == "EURUSD" else config["step_pips"],
            pipSize=config["pip_size"],
        )
        for symbol, config in TRAILING_CONFIG.items()
    ]
    states = [
        AutoTrailingStateItem(
            ticket=state.ticket,
            symbol=state.symbol,
            side=state.side,
            openPrice=state.open_price,
            originalStopLoss=state.original_sl,
            currentStopLoss=state.current_sl,
            trailingActive=state.trailing_active,
            peakPrice=state.peak_price,
            lastAttempt=trailing_last_attempts.get(state.ticket).isoformat() if state.ticket in trailing_last_attempts else None,
        )
        for state in sorted(trailing_states.values(), key=lambda item: item.ticket)
    ]
    active_tickets = sum(1 for state in states if state.trailingActive)
    return AutoTrailingStatus(
        monitorIntervalSeconds=TRAILING_MONITOR_INTERVAL_SECONDS,
        trackedTickets=len(states),
        activeTickets=active_tickets,
        rules=rules,
        states=states,
        message=(
            f"Hard TP has priority outside active recovery baskets; trailing tracks {len(states)} ticket(s), "
            f"{active_tickets} active below the configured hard-close threshold."
        ),
    )


async def trailing_monitor_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(process_trailing_positions)
        except Exception:
            pass
        await asyncio.sleep(TRAILING_MONITOR_INTERVAL_SECONDS)


async def recovery_monitor_loop() -> None:
    while True:
        try:
            if auto_config.enabled and auto_config.recoveryEnabled:
                await asyncio.to_thread(process_recovery_engine)
        except Exception:
            pass
        await asyncio.sleep(RECOVERY_MONITOR_INTERVAL_SECONDS)


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


def run_auto_scan() -> AutoScanResponse:
    global auto_last_scan, auto_last_action, auto_blocked_reason
    auto_last_scan = datetime.now(timezone.utc).isoformat()
    sync_pair_states_from_closed_trades()
    account = bridge.status()
    exposure = build_risk_exposure(
        bridge.open_positions(),
        bridge.pending_orders(),
        equity=account_equity_usd(account),
        max_total_risk_percent=auto_config.maxTotalRiskPercent,
    )
    blocked: list[str] = []
    actions: list[AutoExecutionItem] = []

    if not auto_config.enabled:
        auto_blocked_reason = "Auto mode is OFF"
        return AutoScanResponse(status=build_auto_status(exposure), scanned=0, eligible=0, executed=0, blocked=[auto_blocked_reason], actions=[])
    if pair_state_store.corrupt:
        auto_blocked_reason = "AUTO blocked: pair state file corrupt"
        return AutoScanResponse(status=build_auto_status(exposure), scanned=0, eligible=0, executed=0, blocked=[auto_blocked_reason], actions=[])
    process_trailing_positions()
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
        profile = pair_profile(symbol)
        for timeframe in SCAN_TIMEFRAMES:
            scanned += 1
            snapshot = market_snapshot(symbol, timeframe)
            profile_risk_value = profile.riskPercent if auto_config.riskMode == RiskMode.PERCENT_EQUITY else auto_config.riskValue
            signal = recommend(snapshot, auto_config.riskMode, profile_risk_value)
            enrich_signal(snapshot, signal, auto_config.riskMode, profile_risk_value)
            apply_pair_risk_model(signal, profile, snapshot.candles)
            if timeframe not in profile.executionTimeframes:
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
                    riskValue=profile_risk_value,
                ),
                equity=account_equity_usd(account),
                spread_points=snapshot.spread_points,
            )
            if not validation.valid or validation.lot is None:
                blocked.extend(f"{signal.symbol} {signal.timeframe}: {reason}" for reason in validation.blockedReasons)
                continue
            if validation.lot is not None:
                validation.lot = min(validation.lot, profile.maxLot)
            candidates.append((signal, validation))

    candidates.sort(key=lambda item: item[0].score, reverse=True)
    executed = 0
    current_positions = bridge.open_positions()
    current_pending = bridge.pending_orders()
    for signal, validation in candidates:
        if len(current_positions) >= auto_config.maxTotalOpenPositionsAllPairs:
            blocked.append("AUTO blocked: maximum total open positions across all pairs reached")
            break
        signature = build_auto_signature(signal)
        if is_auto_duplicate(signature):
            blocked.append(f"{signal.symbol} {signal.timeframe}: duplicate signal cooldown")
            continue
        lock = pair_exposure_locks[signal.symbol]
        acquired = lock.acquire(timeout=2)
        if not acquired:
            blocked.append(f"{signal.symbol} blocked: exposure check lock unavailable")
            continue
        try:
            account_snapshot = bridge.status()
            positions_snapshot = bridge.open_positions()
            pending_snapshot = bridge.pending_orders()
            candidate_item = RiskExposureItem(
                symbol=signal.symbol,
                source="candidate",
                entry=signal.entry or 0.0,
                stopLoss=signal.stopLoss,
                lot=validation.lot or 0.0,
            )
            candidate_exposure = build_risk_exposure(
                positions_snapshot,
                pending_snapshot,
                equity=account_equity_usd(account_snapshot),
                max_total_risk_percent=auto_config.maxTotalRiskPercent,
                candidate=candidate_item,
            )
            pair_exposure = build_pair_exposure(
                signal.symbol,
                pair_profile(signal.symbol),
                pair_state_store.get(signal.symbol),
                positions_snapshot,
                pending_snapshot,
                usd_from_broker_money(account_snapshot.balance),
                usd_from_broker_money(account_snapshot.equity),
                (signal.entry or 0.0, signal.stopLoss or 0.0, validation.lot or 0.0, signal.side),
                shadow_transition=auto_config.shadowMode,
            )
            snapshot = market_snapshot(signal.symbol, signal.timeframe)
            gate = evaluate_pair_gate(
                signal,
                pair_profile(signal.symbol),
                pair_exposure,
                snapshot.candles,
                snapshot.spread_points,
                bridge.has_real_market_data(signal.symbol, signal.timeframe),
                investing_current_status(signal.symbol),
                investing_current_technical(signal.symbol),
                load_calendar_events(),
            )
            gate_reasons = candidate_exposure.blockedReasons + pair_exposure.reasons + gate.reasons
            audit_base = {
                "symbol": signal.symbol,
                "pairProfile": pair_profile(signal.symbol).model_dump(mode="json"),
                "mode": "AUTO_SHADOW" if auto_config.shadowMode else "AUTO",
                "side": signal.side.value if signal.side else None,
                "timeframe": signal.timeframe,
                "signalCandleTime": snapshot.candles[-2].time if len(snapshot.candles) >= 2 else None,
                "signalGeneratedTime": auto_last_scan,
                "internalScore": signal.score,
                "internalReasons": signal.reasons,
                "mt5SourceReal": bridge.has_real_market_data(signal.symbol, signal.timeframe),
                "accountMode": auto_config.accountMode,
                "balanceUsd": usd_from_broker_money(account_snapshot.balance),
                "equityUsd": usd_from_broker_money(account_snapshot.equity),
                "investingStatus": investing_current_status(signal.symbol),
                "marketRegime": gate.regime,
                "riskResult": candidate_exposure.model_dump(mode="json"),
                "exposureResult": pair_exposure.model_dump(mode="json"),
                "gateDecision": gate.decision,
                "blockedReasons": list(dict.fromkeys(gate_reasons)),
            }
            if gate_reasons:
                append_audit(SIGNAL_AUDIT_PATH, {**audit_base, "finalAction": "BLOCKED"})
                blocked.extend(f"{signal.symbol} {signal.timeframe}: {reason}" for reason in gate_reasons)
                if pair_exposure.tradeMode == "CLOSE_ONLY" and not auto_config.shadowMode:
                    pair_state_store.update(
                        signal.symbol,
                        closeOnlyMode=True,
                        closeOnlyReason=gate_reasons[-1],
                        aggregateSlExposurePercent=pair_exposure.aggregateSlRiskPercent,
                    )
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
                riskValue=pair_profile(signal.symbol).riskPercent if auto_config.riskMode == RiskMode.PERCENT_EQUITY else auto_config.riskValue,
                lot=validation.lot,
                confirmed=True,
            )
            if auto_config.shadowMode:
                accepted, ticket, message = False, None, f"SHADOW PASS: {gate.decision}; order not sent"
            else:
                accepted, ticket, message = bridge.send_order(request, fallback_lot=validation.lot)
            append_audit(
                SIGNAL_AUDIT_PATH,
                {
                    **audit_base,
                    "finalAction": "SHADOW_PASS" if auto_config.shadowMode else ("ORDER_SENT" if accepted else "SEND_BLOCKED"),
                    "ticket": ticket,
                    "message": message,
                },
            )
        finally:
            lock.release()
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
        elif not message.startswith("SHADOW PASS"):
            blocked.append(f"{signal.symbol} {signal.timeframe}: {message}")
    if executed == 0 and not blocked:
        blocked.append("No eligible auto signal found")
    auto_blocked_reason = None if executed > 0 else (blocked[-1] if blocked else None)
    final_exposure = build_risk_exposure(
        bridge.open_positions(),
        bridge.pending_orders(),
        equity=account_equity_usd(account),
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


def is_port_listening(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex((host, port)) == 0


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


def schedule_frontend_start() -> None:
    root = str(PROJECT_ROOT)
    logs = PROJECT_ROOT / "logs"
    logs.mkdir(exist_ok=True)
    frontend_log = str(logs / "frontend-5174.log")
    frontend_err = str(logs / "frontend-5174.err.log")
    npm_exe = "npm.cmd" if os.name == "nt" else "npm"
    helper = (
        f"Start-Process -FilePath '{npm_exe}' "
        "-ArgumentList 'run','dev','--','--host','127.0.0.1','--port','5174','--strictPort' "
        f"-WorkingDirectory '{root}' "
        f"-RedirectStandardOutput '{frontend_log}' "
        f"-RedirectStandardError '{frontend_err}' "
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
