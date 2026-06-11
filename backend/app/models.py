from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, Field


Symbol = Literal["XAUUSD", "EURUSD"]
Timeframe = Literal["M15", "M30", "H1", "H4", "D1"]


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, Enum):
    BUY_MARKET = "BUY_MARKET"
    SELL_MARKET = "SELL_MARKET"
    BUY_LIMIT = "BUY_LIMIT"
    SELL_LIMIT = "SELL_LIMIT"
    BUY_STOP = "BUY_STOP"
    SELL_STOP = "SELL_STOP"


class RiskMode(str, Enum):
    FIXED_LOT = "fixed_lot"
    FIXED_USD = "fixed_usd"
    PERCENT_EQUITY = "percent_equity"


class Candle(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class Zone(BaseModel):
    kind: Literal["SNR", "SND", "FIB"]
    label: str
    low: float
    high: float
    strength: int = Field(ge=1, le=5)


class IndicatorSet(BaseModel):
    ema_fast: list[float]
    ema_slow: list[float]
    ma_fast: list[float]
    ma_slow: list[float]


class MarketSnapshot(BaseModel):
    symbol: Symbol
    timeframe: Timeframe
    bid: float
    ask: float
    spread_points: float
    bias: Literal["bullish", "bearish", "neutral"]
    candles: list[Candle]
    indicators: IndicatorSet
    zones: list[Zone]


class MarketTick(BaseModel):
    symbol: Symbol
    broker_symbol: str | None
    bid: float
    ask: float
    mid: float
    spread_points: float
    server_time: str
    source: Literal["mt5", "mock"]


class AccountStatus(BaseModel):
    connected: bool
    demo_mode: bool
    demo_guard_enabled: bool = True
    live_account: bool = False
    terminal_trade_allowed: bool = False
    account_trade_allowed: bool = False
    trade_ready: bool = False
    terminal_found: bool
    account_login: int | None = None
    server: str | None = None
    equity: float = 10000.0
    balance: float = 10000.0
    currency: str = "USD"
    message: str


class DemoGuardRequest(BaseModel):
    enabled: bool


class DemoGuardStatus(BaseModel):
    enabled: bool
    message: str


class BackendHealth(BaseModel):
    active: bool
    service: str
    startedAt: str
    serverTime: str
    pid: int
    message: str


class BackendRestartResponse(BaseModel):
    accepted: bool
    status: Literal["scheduled", "blocked"]
    message: str


class ServiceRestartAction(BaseModel):
    service: Literal["backend", "frontend"]
    accepted: bool
    status: Literal["scheduled", "running", "blocked"]
    port: int
    message: str


class AllServicesRestartResponse(BaseModel):
    accepted: bool
    status: Literal["scheduled", "partial", "blocked"]
    message: str
    actions: list[ServiceRestartAction]


class DataResetResponse(BaseModel):
    accepted: bool
    message: str
    cleared: list[str]


class OrderRecommendation(BaseModel):
    symbol: Symbol
    timeframe: Timeframe
    side: Side | None
    orderType: OrderType | None
    entry: float | None
    stopLoss: float | None
    takeProfit: float | None
    lot: float | None
    riskMode: RiskMode
    riskValue: float
    riskPercent: float | None
    score: int = Field(ge=0, le=100)
    setupType: str
    reasons: list[str]
    blockedReasons: list[str]


class RiskRequest(BaseModel):
    symbol: Symbol
    timeframe: Timeframe = "H1"
    side: Side
    orderType: OrderType
    entry: float
    stopLoss: float
    takeProfit: float
    riskMode: RiskMode = RiskMode.PERCENT_EQUITY
    riskValue: float = 0.5


class OrderValidation(BaseModel):
    valid: bool
    lot: float | None
    risk_usd: float | None
    risk_percent: float | None
    blockedReasons: list[str]


class ExecuteOrderRequest(RiskRequest):
    lot: float | None = None
    confirmed: bool = False


class ExecuteOrderResponse(BaseModel):
    accepted: bool
    ticket: int | None = None
    status: Literal["sent", "blocked", "simulated"]
    message: str
    validation: OrderValidation


class OpenPosition(BaseModel):
    ticket: int
    symbol: Symbol
    broker_symbol: str
    side: Side
    volume: float
    open_price: float
    current_price: float
    stopLoss: float | None = None
    takeProfit: float | None = None
    profit: float
    swap: float
    commission: float
    opened_at: str
    comment: str | None = None


class PositionSetupAlert(BaseModel):
    ticket: int
    symbol: Symbol
    side: Side
    status: Literal["valid", "warning", "invalid"]
    title: str
    message: str
    checkedTimeframes: list[Timeframe]
    supportingTimeframes: list[Timeframe]
    opposingTimeframes: list[Timeframe]
    reasons: list[str]


class PendingOrder(BaseModel):
    ticket: int
    symbol: Symbol
    broker_symbol: str
    side: Side
    orderType: OrderType
    volume: float
    entry: float
    stopLoss: float | None = None
    takeProfit: float | None = None
    created_at: str
    comment: str | None = None


class RiskExposureItem(BaseModel):
    ticket: int | None = None
    symbol: Symbol
    source: Literal["position", "pending_order", "candidate"]
    entry: float
    stopLoss: float | None = None
    lot: float
    riskUsd: float | None = None
    riskPercent: float | None = None
    blockedReason: str | None = None


class RiskExposure(BaseModel):
    equity: float
    maxTotalRiskPercent: float
    totalRiskUsd: float
    totalRiskPercent: float
    availableRiskPercent: float
    blocked: bool
    blockedReasons: list[str]
    items: list[RiskExposureItem]


class ClosePositionRequest(BaseModel):
    ticket: int | None = None
    symbol: Symbol | None = None
    all: bool = False
    confirmed: bool = False


class ClosePositionResult(BaseModel):
    accepted: bool
    ticket: int | None = None
    symbol: Symbol | None = None
    message: str


class ClosePositionResponse(BaseModel):
    accepted: bool
    ticket: int | None = None
    status: Literal["closed", "blocked"]
    message: str
    closedCount: int = 0
    failedCount: int = 0
    results: list[ClosePositionResult] = []


class TrailingStopRequest(BaseModel):
    ticket: int
    trigger_pips: float = Field(default=5.0, ge=0)
    distance_pips: float = Field(gt=0)
    step_pips: float = Field(default=1.0, ge=0)
    confirmed: bool = False


class TrailingStopResponse(BaseModel):
    accepted: bool
    ticket: int
    status: Literal["updated", "blocked"]
    message: str
    oldStopLoss: float | None = None
    newStopLoss: float | None = None
    profitPips: float | None = None


class AutoTrailingRule(BaseModel):
    symbol: Symbol
    triggerUsd: float
    distancePips: float
    stepPips: float
    pipSize: float


class AutoTrailingStateItem(BaseModel):
    ticket: int
    symbol: Symbol
    side: Side
    openPrice: float
    originalStopLoss: float
    currentStopLoss: float
    trailingActive: bool
    peakPrice: float
    lastAttempt: str | None = None


class AutoTrailingStatus(BaseModel):
    enabled: bool = True
    monitorIntervalSeconds: float
    trackedTickets: int
    activeTickets: int
    rules: list[AutoTrailingRule]
    states: list[AutoTrailingStateItem]
    message: str


class TradingJournalEntry(BaseModel):
    time: str
    ticket: int | None
    symbol: Symbol
    side: Side | None = None
    volume: float | None = None
    entry: float | None = None
    exit: float | None = None
    profit: float | None = None
    closeReason: Literal["tp", "sl", "force_close_user", "manual_external", "unknown"]
    source: Literal["app", "mt5"]
    note: str


class HistoryItem(BaseModel):
    time: str
    symbol: Symbol
    timeframe: Timeframe
    score: int
    action: str
    status: str


class EconomicEvent(BaseModel):
    id: str
    time: str
    currency: Literal["USD", "GBP", "EUR"]
    country: str
    title: str
    impact: Literal["low", "medium", "high"]
    actual: str | None = None
    forecast: str | None = None
    previous: str | None = None
    source: Literal["mql5", "manual"]
    affected_symbols: list[Symbol]


class EconomicCalendarResponse(BaseModel):
    source: Literal["mql5_export", "not_configured"]
    configured: bool
    message: str
    events: list[EconomicEvent]


class SignalLogEntry(BaseModel):
    id: str
    detected_at: str
    date: str
    day: str
    time: str
    symbol: Symbol
    timeframe: Timeframe
    score: int
    side: Side | None
    orderType: OrderType | None
    setupType: str
    entry: float | None
    stopLoss: float | None
    takeProfit: float | None
    lot: float | None
    riskPercent: float | None
    spread_points: float
    reasons: list[str]
    blockedReasons: list[str]
    status: Literal["potential", "blocked"]


class AutoModeRequest(BaseModel):
    enabled: bool
    activeSymbols: list[Symbol] = Field(default_factory=lambda: ["XAUUSD", "EURUSD"])
    hardTakeProfitUsd: dict[Symbol, Annotated[float, Field(gt=0)]] = Field(default_factory=lambda: {"XAUUSD": 10.0, "EURUSD": 10.0})
    maxTotalRiskPercent: float = Field(default=20.0, gt=0, le=100)
    minScore: int = Field(default=60, ge=0, le=100)
    riskMode: RiskMode = RiskMode.PERCENT_EQUITY
    riskValue: float = Field(default=0.5, gt=0)
    scanIntervalSeconds: int = Field(default=15, ge=5, le=300)
    duplicateCooldownMinutes: int = Field(default=10, ge=0, le=1440)


class AutoExecutionItem(BaseModel):
    symbol: Symbol
    timeframe: Timeframe
    score: int
    orderType: OrderType | None
    accepted: bool
    ticket: int | None = None
    message: str
    riskPercent: float | None = None


class AutoModeStatus(BaseModel):
    enabled: bool = False
    activeSymbols: list[Symbol] = Field(default_factory=lambda: ["XAUUSD", "EURUSD"])
    hardTakeProfitUsd: dict[Symbol, Annotated[float, Field(gt=0)]] = Field(default_factory=lambda: {"XAUUSD": 10.0, "EURUSD": 10.0})
    maxTotalRiskPercent: float = 20.0
    minScore: int = 60
    riskMode: RiskMode = RiskMode.PERCENT_EQUITY
    riskValue: float = 0.5
    scanIntervalSeconds: int = 15
    duplicateCooldownMinutes: int = 10
    lastScan: str | None = None
    lastAction: str | None = None
    blockedReason: str | None = None
    exposure: RiskExposure


class AutoScanResponse(BaseModel):
    status: AutoModeStatus
    scanned: int
    eligible: int
    executed: int
    blocked: list[str]
    actions: list[AutoExecutionItem]
