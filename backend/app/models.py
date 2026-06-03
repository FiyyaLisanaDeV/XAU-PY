from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


Symbol = Literal["XAUUSD", "GBPUSD", "EURUSD"]
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
    terminal_found: bool
    account_login: int | None = None
    server: str | None = None
    equity: float = 10000.0
    balance: float = 10000.0
    currency: str = "USD"
    message: str


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
