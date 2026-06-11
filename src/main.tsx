import React from "react";
import ReactDOM from "react-dom/client";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type CreatePriceLineOptions,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp
} from "lightweight-charts";
import { Activity, AlertTriangle, BookOpen, CheckCircle2, ChevronDown, Layers, Maximize2, Minimize2, PlugZap, ShieldCheck, TrendingUp, XCircle } from "lucide-react";
import "./styles.css";

type SymbolName = "XAUUSD" | "EURUSD";
type Timeframe = "M15" | "M30" | "H1" | "H4" | "D1";
type RiskMode = "fixed_lot" | "fixed_usd" | "percent_equity";
type AccountMode = "USD" | "USC";
type IndicatorKey = "ema" | "ma" | "supportResistance" | "supplyDemand" | "fib" | "live";

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Snapshot {
  symbol: SymbolName;
  timeframe: Timeframe;
  bid: number;
  ask: number;
  spread_points: number;
  bias: "bullish" | "bearish" | "neutral";
  candles: Candle[];
  indicators: {
    ema_fast: number[];
    ema_slow: number[];
    ma_fast: number[];
    ma_slow: number[];
  };
  zones: Array<{ kind: string; label: string; low: number; high: number; strength: number }>;
}

interface MarketTick {
  symbol: SymbolName;
  broker_symbol: string | null;
  bid: number;
  ask: number;
  mid: number;
  spread_points: number;
  server_time: string;
  source: "mt5" | "mock";
}

interface Status {
  connected: boolean;
  demo_mode: boolean;
  demo_guard_enabled: boolean;
  live_account: boolean;
  terminal_trade_allowed: boolean;
  account_trade_allowed: boolean;
  trade_ready: boolean;
  terminal_found: boolean;
  account_login: number | null;
  server: string | null;
  equity: number;
  balance: number;
  currency: string;
  message: string;
}

interface DemoGuardStatus {
  enabled: boolean;
  message: string;
}

interface BackendHealth {
  active: boolean;
  service: string;
  startedAt: string;
  serverTime: string;
  pid: number;
  message: string;
}

interface BackendRestartResponse {
  accepted: boolean;
  status: "scheduled" | "blocked";
  message: string;
}

interface ServiceRestartAction {
  service: "backend" | "frontend";
  accepted: boolean;
  status: "scheduled" | "running" | "blocked";
  port: number;
  message: string;
}

interface AllServicesRestartResponse {
  accepted: boolean;
  status: "scheduled" | "partial" | "blocked";
  message: string;
  actions: ServiceRestartAction[];
}

interface DataResetResponse {
  accepted: boolean;
  message: string;
  cleared: string[];
}

interface InvestingDataSync {
  source: string;
  symbol: SymbolName;
  sync_status: "SUCCESS" | "FAILED" | "CACHE_USED" | "BLOCKED";
  data_mode: "FRESH" | "CACHE" | "NONE";
  last_sync_utc: string | null;
  retry_attempt: number;
  retry_max: number;
  cache_available: boolean;
  cache_age_seconds: number | null;
  parser_status: "OK" | "FAILED";
  strategy_use: "ALLOWED" | "BLOCKED";
  using_cache: boolean;
  message: string;
  error: string | null;
}

interface InvestingStatusResponse {
  investing_data_sync: InvestingDataSync;
}

interface InvestingStatusCollection {
  items: Partial<Record<SymbolName, InvestingStatusResponse>>;
}

interface InvestingAction {
  label: string;
  code: string;
}

interface InvestingTimeframeSignal {
  label: string;
  mapped_label: string;
  signal: InvestingAction;
  active: boolean;
  locked: boolean;
  raw?: string[];
}

interface InvestingTechnicalItem {
  value: number | null;
  action?: InvestingAction;
  raw?: string[];
  source?: string;
}

interface InvestingTechnicalData {
  source?: string;
  symbol?: SymbolName;
  url?: string;
  pivot_url?: string;
  selected_timeframe?: string;
  selected_timeframe_label?: string;
  timeframe_signals?: Record<string, InvestingTimeframeSignal>;
  app_timeframe_map?: Partial<Record<Timeframe, string>>;
  sources?: {
    technical?: string;
    pivot_fibonacci?: string;
  };
  scraped_at_utc?: string;
  pivot_parser_status?: "OK" | "EMPTY" | "FAILED" | "TECHNICAL_FALLBACK";
  pivot_error?: string | null;
  summary?: {
    overall?: string;
    moving_average?: { signal?: string; buy?: number; neutral?: number; sell?: number };
    technical_indicators?: { signal?: string; buy?: number; neutral?: number; sell?: number };
  };
  indicators?: Record<string, InvestingTechnicalItem>;
  moving_averages?: Record<string, InvestingTechnicalItem>;
  pivot_points?: Record<string, InvestingTechnicalItem>;
}

interface InvestingTechnicalCollection {
  items: Partial<Record<SymbolName, InvestingTechnicalData>>;
}

interface RiskExposure {
  equity: number;
  maxTotalRiskPercent: number;
  totalRiskUsd: number;
  totalRiskPercent: number;
  availableRiskPercent: number;
  blocked: boolean;
  blockedReasons: string[];
  items?: unknown[];
}

interface MinimumBalanceEstimate {
  minimumUsd: number;
  recommendedUsd: number;
  minimumAccountUnits: number;
  recommendedAccountUnits: number;
  currentEquityUsd: number;
  sufficient: boolean;
  reservePercent: number;
  minLot: number;
  maxRiskPerPositionPercent: number;
  pairs: Array<{
    symbol: SymbolName;
    riskAtMinLotUsd: number;
    requiredEquityUsd: number;
    sourceTimeframe: Timeframe | null;
  }>;
  message: string;
}

interface PairProfile {
  enabled: boolean;
  executionTimeframes: Timeframe[];
  monitorTimeframes: Timeframe[];
  maxSpread: number;
  maxLot: number;
  riskPercent: number;
  minRiskReward: number;
  investingMode: "advisory" | "required" | "disabled";
  pivotRequired: boolean;
  marketFactGate: "advisory" | "strict" | "disabled";
  marketRegimeMode: "advisory" | "strict" | "disabled";
  allowedMarketRegimes: MarketRegime[];
  trendingMinScore: number;
  sidewaysMinScore: number;
  volatileMinScore: number;
  mt5RealDataRequired: boolean;
  recoveryEnabled: boolean;
  cooldownAfterSlMinutes: number;
  lockAfterConsecutiveSl: number;
  dailyLossLimitPercent: number;
  newsFilterEnabled: boolean;
  loggingLevel: "normal" | "verbose";
  maxOpenPositions: number;
  maxPendingOrders: number;
  maxSameDirectionPositions: number;
  maxOppositeDirectionPositions: number;
  maxTotalLot: number;
  maxFloatingLossUsd: number;
  maxDailyTrades: number;
  maxHourlyTrades: number;
  aggregateSlRiskCapPercent: number;
  closeOnly: boolean;
  trailingBreakEvenTriggerPips: number;
  trailingBreakEvenLockPips: number;
  trailingTriggerPips: number;
  trailingDistancePips: number;
  trailingStepPips: number;
  minStopPips: number;
  maxStopPips: number;
}

type MarketRegime =
  | "TRENDING"
  | "SIDEWAYS"
  | "CHOPPY"
  | "HARD_CHOPPY"
  | "LOW_VOLATILITY"
  | "HIGH_VOLATILITY"
  | "NEWS_SHOCK"
  | "UNCERTAIN";

interface MarketRegimeAssessment {
  symbol: SymbolName;
  timeframe: Timeframe;
  regime: MarketRegime;
  confidence: number;
  approach: string;
  choppyScore: number;
  efficiencyRatio: number;
  emaGapAtr: number;
  atrPercent: number;
}

interface MarketRegimeCollection {
  generatedAt: string;
  items: MarketRegimeAssessment[];
}

interface PairExposureStatus {
  symbol: SymbolName;
  openPositions: number;
  maxOpenPositions: number;
  pendingOrders: number;
  maxPendingOrders: number;
  buyPositions: number;
  sellPositions: number;
  totalLot: number;
  maxTotalLot: number;
  floatingPnlAccount: number;
  aggregateSlRiskUsd: number;
  aggregateSlRiskPercent: number;
  aggregateSlRiskCapPercent: number;
  status: "SAFE" | "WARNING" | "BLOCKED" | "CLOSE_ONLY" | "LOCKED";
  tradeMode: "NORMAL" | "CLOSE_ONLY" | "LOCKED";
  reasons: string[];
}

interface AutoModeStatus {
  configVersion: number;
  strategyProfile: StrategyProfile;
  shadowMode: boolean;
  enabled: boolean;
  accountMode: AccountMode;
  pairProfiles: Record<SymbolName, PairProfile>;
  activeSymbols: SymbolName[];
  hardTakeProfitUsd: Record<SymbolName, number>;
  recoveryEnabled: boolean;
  reversalHedgeScore: number;
  recoveryResumeScore: number;
  hedgeRatio: number;
  hedgeProfitUsd: Record<SymbolName, number>;
  recoveryMultiplier: number;
  maxRecoveryLayers: number;
  basketTargetUsd: Record<SymbolName, number>;
  basketMaxLossUsd: Record<SymbolName, number>;
  recoveryCooldownSeconds: number;
  shockAtrMultiplier: number;
  maxTotalRiskPercent: number;
  maxTotalOpenPositionsAllPairs: number;
  minScore: number;
  riskMode: RiskMode;
  riskValue: number;
  scanIntervalSeconds: number;
  duplicateCooldownMinutes: number;
  lastScan: string | null;
  lastAction: string | null;
  blockedReason: string | null;
  exposure: RiskExposure;
  minimumBalance: MinimumBalanceEstimate;
  pairExposure: PairExposureStatus[];
}

interface RecoveryCycleStatus {
  symbol: SymbolName;
  phase: "NORMAL" | "HEDGE_ACTIVE" | "WAIT_RECOVERY" | "RECOVERY_ACTIVE" | "BASKET_EXIT" | "EMERGENCY_EXIT";
  mainSide: "BUY" | "SELL" | null;
  reversalScore: number;
  recoveryLayers: number;
  realizedHedgeProfit: number;
  openBasketProfit: number;
  basketProfit: number;
  mainTickets: number[];
  hedgeTickets: number[];
  recoveryTickets: number[];
  lastAction: string | null;
  updatedAt: string | null;
}

interface RecoveryEngineStatus {
  enabled: boolean;
  monitorIntervalSeconds: number;
  cycles: RecoveryCycleStatus[];
  message: string;
}

interface AutoTrailingRule {
  symbol: SymbolName;
  triggerUsd: number;
  distancePips: number;
  stepPips: number;
  pipSize: number;
}

interface AutoTrailingStateItem {
  ticket: number;
  symbol: SymbolName;
  side: "BUY" | "SELL";
  openPrice: number;
  originalStopLoss: number;
  currentStopLoss: number;
  trailingActive: boolean;
  peakPrice: number;
  lastAttempt: string | null;
}

interface AutoTrailingStatus {
  enabled: boolean;
  monitorIntervalSeconds: number;
  trackedTickets: number;
  activeTickets: number;
  rules: AutoTrailingRule[];
  states: AutoTrailingStateItem[];
  message: string;
}

interface AutoScanResponse {
  status: AutoModeStatus;
  scanned: number;
  eligible: number;
  executed: number;
  blocked: string[];
  actions: Array<{ symbol: SymbolName; timeframe: Timeframe; score: number; accepted: boolean; ticket: number | null; message: string }>;
}

interface Signal {
  symbol: SymbolName;
  timeframe: Timeframe;
  side: "BUY" | "SELL" | null;
  orderType: string | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lot: number | null;
  riskMode: RiskMode;
  riskValue: string;
  riskPercent: number | null;
  score: number;
  setupType: string;
  reasons: string[];
  blockedReasons: string[];
}

interface ConfluenceScoreCard {
  symbol: SymbolName;
  timeframe: Timeframe;
  score: number;
  side: "BUY" | "SELL" | null;
  orderType: string | null;
  setupType: string;
  blockedReasons: string[];
}

interface StrategyRiskSettings {
  configVersion: number;
  strategyProfile: StrategyProfile;
  shadowMode: boolean;
  enabled: boolean;
  accountMode: AccountMode;
  pairProfiles: Record<SymbolName, PairProfile>;
  activeSymbols: SymbolName[];
  xauusdHardTpUsd: string;
  eurusdHardTpUsd: string;
  recoveryEnabled: boolean;
  reversalHedgeScore: string;
  recoveryResumeScore: string;
  hedgeRatioPercent: string;
  xauusdHedgeProfitUsd: string;
  eurusdHedgeProfitUsd: string;
  recoveryMultiplier: string;
  maxRecoveryLayers: string;
  xauusdBasketTargetUsd: string;
  eurusdBasketTargetUsd: string;
  xauusdBasketMaxLossUsd: string;
  eurusdBasketMaxLossUsd: string;
  recoveryCooldownSeconds: string;
  shockAtrMultiplier: string;
  maxTotalRiskPercent: string;
  maxTotalOpenPositionsAllPairs: string;
  minScore: string;
  riskMode: RiskMode;
  riskValue: string;
  scanIntervalSeconds: string;
  duplicateCooldownMinutes: string;
}

type StrategyProfile = "CONSERVATIVE" | "OPPORTUNISTIC" | "HIGH_RISK" | "CUSTOM";

interface HistoryItem {
  time: string;
  symbol: SymbolName;
  timeframe: Timeframe;
  score: number;
  action: string;
  status: string;
}

interface OpenPosition {
  ticket: number;
  symbol: SymbolName;
  broker_symbol: string;
  side: "BUY" | "SELL";
  volume: number;
  open_price: number;
  current_price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number;
  swap: number;
  commission: number;
  opened_at: string;
  comment: string | null;
}

interface PositionSetupAlert {
  ticket: number;
  symbol: SymbolName;
  side: "BUY" | "SELL";
  status: "valid" | "warning" | "invalid";
  title: string;
  message: string;
  checkedTimeframes: Timeframe[];
  supportingTimeframes: Timeframe[];
  opposingTimeframes: Timeframe[];
  reasons: string[];
}

interface ClosePositionResponse {
  accepted: boolean;
  ticket: number | null;
  status: "closed" | "blocked";
  message: string;
  closedCount: number;
  failedCount: number;
  results: Array<{ accepted: boolean; ticket: number | null; symbol: SymbolName | null; message: string }>;
}

interface TrailingStopResponse {
  accepted: boolean;
  ticket: number;
  status: "updated" | "blocked";
  message: string;
  oldStopLoss: number | null;
  newStopLoss: number | null;
  profitPips: number | null;
}

interface TrailingRules {
  triggerPips: string;
  distancePips: string;
  stepPips: string;
}

interface TradingJournalEntry {
  time: string;
  ticket: number | null;
  symbol: SymbolName;
  side: "BUY" | "SELL" | null;
  volume: number | null;
  entry: number | null;
  exit: number | null;
  profit: number | null;
  closeReason: "tp" | "sl" | "force_close_user" | "manual_external" | "unknown";
  source: "app" | "mt5";
  note: string;
}

interface EconomicEvent {
  id: string;
  time: string;
  currency: "USD" | "GBP" | "EUR";
  country: string;
  title: string;
  impact: "low" | "medium" | "high";
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source: "mql5" | "manual";
  affected_symbols: SymbolName[];
}

interface EconomicCalendarResponse {
  source: "mql5_export" | "not_configured";
  configured: boolean;
  message: string;
  events: EconomicEvent[];
}

interface SignalLogEntry {
  id: string;
  detected_at: string;
  date: string;
  day: string;
  time: string;
  symbol: SymbolName;
  timeframe: Timeframe;
  score: number;
  side: "BUY" | "SELL" | null;
  orderType: string | null;
  setupType: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lot: number | null;
  riskPercent: number | null;
  spread_points: number;
  reasons: string[];
  blockedReasons: string[];
  status: "potential" | "blocked";
}

interface PairStateItem {
  symbol: SymbolName;
  lossStreak: number;
  lastSlAt: string | null;
  lockedUntil: string | null;
  lockReason: string | null;
  dailyLossUsd: number;
  dailyLossPercent: number;
  dailyTradeCount: number;
  hourlyTradeCount: number;
  closeOnlyMode: boolean;
  closeOnlyReason: string | null;
  aggregateSlExposurePercent: number;
  updatedAt: string | null;
}

interface PairStateResponse {
  healthy: boolean;
  error: string | null;
  states: Record<SymbolName, PairStateItem>;
}

interface SignalAuditEntry {
  recordedAt?: string;
  symbol?: SymbolName;
  mode?: string;
  side?: "BUY" | "SELL" | null;
  timeframe?: Timeframe;
  internalScore?: number;
  marketRegime?: string;
  gateDecision?: string;
  finalAction?: string;
  blockedReasons?: string[];
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const symbols: SymbolName[] = ["XAUUSD", "EURUSD"];
const timeframes: Timeframe[] = ["M15", "M30", "H1", "H4", "D1"];
const configurableMarketRegimes: MarketRegime[] = [
  "TRENDING",
  "SIDEWAYS",
  "HIGH_VOLATILITY",
  "LOW_VOLATILITY",
  "CHOPPY",
  "HARD_CHOPPY",
  "NEWS_SHOCK",
  "UNCERTAIN"
];
const spreadLimits: Record<SymbolName, number> = {
  XAUUSD: 350,
  EURUSD: 18
};

const defaultIndicators: Record<IndicatorKey, boolean> = {
  ema: true,
  ma: true,
  supportResistance: true,
  supplyDemand: true,
  fib: true,
  live: true
};
const SCORE_BLOCK_REASON = "Confluence score below 60";
const INVESTING_AUTO_SYNC_SECONDS = 60;
const defaultStrategyRiskSettings: StrategyRiskSettings = {
  configVersion: 2,
  strategyProfile: "OPPORTUNISTIC",
  shadowMode: true,
  enabled: true,
  accountMode: "USD",
  pairProfiles: {
    XAUUSD: {
      enabled: true, executionTimeframes: ["M15", "M30", "H1"], monitorTimeframes: ["H4", "D1"],
      maxSpread: 350, maxLot: 0.1, riskPercent: 0.5, minRiskReward: 1.2,
      investingMode: "advisory", pivotRequired: false, marketFactGate: "advisory",
      marketRegimeMode: "advisory", allowedMarketRegimes: ["TRENDING", "SIDEWAYS", "HIGH_VOLATILITY"],
      trendingMinScore: 60, sidewaysMinScore: 70, volatileMinScore: 80,
      mt5RealDataRequired: true, recoveryEnabled: true, cooldownAfterSlMinutes: 0,
      lockAfterConsecutiveSl: 0, dailyLossLimitPercent: 0, newsFilterEnabled: false,
      loggingLevel: "normal", maxOpenPositions: 5, maxPendingOrders: 2,
      maxSameDirectionPositions: 3, maxOppositeDirectionPositions: 2, maxTotalLot: 0.5,
      maxFloatingLossUsd: 0, maxDailyTrades: 20, maxHourlyTrades: 8,
      aggregateSlRiskCapPercent: 15, closeOnly: false, trailingBreakEvenTriggerPips: 5,
      trailingBreakEvenLockPips: 1, trailingTriggerPips: 8, trailingDistancePips: 4,
      trailingStepPips: 2, minStopPips: 0, maxStopPips: 0
    },
    EURUSD: {
      enabled: true, executionTimeframes: ["M15", "M30", "H1"], monitorTimeframes: ["H4", "D1"],
      maxSpread: 18, maxLot: 0.05, riskPercent: 0.25, minRiskReward: 1.5,
      investingMode: "required", pivotRequired: true, marketFactGate: "strict",
      marketRegimeMode: "strict", allowedMarketRegimes: ["TRENDING", "SIDEWAYS"],
      trendingMinScore: 65, sidewaysMinScore: 75, volatileMinScore: 85,
      mt5RealDataRequired: true, recoveryEnabled: false, cooldownAfterSlMinutes: 30,
      lockAfterConsecutiveSl: 2, dailyLossLimitPercent: 1, newsFilterEnabled: true,
      loggingLevel: "verbose", maxOpenPositions: 1, maxPendingOrders: 0,
      maxSameDirectionPositions: 1, maxOppositeDirectionPositions: 0, maxTotalLot: 0.05,
      maxFloatingLossUsd: 0, maxDailyTrades: 5, maxHourlyTrades: 2,
      aggregateSlRiskCapPercent: 5, closeOnly: false, trailingBreakEvenTriggerPips: 5,
      trailingBreakEvenLockPips: 1, trailingTriggerPips: 8, trailingDistancePips: 4,
      trailingStepPips: 2, minStopPips: 10, maxStopPips: 30
    }
  },
  activeSymbols: ["XAUUSD", "EURUSD"],
  xauusdHardTpUsd: "10",
  eurusdHardTpUsd: "10",
  recoveryEnabled: false,
  reversalHedgeScore: "75",
  recoveryResumeScore: "45",
  hedgeRatioPercent: "50",
  xauusdHedgeProfitUsd: "10",
  eurusdHedgeProfitUsd: "10",
  recoveryMultiplier: "1.35",
  maxRecoveryLayers: "2",
  xauusdBasketTargetUsd: "15",
  eurusdBasketTargetUsd: "10",
  xauusdBasketMaxLossUsd: "100",
  eurusdBasketMaxLossUsd: "50",
  recoveryCooldownSeconds: "60",
  shockAtrMultiplier: "1.5",
  maxTotalRiskPercent: "20",
  maxTotalOpenPositionsAllPairs: "15",
  minScore: "60",
  riskMode: "percent_equity",
  riskValue: "0.5",
  scanIntervalSeconds: "15",
  duplicateCooldownMinutes: "10"
};

const strategyProfileDescriptions: Record<Exclude<StrategyProfile, "CUSTOM">, {
  title: string;
  classification: string;
  summary: string;
  bestFor: string;
}> = {
  CONSERVATIVE: {
    title: "Conservative",
    classification: "Risiko rendah",
    summary: "Entry lebih selektif, posisi sedikit, dan exposure dibatasi ketat.",
    bestFor: "Stabilitas akun, fase evaluasi, dan kondisi pasar yang belum jelas."
  },
  OPPORTUNISTIC: {
    title: "Opportunistic",
    classification: "Risiko seimbang",
    summary: "Mencari peluang berkualitas tanpa memakai seluruh kapasitas risiko.",
    bestFor: "Operasional harian dengan keseimbangan frekuensi dan proteksi."
  },
  HIGH_RISK: {
    title: "High Risk",
    classification: "Risiko tinggi",
    summary: "Exposure dan frekuensi lebih besar, tetapi tetap tunduk pada hard guard.",
    bestFor: "Akun yang siap menerima drawdown lebih besar dan dipantau aktif."
  }
};

function applyStrategyProfile(settings: StrategyRiskSettings, profile: Exclude<StrategyProfile, "CUSTOM">): StrategyRiskSettings {
  const pairProfiles = {
    XAUUSD: { ...settings.pairProfiles.XAUUSD },
    EURUSD: { ...settings.pairProfiles.EURUSD }
  };
  if (profile === "CONSERVATIVE") {
    Object.assign(pairProfiles.XAUUSD, {
      riskPercent: 0.2, maxLot: 0.05, maxOpenPositions: 2, maxTotalLot: 0.1,
      maxDailyTrades: 6, maxHourlyTrades: 2, aggregateSlRiskCapPercent: 6,
      marketRegimeMode: "strict", allowedMarketRegimes: ["TRENDING", "SIDEWAYS"],
      trendingMinScore: 75, sidewaysMinScore: 82, volatileMinScore: 90
    });
    Object.assign(pairProfiles.EURUSD, {
      riskPercent: 0.15, maxLot: 0.03, maxOpenPositions: 1, maxTotalLot: 0.03,
      maxDailyTrades: 3, maxHourlyTrades: 1, aggregateSlRiskCapPercent: 3,
      marketRegimeMode: "strict", allowedMarketRegimes: ["TRENDING"],
      trendingMinScore: 78, sidewaysMinScore: 85, volatileMinScore: 92
    });
    return {
      ...settings, strategyProfile: profile, pairProfiles, recoveryEnabled: false,
      minScore: "75", riskMode: "percent_equity", riskValue: "0.2",
      maxTotalRiskPercent: "6", maxTotalOpenPositionsAllPairs: "4",
      scanIntervalSeconds: "30", duplicateCooldownMinutes: "30"
    };
  }
  if (profile === "HIGH_RISK") {
    Object.assign(pairProfiles.XAUUSD, {
      riskPercent: 0.5, maxLot: 0.1, maxOpenPositions: 5, maxTotalLot: 0.5,
      maxDailyTrades: 20, maxHourlyTrades: 10, aggregateSlRiskCapPercent: 15,
      marketRegimeMode: "strict", allowedMarketRegimes: ["TRENDING", "SIDEWAYS", "HIGH_VOLATILITY"],
      trendingMinScore: 60, sidewaysMinScore: 68, volatileMinScore: 75
    });
    Object.assign(pairProfiles.EURUSD, {
      riskPercent: 0.5, maxLot: 0.1, maxOpenPositions: 2, maxTotalLot: 0.2,
      maxDailyTrades: 10, maxHourlyTrades: 4, aggregateSlRiskCapPercent: 10,
      marketRegimeMode: "strict", allowedMarketRegimes: ["TRENDING", "SIDEWAYS", "HIGH_VOLATILITY"],
      trendingMinScore: 62, sidewaysMinScore: 70, volatileMinScore: 78
    });
    return {
      ...settings, strategyProfile: profile, pairProfiles, recoveryEnabled: true,
      minScore: "60", riskMode: "percent_equity", riskValue: "0.5",
      maxTotalRiskPercent: "20", maxTotalOpenPositionsAllPairs: "15",
      scanIntervalSeconds: "10", duplicateCooldownMinutes: "5"
    };
  }
  Object.assign(pairProfiles.XAUUSD, {
    riskPercent: 0.35, maxLot: 0.1, maxOpenPositions: 3, maxTotalLot: 0.3,
    maxDailyTrades: 12, maxHourlyTrades: 4, aggregateSlRiskCapPercent: 10,
    marketRegimeMode: "advisory", allowedMarketRegimes: ["TRENDING", "SIDEWAYS", "HIGH_VOLATILITY"],
    trendingMinScore: 65, sidewaysMinScore: 72, volatileMinScore: 82
  });
  Object.assign(pairProfiles.EURUSD, {
    riskPercent: 0.25, maxLot: 0.05, maxOpenPositions: 1, maxTotalLot: 0.05,
    maxDailyTrades: 5, maxHourlyTrades: 2, aggregateSlRiskCapPercent: 5,
    marketRegimeMode: "strict", allowedMarketRegimes: ["TRENDING", "SIDEWAYS"],
    trendingMinScore: 68, sidewaysMinScore: 76, volatileMinScore: 86
  });
  return {
    ...settings, strategyProfile: profile, pairProfiles, recoveryEnabled: false,
    minScore: "65", riskMode: "percent_equity", riskValue: "0.35",
    maxTotalRiskPercent: "12", maxTotalOpenPositionsAllPairs: "8",
    scanIntervalSeconds: "15", duplicateCooldownMinutes: "15"
  };
}

function strategySettingsFromAutoMode(autoMode: AutoModeStatus): StrategyRiskSettings {
  return {
    configVersion: autoMode.configVersion ?? 2,
    strategyProfile: autoMode.strategyProfile ?? "CUSTOM",
    shadowMode: autoMode.shadowMode ?? true,
    enabled: autoMode.enabled,
    accountMode: autoMode.accountMode ?? "USD",
    pairProfiles: {
      XAUUSD: { ...defaultStrategyRiskSettings.pairProfiles.XAUUSD, ...(autoMode.pairProfiles?.XAUUSD ?? {}) },
      EURUSD: { ...defaultStrategyRiskSettings.pairProfiles.EURUSD, ...(autoMode.pairProfiles?.EURUSD ?? {}) }
    },
    activeSymbols: autoMode.activeSymbols ?? ["XAUUSD", "EURUSD"],
    xauusdHardTpUsd: String(autoMode.hardTakeProfitUsd?.XAUUSD ?? 10),
    eurusdHardTpUsd: String(autoMode.hardTakeProfitUsd?.EURUSD ?? 10),
    recoveryEnabled: autoMode.recoveryEnabled ?? false,
    reversalHedgeScore: String(autoMode.reversalHedgeScore ?? 75),
    recoveryResumeScore: String(autoMode.recoveryResumeScore ?? 45),
    hedgeRatioPercent: String((autoMode.hedgeRatio ?? 0.5) * 100),
    xauusdHedgeProfitUsd: String(autoMode.hedgeProfitUsd?.XAUUSD ?? 10),
    eurusdHedgeProfitUsd: String(autoMode.hedgeProfitUsd?.EURUSD ?? 10),
    recoveryMultiplier: String(autoMode.recoveryMultiplier ?? 1.35),
    maxRecoveryLayers: String(autoMode.maxRecoveryLayers ?? 2),
    xauusdBasketTargetUsd: String(autoMode.basketTargetUsd?.XAUUSD ?? 15),
    eurusdBasketTargetUsd: String(autoMode.basketTargetUsd?.EURUSD ?? 10),
    xauusdBasketMaxLossUsd: String(autoMode.basketMaxLossUsd?.XAUUSD ?? 100),
    eurusdBasketMaxLossUsd: String(autoMode.basketMaxLossUsd?.EURUSD ?? 50),
    recoveryCooldownSeconds: String(autoMode.recoveryCooldownSeconds ?? 60),
    shockAtrMultiplier: String(autoMode.shockAtrMultiplier ?? 1.5),
    maxTotalRiskPercent: String(autoMode.maxTotalRiskPercent),
    maxTotalOpenPositionsAllPairs: String(autoMode.maxTotalOpenPositionsAllPairs ?? 15),
    minScore: String(autoMode.minScore),
    riskMode: autoMode.riskMode,
    riskValue: String(autoMode.riskValue),
    scanIntervalSeconds: String(autoMode.scanIntervalSeconds),
    duplicateCooldownMinutes: String(autoMode.duplicateCooldownMinutes)
  };
}

function App() {
  const [activePage, setActivePage] = React.useState<"summary" | "system" | "settings" | "guide" | "investing">("summary");
  const [status, setStatus] = React.useState<Status | null>(null);
  const [backendHealth, setBackendHealth] = React.useState<BackendHealth | null>(null);
  const [positions, setPositions] = React.useState<OpenPosition[]>([]);
  const [journal, setJournal] = React.useState<TradingJournalEntry[]>([]);
  const [autoMode, setAutoMode] = React.useState<AutoModeStatus | null>(null);
  const [autoTrailing, setAutoTrailing] = React.useState<AutoTrailingStatus | null>(null);
  const [recoveryStatus, setRecoveryStatus] = React.useState<RecoveryEngineStatus | null>(null);
  const [ticks, setTicks] = React.useState<Partial<Record<SymbolName, MarketTick>>>({});
  const [confluenceScores, setConfluenceScores] = React.useState<ConfluenceScoreCard[]>([]);
  const [marketRegimes, setMarketRegimes] = React.useState<MarketRegimeAssessment[]>([]);
  const [strategySettings, setStrategySettings] = React.useState<StrategyRiskSettings>(defaultStrategyRiskSettings);
  const [investingStatus, setInvestingStatus] = React.useState<InvestingDataSync | null>(null);
  const [investingStatuses, setInvestingStatuses] = React.useState<Partial<Record<SymbolName, InvestingDataSync>>>({});
  const [investingTechnical, setInvestingTechnical] = React.useState<InvestingTechnicalData | null>(null);
  const [investingTechnicals, setInvestingTechnicals] = React.useState<Partial<Record<SymbolName, InvestingTechnicalData>>>({});
  const [signalLog, setSignalLog] = React.useState<SignalLogEntry[]>([]);
  const [signalAudit, setSignalAudit] = React.useState<SignalAuditEntry[]>([]);
  const [pairState, setPairState] = React.useState<PairStateResponse | null>(null);
  const [calendar, setCalendar] = React.useState<EconomicCalendarResponse | null>(null);
  const [settingsDirty, setSettingsDirty] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const refreshConfluenceScores = React.useCallback(async () => {
    const riskValue = positiveNumber(strategySettings.riskValue, Number(defaultStrategyRiskSettings.riskValue));
    const scoreRequests = symbols.flatMap((item) =>
      timeframes.map(async (itemTimeframe) => {
        const signal = await fetchJson<Signal>(
          `${API_BASE}/api/signals?symbol=${item}&timeframe=${itemTimeframe}&riskMode=${strategySettings.riskMode}&riskValue=${riskValue}`,
          { cache: "no-store" }
        );
        return {
          symbol: item,
          timeframe: itemTimeframe,
          score: signal.score,
          side: signal.side,
          orderType: signal.orderType,
          setupType: signal.setupType,
          blockedReasons: signal.blockedReasons
        };
      })
    );
    setConfluenceScores(await Promise.all(scoreRequests));
  }, [strategySettings.riskMode, strategySettings.riskValue]);

  const refresh = React.useCallback(async () => {
    const [nextStatus, nextPositions, nextJournal, nextAutoMode, nextAutoTrailing, nextRecoveryStatus, nextTicks, nextBackendHealth, nextInvestingStatus, nextInvestingTechnical, nextSignalLog, nextSignalAudit, nextPairState, nextCalendar, nextMarketRegimes] = await Promise.all([
      fetchJson<Status>(`${API_BASE}/api/status`, { cache: "no-store" }),
      fetchJson<OpenPosition[]>(`${API_BASE}/api/positions`, { cache: "no-store" }),
      fetchJson<TradingJournalEntry[]>(`${API_BASE}/api/journal`, { cache: "no-store" }),
      fetchJson<AutoModeStatus>(`${API_BASE}/api/auto-mode/status`, { cache: "no-store" }),
      fetchJson<AutoTrailingStatus>(`${API_BASE}/api/auto-trailing/status`, { cache: "no-store" }),
      fetchJson<RecoveryEngineStatus>(`${API_BASE}/api/recovery/status`, { cache: "no-store" }),
      fetchJson<Partial<Record<SymbolName, MarketTick>>>(`${API_BASE}/api/market/ticks`, { cache: "no-store" }),
      fetchJson<BackendHealth>(`${API_BASE}/api/backend/health`, { cache: "no-store" }),
      fetchJson<InvestingStatusCollection>(`${API_BASE}/api/investing/status`, { cache: "no-store" }),
      fetchJson<InvestingTechnicalCollection>(`${API_BASE}/api/investing/technical`, { cache: "no-store" }),
      fetchJson<SignalLogEntry[]>(`${API_BASE}/api/signal-log?limit=100`, { cache: "no-store" }),
      fetchJson<SignalAuditEntry[]>(`${API_BASE}/api/signal-audit?limit=100`, { cache: "no-store" }),
      fetchJson<PairStateResponse>(`${API_BASE}/api/pair-state`, { cache: "no-store" }),
      fetchJson<EconomicCalendarResponse>(`${API_BASE}/api/economic-calendar`, { cache: "no-store" }),
      fetchJson<MarketRegimeCollection>(`${API_BASE}/api/market/regimes`, { cache: "no-store" })
    ]);
    setStatus(nextStatus);
    setPositions(nextPositions);
    setJournal(nextJournal);
    setAutoMode(nextAutoMode);
    setAutoTrailing(nextAutoTrailing);
    setRecoveryStatus(nextRecoveryStatus);
    setTicks(nextTicks);
    setBackendHealth(nextBackendHealth);
    const nextSyncBySymbol = normalizeInvestingStatuses(nextInvestingStatus);
    setInvestingStatuses(nextSyncBySymbol);
    setInvestingStatus(nextSyncBySymbol.EURUSD ?? nextSyncBySymbol.XAUUSD ?? null);
    setInvestingTechnicals(nextInvestingTechnical.items ?? {});
    setInvestingTechnical(nextInvestingTechnical.items?.EURUSD ?? nextInvestingTechnical.items?.XAUUSD ?? null);
    setSignalLog(nextSignalLog);
    setSignalAudit(nextSignalAudit);
    setPairState(nextPairState);
    setCalendar(nextCalendar);
    setMarketRegimes(nextMarketRegimes.items ?? []);
  }, []);

  React.useEffect(() => {
    refresh().catch(() => setToast("Backend belum aktif di port 9000."));
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  React.useEffect(() => {
    refreshConfluenceScores().catch(() => undefined);
    const timer = window.setInterval(() => {
      refreshConfluenceScores().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [refreshConfluenceScores]);

  React.useEffect(() => {
    if (!autoMode || settingsDirty) return;
    setStrategySettings(strategySettingsFromAutoMode(autoMode));
  }, [autoMode, settingsDirty]);

  const accountMode = autoMode?.accountMode ?? "USD";
  const summary = React.useMemo(() => buildSummary(status, positions, journal), [status, positions, journal]);
  const pairRows = React.useMemo(() => buildPairRows(journal), [journal]);
  const dailyTarget = (status?.balance ?? status?.equity ?? 0) * 0.1;
  const dailyProgress = dailyTarget > 0 ? Math.min(Math.max((summary.dailyPnl / dailyTarget) * 100, 0), 100) : 0;

  async function closePositionGroup(kind: "winning" | "losing") {
    const selected = positions.filter((position) => (
      kind === "winning"
        ? position.profit >= usdToAccountMoney(autoMode?.hardTakeProfitUsd?.[position.symbol] ?? 10, accountMode)
        : position.profit < 0
    ));
    if (selected.length === 0) {
      setToast(`Tidak ada ${kind} trade terbuka.`);
      return;
    }
    const total = selected.reduce((sum, position) => sum + position.profit, 0);
    if (!window.confirm(`Close ${selected.length} ${kind} trade dengan floating P/L ${formatAccountMoney(total, accountMode)}?`)) return;
    let closed = 0;
    for (const position of selected) {
      const response = await fetchJson<ClosePositionResponse>(`${API_BASE}/api/positions/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: position.ticket, confirmed: true })
      });
      if (response.accepted) closed += 1;
    }
    setToast(`${closed}/${selected.length} ${kind} trade closed.`);
    refresh().catch(() => undefined);
  }

  async function closeAllPositions() {
    if (positions.length === 0) {
      setToast("Tidak ada posisi terbuka.");
      return;
    }
    if (!window.confirm(`Close semua ${positions.length} posisi terbuka?`)) return;
    const response = await fetchJson<ClosePositionResponse>(`${API_BASE}/api/positions/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true, confirmed: true })
    });
    setToast(response.message);
    refresh().catch(() => undefined);
  }

  async function restartAllServices() {
    if (!window.confirm("Restart all services now? Backend may be offline for a few seconds; frontend will be started if port 5174 is down.")) return;
    const response = await fetchJson<AllServicesRestartResponse>(`${API_BASE}/api/services/restart-all`, {
      method: "POST",
      cache: "no-store"
    });
    setToast(`${response.message} ${formatServiceActions(response.actions)}`);
    setBackendHealth(null);
    window.setTimeout(() => {
      refresh().catch(() => undefined);
    }, 4500);
  }

  async function toggleAutoMode(enabled: boolean) {
    await saveStrategySettings({ ...strategySettings, enabled });
    setToast(enabled ? "Full Auto ON." : "Full Auto OFF.");
    refresh().catch(() => undefined);
  }

  function updateStrategySettings(patch: Partial<StrategyRiskSettings>) {
    setSettingsDirty(true);
    setStrategySettings((current) => ({ ...current, ...patch }));
  }

  async function saveStrategySettings(nextSettings = strategySettings) {
    const payload = await fetchJson<AutoModeStatus>(`${API_BASE}/api/auto-mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        configVersion: 2,
        strategyProfile: nextSettings.strategyProfile,
        shadowMode: nextSettings.shadowMode,
        enabled: nextSettings.enabled,
        accountMode: nextSettings.accountMode,
        pairProfiles: nextSettings.pairProfiles,
        activeSymbols: nextSettings.activeSymbols.length > 0 ? nextSettings.activeSymbols : ["XAUUSD", "EURUSD"],
        hardTakeProfitUsd: {
          XAUUSD: positiveNumber(nextSettings.xauusdHardTpUsd, 10),
          EURUSD: positiveNumber(nextSettings.eurusdHardTpUsd, 10)
        },
        recoveryEnabled: nextSettings.recoveryEnabled,
        reversalHedgeScore: Math.round(clampNumber(nextSettings.reversalHedgeScore, 50, 100, 75)),
        recoveryResumeScore: Math.round(clampNumber(nextSettings.recoveryResumeScore, 0, 74, 45)),
        hedgeRatio: clampNumber(nextSettings.hedgeRatioPercent, 10, 70, 50) / 100,
        hedgeProfitUsd: {
          XAUUSD: positiveNumber(nextSettings.xauusdHedgeProfitUsd, 10),
          EURUSD: positiveNumber(nextSettings.eurusdHedgeProfitUsd, 10)
        },
        recoveryMultiplier: clampNumber(nextSettings.recoveryMultiplier, 1, 1.5, 1.35),
        maxRecoveryLayers: Math.round(clampNumber(nextSettings.maxRecoveryLayers, 0, 2, 2)),
        basketTargetUsd: {
          XAUUSD: positiveNumber(nextSettings.xauusdBasketTargetUsd, 15),
          EURUSD: positiveNumber(nextSettings.eurusdBasketTargetUsd, 10)
        },
        basketMaxLossUsd: {
          XAUUSD: positiveNumber(nextSettings.xauusdBasketMaxLossUsd, 100),
          EURUSD: positiveNumber(nextSettings.eurusdBasketMaxLossUsd, 50)
        },
        recoveryCooldownSeconds: Math.round(clampNumber(nextSettings.recoveryCooldownSeconds, 15, 3600, 60)),
        shockAtrMultiplier: clampNumber(nextSettings.shockAtrMultiplier, 1, 5, 1.5),
        maxTotalRiskPercent: clampNumber(nextSettings.maxTotalRiskPercent, 0.1, 100, 20),
        maxTotalOpenPositionsAllPairs: Math.round(clampNumber(nextSettings.maxTotalOpenPositionsAllPairs, 1, 50, 15)),
        minScore: Math.round(clampNumber(nextSettings.minScore, 0, 100, 60)),
        riskMode: nextSettings.riskMode,
        riskValue: positiveNumber(nextSettings.riskValue, 0.5),
        scanIntervalSeconds: Math.round(clampNumber(nextSettings.scanIntervalSeconds, 5, 300, 15)),
        duplicateCooldownMinutes: Math.round(clampNumber(nextSettings.duplicateCooldownMinutes, 0, 1440, 10))
      })
    });
    setAutoMode(payload);
    setStrategySettings(strategySettingsFromAutoMode(payload));
    setSettingsDirty(false);
    setToast("Strategy & risk settings saved.");
    refresh().catch(() => undefined);
    refreshConfluenceScores().catch(() => undefined);
    return payload;
  }

  async function resetAllData() {
    if (!window.confirm("Reset semua data summary? History MT5 lama akan disembunyikan dari dashboard, posisi terbuka tidak ditutup.")) return;
    const response = await fetchJson<DataResetResponse>(`${API_BASE}/api/data/reset`, {
      method: "POST",
      cache: "no-store"
    });
    setToast(response.message);
    refresh().catch(() => undefined);
  }

  async function syncInvestingNow() {
    setToast("Sync Investing.com running...");
    const response = await fetchJson<InvestingStatusCollection>(`${API_BASE}/api/investing/sync`, {
      method: "POST",
      cache: "no-store"
    });
    const nextSyncBySymbol = normalizeInvestingStatuses(response);
    setInvestingStatuses(nextSyncBySymbol);
    setInvestingStatus(nextSyncBySymbol.EURUSD ?? nextSyncBySymbol.XAUUSD ?? null);
    const nextTechnical = await fetchJson<InvestingTechnicalCollection>(`${API_BASE}/api/investing/technical`, { cache: "no-store" });
    setInvestingTechnicals(nextTechnical.items ?? {});
    setInvestingTechnical(nextTechnical.items?.EURUSD ?? nextTechnical.items?.XAUUSD ?? null);
    setToast(`Investing sync: ${Object.values(nextSyncBySymbol).map((item) => `${item.symbol} ${item.sync_status}`).join(", ")}`);
    refreshConfluenceScores().catch(() => undefined);
  }

  return (
    <main className="summary-shell">
      <header className="summary-header">
        <div>
          <span className="panel-title">Account summary</span>
          <h1>XAUGBPEUUSD</h1>
        </div>
        <nav className="summary-nav">
          <button className={activePage === "summary" ? "active" : ""} onClick={() => setActivePage("summary")}>Summary</button>
          <button className={activePage === "system" ? "active" : ""} onClick={() => setActivePage("system")}>Strategy System</button>
          <button className={activePage === "settings" ? "active" : ""} onClick={() => setActivePage("settings")}>Settings</button>
          <button className={activePage === "guide" ? "active" : ""} onClick={() => setActivePage("guide")}>Penjelasan Setting</button>
          <button className={activePage === "investing" ? "active" : ""} onClick={() => setActivePage("investing")}>Investing</button>
        </nav>
        <div className="summary-status-row">
          <span className={backendHealth?.active ? "summary-pill ok" : "summary-pill danger"}>{backendHealth?.active ? "Backend active" : "Backend offline"}</span>
          <span className={status?.connected ? "summary-pill ok" : "summary-pill warn"}>{status?.connected ? "MT5 connected" : "MT5 offline"}</span>
          <button className="summary-refresh service-restart" onClick={() => restartAllServices().catch((error) => setToast(error.message))}>Restart all services</button>
          <button className="summary-refresh" onClick={() => refresh().catch(() => undefined)}>Refresh</button>
        </div>
      </header>

      {activePage === "system" ? (
        <StrategySystemPage
          status={status}
          backendHealth={backendHealth}
          autoMode={autoMode}
          autoTrailing={autoTrailing}
          recoveryStatus={recoveryStatus}
          confluenceScores={confluenceScores}
          investingStatuses={investingStatuses}
          pairState={pairState}
          calendar={calendar}
          signalLog={signalLog}
          signalAudit={signalAudit}
          marketRegimes={marketRegimes}
        />
      ) : activePage === "settings" ? (
        <StrategySettingsPage
          settings={strategySettings}
          autoMode={autoMode}
          marketRegimes={marketRegimes}
          settingsDirty={settingsDirty}
          onChange={updateStrategySettings}
          onSave={() => saveStrategySettings().catch((error) => setToast(error.message))}
          onReset={() => {
            setSettingsDirty(false);
            if (autoMode) {
              setStrategySettings(strategySettingsFromAutoMode(autoMode));
            } else {
              setStrategySettings(defaultStrategyRiskSettings);
            }
          }}
        />
      ) : activePage === "guide" ? (
        <SettingsExplanationPage />
      ) : activePage === "investing" ? (
        <InvestingDataPage statuses={investingStatuses} technicals={investingTechnicals} onSync={syncInvestingNow} />
      ) : (
        <>
      <section className="summary-quotes top">
        {symbols.map((item) => (
          <div key={item} className="quote-card">
            <span>{item}</span>
            <strong>{formatPrice(ticks[item]?.mid ?? null)}</strong>
            <small>Spread {formatSpread(ticks[item]?.spread_points ?? null)} pts</small>
          </div>
        ))}
        <div className="quote-card">
          <span>Full Auto</span>
          <strong>{autoMode?.enabled ? "ON" : "OFF"}</strong>
          <small>Total risk cap {formatPercent(autoMode?.maxTotalRiskPercent ?? 20)}</small>
          <small>Active {formatActiveSymbols(autoMode?.activeSymbols)}</small>
        </div>
        <div className="quote-card">
          <span>Account Mode</span>
          <strong>{accountMode}</strong>
          <small>{accountMode === "USC" ? "100 USC = 1 USD" : "Standard dollar account"}</small>
          <small>Broker: {status?.currency ?? "--"}</small>
        </div>
        <div className="quote-card">
          <span>Auto Trailing</span>
          <strong>{autoTrailing?.activeTickets ?? 0}/{autoTrailing?.trackedTickets ?? 0}</strong>
          <small>Always ON - checks every {formatSeconds(autoTrailing?.monitorIntervalSeconds ?? 1)}</small>
          <small>{formatTrailingRules(autoTrailing?.rules)}</small>
        </div>
        <div className="quote-card">
          <span>Hedge Recovery</span>
          <strong>{recoveryStatus?.enabled ? "ON" : "OFF"}</strong>
          <small>{formatRecoveryPhases(recoveryStatus?.cycles)}</small>
          <small>Checks every {formatSeconds(recoveryStatus?.monitorIntervalSeconds ?? 5)}</small>
        </div>
      </section>

      <InvestingSyncCard sync={investingStatus} onSync={syncInvestingNow} />

      <section className="confluence-panel">
        <div className="summary-section-heading compact">
          <div>
            <span className="panel-title">Confluence score</span>
            <h2>XAUUSD and EURUSD by timeframe</h2>
          </div>
          <small>M15, M30, H1 execution. H4 and D1 monitor.</small>
        </div>
        <div className="confluence-groups">
          {symbols.map((item) => (
            <div key={item} className="confluence-group">
              <strong>{item}</strong>
              <div className="confluence-cards">
                {timeframes.map((itemTimeframe) => {
                  const score = confluenceScores.find((entry) => entry.symbol === item && entry.timeframe === itemTimeframe);
                  return <ConfluenceCard key={`${item}-${itemTimeframe}`} score={score} symbol={item} timeframe={itemTimeframe} />;
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="summary-grid">
        <SummaryMetric title="P/L Total" value={formatAccountMoney(summary.totalPnl, accountMode)} tone={summary.totalPnl >= 0 ? "positive" : "negative"} />
        <SummaryMetric title="P/L Daily" value={formatAccountMoney(summary.dailyPnl, accountMode)} tone={summary.dailyPnl >= 0 ? "positive" : "negative"} />
        <SummaryMetric title="Current Position P/L" value={formatAccountMoney(summary.floatingPnl, accountMode)} tone={summary.floatingPnl >= 0 ? "positive" : "negative"} detail="Floating open positions" />
        <SummaryMetric title="Daily Target" value={formatAccountMoney(summary.dailyPnl, accountMode)} detail={`${dailyProgress.toFixed(1)}% dari target 10% (${formatAccountMoney(dailyTarget, accountMode)})`} tone={summary.dailyPnl >= 0 ? "positive" : "negative"} />
        <SummaryMetric title="Open Positions" value={`${positions.length}`} detail={`${summary.winningOpenCount} win / ${summary.losingOpenCount} loss`} />
        <SummaryMetric title="Profit Factor" value={summary.profitFactorLabel} detail={`${formatAccountMoney(summary.grossProfit, accountMode)} win / ${formatAccountMoney(summary.grossLoss, accountMode)} loss`} />
        <SummaryMetric title="Equity" value={formatAccountMoney(status?.equity ?? 0, accountMode)} detail={`Balance ${formatAccountMoney(status?.balance ?? 0, accountMode)}`} />
      </section>

      <section className="target-card">
        <div>
          <span className="panel-title">Daily target achieved</span>
          <strong>{formatAccountMoney(summary.dailyPnl, accountMode)}</strong>
          <small>Target 10%: {formatAccountMoney(dailyTarget, accountMode)} - {dailyProgress.toFixed(1)}% reached</small>
        </div>
        <div className="target-track">
          <span style={{ width: `${dailyProgress}%` }} />
        </div>
      </section>

      <section className="summary-actions">
        <button className={autoMode?.enabled ? "auto-toggle on" : "auto-toggle off"} onClick={() => toggleAutoMode(!(autoMode?.enabled ?? false))}>
          Full Auto {autoMode?.enabled ? "ON" : "OFF"}
        </button>
        <button className="close-win" onClick={() => closePositionGroup("winning")}>Close winning trades &gt;= $10</button>
        <button className="close-loss" onClick={() => closePositionGroup("losing")}>Close all losing trades</button>
        <button className="close-all" onClick={closeAllPositions}>Close all open trades</button>
        <button className="reset-data" onClick={resetAllData}>Reset all data</button>
      </section>

      <section className="summary-table-card">
        <div className="summary-section-heading">
          <div>
            <span className="panel-title">Pair performance</span>
            <h2>Winning and losing trades by pair</h2>
          </div>
          <small>Closed trade journal, nominal {accountMode}.</small>
        </div>
        <table className="summary-table">
          <thead>
            <tr>
              <th>Pair</th>
              <th>Winning trades</th>
              <th>Winning {accountMode}</th>
              <th>Losing trades</th>
              <th>Losing {accountMode}</th>
              <th>Net {accountMode}</th>
            </tr>
          </thead>
          <tbody>
            {pairRows.map((row) => (
              <tr key={row.symbol}>
                <td>{row.symbol}</td>
                <td>{row.wins}</td>
                <td className="profit-text">{formatAccountMoney(row.winUsd, accountMode)}</td>
                <td>{row.losses}</td>
                <td className="loss-text">{formatAccountMoney(row.lossUsd, accountMode)}</td>
                <td className={row.netUsd >= 0 ? "profit-text" : "loss-text"}>{formatAccountMoney(row.netUsd, accountMode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="summary-table-card">
        <div className="summary-section-heading">
          <div>
            <span className="panel-title">Open positions</span>
            <h2>Current floating P/L</h2>
          </div>
          <small>Hard TP uses USD targets; in USC mode $10 equals 1,000 USC.</small>
        </div>
        <table className="summary-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Pair</th>
              <th>Side</th>
              <th>Lot</th>
              <th>Open</th>
              <th>Current</th>
              <th>Floating $</th>
            </tr>
          </thead>
          <tbody>
            {positions.length > 0 ? positions.map((position) => (
              <tr key={position.ticket}>
                <td>{position.ticket}</td>
                <td>{position.symbol}</td>
                <td>{position.side}</td>
                <td>{position.volume.toFixed(2)}</td>
                <td>{formatPrice(position.open_price)}</td>
                <td>{formatPrice(position.current_price)}</td>
                <td className={position.profit >= 0 ? "profit-text" : "loss-text"}>{formatAccountMoney(position.profit, accountMode)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={7}>No open positions.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
      <footer className="app-copyright">
        <span>Copyright (C) 2026 FiyyaLisanaDeV.</span>
        <span>Licensed under AFPL v8. Unauthorized use outside the license is prohibited.</span>
      </footer>
    </main>
  );
}

function SummaryMetric({ title, value, detail, tone }: { title: string; value: string; detail?: string; tone?: "positive" | "negative" }) {
  return (
    <article className={`summary-metric ${tone ?? ""}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function InvestingSyncCard({ sync, onSync }: { sync: InvestingDataSync | null; onSync: () => void }) {
  const status = sync?.sync_status ?? "BLOCKED";
  const allowed = sync?.strategy_use === "ALLOWED";
  return (
    <section className={`investing-sync-card ${allowed ? "allowed" : "blocked"}`}>
      <div className="summary-section-heading compact">
        <div>
          <span className="panel-title">Investing Data Sync</span>
          <h2>{sync?.symbol ?? "EURUSD"} technical confirmation</h2>
        </div>
        <button className="settings-secondary" onClick={onSync}>Sync now</button>
      </div>
      <div className="investing-sync-grid">
        <Metric label="Sync status" value={status} />
        <Metric label="Auto sync" value={`Every ${Math.round(INVESTING_AUTO_SYNC_SECONDS / 60)}m`} />
        <Metric label="Last sync" value={sync?.last_sync_utc ? formatDateLabel(sync.last_sync_utc) : "--"} />
        <Metric label="Data mode" value={sync?.data_mode ?? "NONE"} />
        <Metric label="Strategy use" value={sync?.strategy_use ?? "BLOCKED"} />
        <Metric label="Retry" value={`${sync?.retry_attempt ?? 0} / ${sync?.retry_max ?? 3}`} />
        <Metric label="Cache age" value={sync?.cache_age_seconds === null || sync?.cache_age_seconds === undefined ? "--" : `${Math.round(sync.cache_age_seconds / 60)}m`} />
        <Metric label="Parser" value={sync?.parser_status ?? "FAILED"} />
      </div>
      <small>{sync?.message ?? "Investing.com sync belum tersedia."}{sync?.error ? ` Error: ${sync.error}` : ""}</small>
    </section>
  );
}

function InvestingDataPage({ statuses, technicals, onSync }: { statuses: Partial<Record<SymbolName, InvestingDataSync>>; technicals: Partial<Record<SymbolName, InvestingTechnicalData>>; onSync: () => void }) {
  return (
    <section className="investing-page">
      <div className="summary-section-heading">
        <div>
          <span className="panel-title">Investing.com technical data</span>
          <h2>XAUUSD and EURUSD synced datasets</h2>
        </div>
        <div className="investing-auto-sync-summary">
          <span>Auto sync every {Math.round(INVESTING_AUTO_SYNC_SECONDS / 60)} minute</span>
          <button className="summary-refresh" onClick={onSync}>Sync now</button>
        </div>
      </div>

      {symbols.map((symbol) => (
        <InvestingSymbolData key={symbol} symbol={symbol} sync={statuses[symbol] ?? null} technical={technicals[symbol] ?? null} onSync={onSync} />
      ))}
    </section>
  );
}

function InvestingSymbolData({ symbol, sync, technical, onSync }: { symbol: SymbolName; sync: InvestingDataSync | null; technical: InvestingTechnicalData | null; onSync: () => void }) {
  const summary = technical?.summary;
  const activeTimeframe = technical?.selected_timeframe ?? "1h";
  const activeTimeframeSignal = technical?.timeframe_signals?.[activeTimeframe];
  return (
    <section className="investing-symbol-section">
      <InvestingSyncCard sync={sync} onSync={onSync} />

      <section className="investing-overview-card">
        <div className="summary-section-heading compact">
          <div>
            <span className="panel-title">{symbol}</span>
            <h2>Investing confirmation snapshot</h2>
          </div>
        </div>
        <div className="investing-overview-grid">
          <article>
            <span>Overall bias</span>
            <strong className={investingToneClass(summary?.overall)}>{formatInvestingCode(summary?.overall)}</strong>
            <small>Full technical summary</small>
          </article>
          <article>
            <span>Selected detail TF</span>
            <strong>{technical?.selected_timeframe_label ?? activeTimeframe}</strong>
            <small>{activeTimeframeSignal?.signal?.label ?? "Detail table source"}</small>
          </article>
          <article>
            <span>Last sync</span>
            <strong>{technical?.scraped_at_utc ? formatDateLabel(technical.scraped_at_utc) : "--"}</strong>
            <small>{sync?.data_mode ?? "NONE"} data mode</small>
          </article>
          <article>
            <span>Pivot source</span>
            <strong>{formatPivotSource(technical?.pivot_parser_status)}</strong>
            <small>{technical?.pivot_url ?? technical?.sources?.pivot_fibonacci ? "Fibonacci levels available" : "No pivot URL"}</small>
          </article>
        </div>
        {technical?.pivot_error ? <p className="investing-error">Pivot Fibonacci: {technical.pivot_error}</p> : null}
      </section>

      <section className="investing-data-card">
        <div className="summary-section-heading compact">
          <div>
            <span className="panel-title">{symbol}</span>
            <h2>Technical bias</h2>
          </div>
        </div>
        <div className="investing-meta-grid">
          <Metric label="Overall" value={formatInvestingCode(summary?.overall)} />
          <Metric label="Moving average" value={formatInvestingCode(summary?.moving_average?.signal)} />
          <Metric label="MA buy/sell" value={`${summary?.moving_average?.buy ?? 0} / ${summary?.moving_average?.sell ?? 0}`} />
          <Metric label="Indicators" value={formatInvestingCode(summary?.technical_indicators?.signal)} />
          <Metric label="Indicator buy/sell" value={`${summary?.technical_indicators?.buy ?? 0} / ${summary?.technical_indicators?.sell ?? 0}`} />
        </div>
      </section>

      <InvestingTimeframeTable symbol={symbol} technical={technical} />
      <InvestingTable title={`${symbol} technical indicators`} items={technical?.indicators ?? {}} columns={["Name", "Value", "Action", "Raw"]} />
      <InvestingTable title={`${symbol} moving averages`} items={technical?.moving_averages ?? {}} columns={["Name", "Value", "Action", "Raw"]} />
      <InvestingPivotTable title={`${symbol} Fibonacci pivot levels`} items={technical?.pivot_points ?? {}} />
    </section>
  );
}

function InvestingTimeframeTable({ symbol, technical }: { symbol: SymbolName; technical: InvestingTechnicalData | null }) {
  const entries = Object.entries(technical?.timeframe_signals ?? {});
  const appMap = technical?.app_timeframe_map ?? {};
  const mappedAppLabels = (investingKey: string) =>
    Object.entries(appMap)
      .filter(([, value]) => value === investingKey)
      .map(([key]) => key)
      .join(", ") || "--";
  return (
    <section className="summary-table-card">
      <div className="summary-section-heading compact">
        <div>
          <span className="panel-title">Investing.com timeframe</span>
          <h2>{symbol} timeframe confirmation map</h2>
        </div>
        <small>Confluence timeframe is checked against the matching Investing timeframe.</small>
      </div>
      <table className="summary-table investing-table">
        <thead>
          <tr>
            <th>Investing TF</th>
            <th>Used by app TF</th>
            <th>Signal</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.length > 0 ? entries.map(([key, item]) => (
            <tr key={key}>
              <td>{item.mapped_label ?? key}{item.active ? " (selected detail)" : ""}</td>
              <td>{mappedAppLabels(key)}</td>
              <td>{item.signal?.label ?? "--"} ({item.signal?.code ?? "--"})</td>
              <td>{item.locked ? "Locked by Investing" : "Available"}</td>
            </tr>
          )) : (
            <tr><td colSpan={4}>No Investing timeframe signal.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function InvestingPivotTable({ title, items }: { title: string; items: Record<string, InvestingTechnicalItem> }) {
  const order = ["S3", "S2", "S1", "PIVOT", "R1", "R2", "R3"];
  const rows = order
    .filter((level) => items[level])
    .map((level) => [level, items[level]] as const);
  return (
    <section className="summary-table-card pivot-level-card">
      <div className="summary-section-heading compact">
        <div>
          <span className="panel-title">Investing.com Fibonacci</span>
          <h2>{title}</h2>
        </div>
        <small>{rows.length} level</small>
      </div>
      <table className="summary-table pivot-table">
        <thead>
          <tr>
            <th>Level</th>
            <th>Type</th>
            <th>Price</th>
            <th>Distance</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? rows.map(([level, item]) => (
            <tr key={level} className={`pivot-row ${pivotType(level).toLowerCase()}`}>
              <td><span className={`pivot-level ${pivotType(level).toLowerCase()}`}>{level}</span></td>
              <td>{pivotType(level)}</td>
              <td className="pivot-price">{formatInvestingPrice(item.value)}</td>
              <td>{pivotDistance(level)}</td>
              <td>{formatPivotSource(item.source)}</td>
            </tr>
          )) : (
            <tr><td colSpan={5}>No synced pivot level.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function InvestingTable({ title, items, columns }: { title: string; items: Record<string, InvestingTechnicalItem>; columns: string[] }) {
  const rows = Object.entries(items);
  return (
    <section className="summary-table-card">
      <div className="summary-section-heading compact">
        <div>
          <span className="panel-title">Investing.com</span>
          <h2>{title}</h2>
        </div>
        <small>{rows.length} item</small>
      </div>
      <table className="summary-table investing-table">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length > 0 ? rows.map(([name, item]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{item.value === null || item.value === undefined ? "--" : item.value}</td>
              <td>{item.action ? `${item.action.label} (${item.action.code})` : "--"}</td>
              <td>{item.raw?.join(" | ") ?? "--"}</td>
            </tr>
          )) : (
            <tr><td colSpan={columns.length}>No synced data.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

type CheckTone = "PASS" | "WARNING" | "BLOCKED" | "OFF" | "INFO";

interface ParameterCheckRow {
  group: string;
  parameter: string;
  value: string;
  expected: string;
  status: CheckTone;
  detail: string;
}

function StrategySystemPage({
  status,
  backendHealth,
  autoMode,
  autoTrailing,
  recoveryStatus,
  confluenceScores,
  investingStatuses,
  pairState,
  calendar,
  signalLog,
  signalAudit,
  marketRegimes
}: {
  status: Status | null;
  backendHealth: BackendHealth | null;
  autoMode: AutoModeStatus | null;
  autoTrailing: AutoTrailingStatus | null;
  recoveryStatus: RecoveryEngineStatus | null;
  confluenceScores: ConfluenceScoreCard[];
  investingStatuses: Partial<Record<SymbolName, InvestingDataSync>>;
  pairState: PairStateResponse | null;
  calendar: EconomicCalendarResponse | null;
  signalLog: SignalLogEntry[];
  signalAudit: SignalAuditEntry[];
  marketRegimes: MarketRegimeAssessment[];
}) {
  const rows = React.useMemo<ParameterCheckRow[]>(() => {
    const checks: ParameterCheckRow[] = [
      {
        group: "Runtime",
        parameter: "Backend service",
        value: backendHealth?.active ? `Online PID ${backendHealth.pid}` : "Offline",
        expected: "Online",
        status: backendHealth?.active ? "PASS" : "BLOCKED",
        detail: backendHealth?.message ?? "Backend health unavailable"
      },
      {
        group: "Runtime",
        parameter: "MT5 connection",
        value: status?.connected ? `${status.server ?? "MT5"} / ${status.account_login ?? "--"}` : "Disconnected",
        expected: "Connected",
        status: status?.connected ? "PASS" : "BLOCKED",
        detail: status?.message ?? "MT5 status unavailable"
      },
      {
        group: "Runtime",
        parameter: "MT5 trade readiness",
        value: status?.trade_ready ? "Ready" : "Not ready",
        expected: "Algo Trading enabled",
        status: status?.trade_ready ? "PASS" : "BLOCKED",
        detail: `Terminal ${status?.terminal_trade_allowed ? "allowed" : "blocked"}, account ${status?.account_trade_allowed ? "allowed" : "blocked"}`
      },
      {
        group: "Runtime",
        parameter: "Configuration",
        value: `v${autoMode?.configVersion ?? "--"} / ${autoMode?.accountMode ?? "--"}`,
        expected: "v2",
        status: autoMode?.configVersion === 2 ? "PASS" : "BLOCKED",
        detail: `Active pairs: ${formatActiveSymbols(autoMode?.activeSymbols ?? [])}`
      },
      {
        group: "Execution",
        parameter: "Full Auto",
        value: autoMode?.enabled ? "ON" : "OFF",
        expected: "User controlled",
        status: autoMode?.enabled ? "PASS" : "OFF",
        detail: autoMode?.blockedReason ?? "No current backend block"
      },
      {
        group: "Execution",
        parameter: "Shadow mode",
        value: autoMode?.shadowMode ? "ON" : "OFF",
        expected: "ON during migration",
        status: autoMode?.shadowMode ? "WARNING" : "PASS",
        detail: autoMode?.shadowMode ? "Orders are validated and logged but not sent" : "Approved orders may be sent to MT5"
      },
      {
        group: "Risk",
        parameter: "Total risk cap",
        value: `${formatPercent(autoMode?.exposure?.totalRiskPercent)} used`,
        expected: `<= ${formatPercent(autoMode?.maxTotalRiskPercent ?? 20)}`,
        status: autoMode?.exposure?.blocked ? "BLOCKED" : "PASS",
        detail: `${formatMoney(autoMode?.exposure?.totalRiskUsd ?? 0)} projected risk`
      },
      {
        group: "Risk",
        parameter: "All-pair position cap",
        value: `${autoMode?.pairExposure?.reduce((sum, item) => sum + item.openPositions, 0) ?? 0} open`,
        expected: `<= ${autoMode?.maxTotalOpenPositionsAllPairs ?? 15}`,
        status: (autoMode?.pairExposure?.reduce((sum, item) => sum + item.openPositions, 0) ?? 0) >= (autoMode?.maxTotalOpenPositionsAllPairs ?? 15) ? "BLOCKED" : "PASS",
        detail: "Counts all active pair positions"
      },
      {
        group: "State",
        parameter: "Pair state storage",
        value: pairState?.healthy ? "Healthy" : "Unavailable",
        expected: "Healthy and persistent",
        status: pairState?.healthy ? "PASS" : "BLOCKED",
        detail: pairState?.error ?? "Atomic JSON persistence active"
      },
      {
        group: "Services",
        parameter: "Hard TP / trailing monitor",
        value: `${autoTrailing?.activeTickets ?? 0}/${autoTrailing?.trackedTickets ?? 0} active`,
        expected: `Polling ${formatSeconds(autoTrailing?.monitorIntervalSeconds ?? 1)}`,
        status: autoTrailing?.enabled ? "PASS" : "BLOCKED",
        detail: autoTrailing?.message ?? "Trailing status unavailable"
      },
      {
        group: "Services",
        parameter: "Recovery engine",
        value: recoveryStatus?.enabled ? "ON" : "OFF",
        expected: autoMode?.recoveryEnabled ? "ON" : "OFF by configuration",
        status: recoveryStatus?.enabled ? "WARNING" : "OFF",
        detail: recoveryStatus?.message ?? "Recovery status unavailable"
      },
      {
        group: "Market data",
        parameter: "Economic calendar",
        value: calendar?.configured ? `${calendar.events.length} events` : "Not configured",
        expected: "Required for strict EURUSD",
        status: calendar?.configured ? "PASS" : "BLOCKED",
        detail: calendar?.message ?? "Calendar status unavailable"
      }
    ];

    symbols.forEach((symbol) => {
      const profile = autoMode?.pairProfiles?.[symbol];
      const exposure = autoMode?.pairExposure?.find((item) => item.symbol === symbol);
      const state = pairState?.states?.[symbol];
      const investing = investingStatuses[symbol];
      const executionRegimes = marketRegimes.filter((item) => item.symbol === symbol && profile?.executionTimeframes.includes(item.timeframe));
      const primaryRegime = executionRegimes.find((item) => item.timeframe === "H1") ?? executionRegimes[0];
      if (!profile) return;
      checks.push(
        {
          group: symbol,
          parameter: "Pair profile",
          value: profile.enabled ? "Enabled" : "Disabled",
          expected: symbol === "EURUSD" ? "Strict pair profile" : "Advisory XAU profile",
          status: profile.enabled ? "PASS" : "OFF",
          detail: `${profile.marketFactGate} gate, Investing ${profile.investingMode}`
        },
        {
          group: symbol,
          parameter: "Internal strategy engine",
          value: "EMA/MA + zones + Quasimodo",
          expected: "Side-aware scoring",
          status: "PASS",
          detail: "Support/demand validates BUY; resistance/supply validates SELL; Fibonacci remains context"
        },
        {
          group: symbol,
          parameter: "Execution timeframes",
          value: profile.executionTimeframes.join(", "),
          expected: "M15, M30, H1",
          status: profile.executionTimeframes.join(",") === "M15,M30,H1" ? "PASS" : "WARNING",
          detail: `Monitor only: ${profile.monitorTimeframes.join(", ")}`
        },
        {
          group: symbol,
          parameter: "Closed candle / signal expiry",
          value: "Enabled",
          expected: "Latest completed candle",
          status: "PASS",
          detail: "Direction confirmation and timeframe TTL are checked before execution"
        },
        {
          group: symbol,
          parameter: "Position exposure",
          value: `${exposure?.openPositions ?? 0}/${profile.maxOpenPositions} positions`,
          expected: `Lot <= ${profile.maxTotalLot.toFixed(2)}`,
          status: exposureTone(exposure?.status),
          detail: `${(exposure?.totalLot ?? 0).toFixed(2)} lot, ${exposure?.tradeMode ?? "UNKNOWN"} mode`
        },
        {
          group: symbol,
          parameter: "Aggregate SL risk",
          value: `${(exposure?.aggregateSlRiskPercent ?? 0).toFixed(3)}%`,
          expected: `<= ${profile.aggregateSlRiskCapPercent}%`,
          status: (exposure?.aggregateSlRiskPercent ?? 0) >= profile.aggregateSlRiskCapPercent ? (autoMode?.shadowMode ? "WARNING" : "BLOCKED") : "PASS",
          detail: `${formatMoney(exposure?.aggregateSlRiskUsd ?? 0)} projected loss to SL`
        },
        {
          group: symbol,
          parameter: "Spread guard",
          value: `Max ${profile.maxSpread} pts`,
          expected: `Current source must remain <= ${profile.maxSpread}`,
          status: "PASS",
          detail: "Validated again during order validation"
        },
        {
          group: symbol,
          parameter: "Order risk model",
          value: `${profile.riskPercent}% / max ${profile.maxLot.toFixed(2)} lot`,
          expected: `RR >= ${profile.minRiskReward.toFixed(1)}`,
          status: "PASS",
          detail: symbol === "EURUSD" ? `${profile.minStopPips}-${profile.maxStopPips} pip SL clamp` : "Existing XAU SL/TP model preserved"
        },
        {
          group: symbol,
          parameter: "Hard take profit",
          value: `${formatMoney(autoMode?.hardTakeProfitUsd?.[symbol] ?? 10)} per position`,
          expected: "Monitor every second",
          status: autoTrailing?.enabled ? "PASS" : "BLOCKED",
          detail: "Hard TP has priority outside an active recovery basket"
        },
        {
          group: symbol,
          parameter: "Market regime",
          value: primaryRegime ? `${primaryRegime.regime} ${primaryRegime.confidence}%` : "Unavailable",
          expected: `${profile.marketRegimeMode}; ${profile.allowedMarketRegimes.join(", ")}`,
          status: !primaryRegime
            ? "WARNING"
            : profile.marketRegimeMode === "strict" && !profile.allowedMarketRegimes.includes(primaryRegime.regime)
              ? "BLOCKED"
              : profile.marketRegimeMode === "disabled" ? "OFF" : "PASS",
          detail: primaryRegime?.approach ?? "Market regime data unavailable"
        },
        {
          group: symbol,
          parameter: "Investing sync",
          value: `${investing?.sync_status ?? "UNKNOWN"} / ${investing?.data_mode ?? "NONE"}`,
          expected: profile.investingMode === "required" ? "Fresh and ALLOWED" : `Mode ${profile.investingMode}`,
          status: investing?.strategy_use === "ALLOWED" ? "PASS" : profile.investingMode === "required" ? "BLOCKED" : "WARNING",
          detail: investing?.message ?? "No sync status"
        },
        {
          group: symbol,
          parameter: "Trade state",
          value: state?.closeOnlyMode ? "CLOSE_ONLY" : state?.lockedUntil ? "LOCKED" : "NORMAL",
          expected: "NORMAL",
          status: state?.closeOnlyMode || state?.lockedUntil ? "BLOCKED" : "PASS",
          detail: state?.closeOnlyReason ?? state?.lockReason ?? `${state?.dailyTradeCount ?? 0} daily / ${state?.hourlyTradeCount ?? 0} hourly trades`
        },
        {
          group: symbol,
          parameter: "Recovery",
          value: profile.recoveryEnabled ? "Enabled" : "Disabled",
          expected: symbol === "EURUSD" ? "Disabled" : "Configurable",
          status: symbol === "EURUSD" && profile.recoveryEnabled ? "BLOCKED" : profile.recoveryEnabled ? "WARNING" : "PASS",
          detail: profile.closeOnly || state?.closeOnlyMode ? "Blocked by close-only state" : "Subject to pair exposure guard"
        }
      );
    });
    return checks;
  }, [autoMode, autoTrailing, backendHealth, calendar, investingStatuses, marketRegimes, pairState, recoveryStatus, status]);

  const blockedCount = rows.filter((row) => row.status === "BLOCKED").length;
  const warningCount = rows.filter((row) => row.status === "WARNING").length;
  const passedCount = rows.filter((row) => row.status === "PASS").length;
  const latestSignals = signalLog.slice(0, 30);
  const latestAudit = signalAudit.slice(0, 30);

  return (
    <section className="parameter-page">
      <div className="parameter-toolbar">
        <div>
          <span className="panel-title">Live parameter check</span>
          <h2>Strategy, risk, signal, and service validation</h2>
        </div>
        <div className="parameter-counts">
          <span className="check-count pass">{passedCount} PASS</span>
          <span className="check-count warning">{warningCount} WARNING</span>
          <span className="check-count blocked">{blockedCount} BLOCKED</span>
        </div>
      </div>

      <section className="parameter-status-strip">
        <ParameterHeadline label="Execution readiness" value={blockedCount === 0 ? "READY" : "BLOCKED"} tone={blockedCount === 0 ? "PASS" : "BLOCKED"} />
        <ParameterHeadline label="Shadow mode" value={autoMode?.shadowMode ? "ACTIVE" : "OFF"} tone={autoMode?.shadowMode ? "WARNING" : "PASS"} />
        <ParameterHeadline label="Signal logger" value={`${signalLog.length} loaded`} tone="INFO" />
        <ParameterHeadline label="Audit decisions" value={`${signalAudit.length} loaded`} tone="INFO" />
        <ParameterHeadline label="Minimum score" value={`${autoMode?.minScore ?? 60}`} tone="INFO" />
      </section>

      <section className="summary-table-card parameter-table-card">
        <div className="summary-section-heading compact">
          <div>
            <span className="panel-title">All active parameters</span>
            <h2>Expected value versus runtime value</h2>
          </div>
          <small>Updated automatically with the dashboard refresh cycle.</small>
        </div>
        <table className="summary-table parameter-table">
          <thead><tr><th>Group</th><th>Parameter</th><th>Current value</th><th>Expected / limit</th><th>Status</th><th>Detail</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.group}-${row.parameter}-${index}`}>
                <td><strong>{row.group}</strong></td>
                <td>{row.parameter}</td>
                <td>{row.value}</td>
                <td>{row.expected}</td>
                <td><CheckStatus value={row.status} /></td>
                <td className="parameter-detail">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="confluence-panel parameter-confluence">
        <div className="summary-section-heading compact">
          <div><span className="panel-title">Strategy signal check</span><h2>Confluence status by pair and timeframe</h2></div>
          <small>M15/M30/H1 execution, H4/D1 context.</small>
        </div>
        <div className="confluence-groups">
          {symbols.map((symbol) => (
            <div key={symbol} className="confluence-group">
              <strong>{symbol}</strong>
              <div className="confluence-cards">
                {timeframes.map((timeframe) => <ConfluenceCard key={`${symbol}-${timeframe}`} score={confluenceScores.find((item) => item.symbol === symbol && item.timeframe === timeframe)} symbol={symbol} timeframe={timeframe} />)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="summary-table-card parameter-table-card">
        <div className="summary-section-heading compact">
          <div><span className="panel-title">Market condition matrix</span><h2>Regime by pair and timeframe</h2></div>
          <span>Execution: M15, M30, H1</span>
        </div>
        <div className="market-regime-grid">
          {marketRegimes.map((item) => <MarketRegimeCard key={`${item.symbol}-${item.timeframe}`} item={item} />)}
        </div>
      </section>

      <section className="summary-table-card">
        <div className="summary-section-heading compact">
          <div><span className="panel-title">Signal logger</span><h2>Latest potential signals</h2></div>
          <small>{signalLog.length} records loaded</small>
        </div>
        <table className="summary-table parameter-log-table">
          <thead><tr><th>Detected</th><th>Pair</th><th>TF</th><th>Score</th><th>Side / order</th><th>Setup</th><th>Entry</th><th>SL</th><th>TP</th><th>Status</th><th>Reason</th></tr></thead>
          <tbody>
            {latestSignals.length ? latestSignals.map((item) => (
              <tr key={item.id}>
                <td>{item.date} {item.time}</td><td>{item.symbol}</td><td>{item.timeframe}</td><td><strong>{item.score}</strong></td>
                <td>{item.orderType?.replace("_", " ") ?? item.side ?? "WAIT"}</td><td>{item.setupType}</td>
                <td>{formatPrice(item.entry)}</td><td>{formatPrice(item.stopLoss)}</td><td>{formatPrice(item.takeProfit)}</td>
                <td><CheckStatus value={item.status === "blocked" ? "BLOCKED" : "INFO"} /></td>
                <td className="parameter-detail">{item.blockedReasons[0] ?? item.reasons[0] ?? "--"}</td>
              </tr>
            )) : <tr><td colSpan={11}>No signal logger records.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="summary-table-card">
        <div className="summary-section-heading compact">
          <div><span className="panel-title">Decision audit</span><h2>Latest pair-gate decisions</h2></div>
          <small>{signalAudit.length} records loaded</small>
        </div>
        <table className="summary-table parameter-log-table">
          <thead><tr><th>Recorded</th><th>Pair</th><th>TF</th><th>Mode</th><th>Side</th><th>Score</th><th>Regime</th><th>Gate</th><th>Final action</th><th>Reason</th></tr></thead>
          <tbody>
            {latestAudit.length ? latestAudit.map((item, index) => (
              <tr key={`${item.recordedAt}-${index}`}>
                <td>{item.recordedAt ? formatDateLabel(item.recordedAt) : "--"}</td><td>{item.symbol ?? "--"}</td><td>{item.timeframe ?? "--"}</td>
                <td>{item.mode ?? "--"}</td><td>{item.side ?? "--"}</td><td>{item.internalScore ?? "--"}</td><td>{item.marketRegime ?? "--"}</td>
                <td><CheckStatus value={auditTone(item.gateDecision)} /></td><td>{item.finalAction ?? "--"}</td>
                <td className="parameter-detail">{item.blockedReasons?.[0] ?? "--"}</td>
              </tr>
            )) : <tr><td colSpan={10}>No detailed gate audit recorded yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </section>
  );
}

function ParameterHeadline({ label, value, tone }: { label: string; value: string; tone: CheckTone }) {
  return <article className={`parameter-headline ${tone.toLowerCase()}`}><span>{label}</span><strong>{value}</strong></article>;
}

function CheckStatus({ value }: { value: CheckTone }) {
  return <span className={`parameter-status ${value.toLowerCase()}`}>{value}</span>;
}

function MarketRegimeCard({ item }: { item: MarketRegimeAssessment }) {
  return (
    <article className={`market-regime-card ${marketRegimeTone(item.regime)}`}>
      <div>
        <strong>{item.symbol} · {item.timeframe}</strong>
        <span>{item.regime.replace(/_/g, " ")}</span>
      </div>
      <div className="market-regime-confidence">
        <span>Confidence</span>
        <strong>{item.confidence}%</strong>
      </div>
      <p>{item.approach}</p>
      <small>Efficiency {item.efficiencyRatio.toFixed(2)} · EMA gap {item.emaGapAtr.toFixed(2)} ATR · Vol {item.atrPercent.toFixed(3)}%</small>
    </article>
  );
}

function exposureTone(value: PairExposureStatus["status"] | undefined): CheckTone {
  if (value === "SAFE") return "PASS";
  if (value === "WARNING") return "WARNING";
  if (value === "BLOCKED" || value === "CLOSE_ONLY" || value === "LOCKED") return "BLOCKED";
  return "INFO";
}

function auditTone(value: string | undefined): CheckTone {
  if (value === "STRONG_PASS" || value === "PASS") return "PASS";
  if (value === "WEAK_PASS") return "WARNING";
  if (value === "BLOCK" || value === "HARD_BLOCK") return "BLOCKED";
  return "INFO";
}

function SettingsExplanationPage() {
  return (
    <section className="settings-guide-page">
      <header className="settings-guide-header">
        <span className="panel-title">Panduan konfigurasi</span>
        <h2>Penjelasan Setting</h2>
        <p>Gunakan halaman ini untuk memahami dampak setiap profil sebelum mengaktifkan Full Auto.</p>
      </header>

      <section className="guide-section">
        <div className="summary-section-heading compact">
          <div><span className="panel-title">Simple mode</span><h2>Klasifikasi profil trading</h2></div>
        </div>
        <div className="guide-profile-grid">
          {(["CONSERVATIVE", "OPPORTUNISTIC", "HIGH_RISK"] as const).map((profile) => {
            const detail = strategyProfileDescriptions[profile];
            return (
              <article key={profile} className={`guide-profile ${profile.toLowerCase()}`}>
                <span>{detail.classification}</span>
                <h3>{detail.title}</h3>
                <p>{detail.summary}</p>
                <strong>Cocok untuk</strong>
                <p>{detail.bestFor}</p>
                <dl>
                  <div><dt>Total risk cap</dt><dd>{profile === "CONSERVATIVE" ? "6%" : profile === "OPPORTUNISTIC" ? "12%" : "20%"}</dd></div>
                  <div><dt>Minimum score</dt><dd>{profile === "CONSERVATIVE" ? "75" : profile === "OPPORTUNISTIC" ? "65" : "60"}</dd></div>
                  <div><dt>Recovery</dt><dd>{profile === "HIGH_RISK" ? "Aktif" : "Nonaktif"}</dd></div>
                  <div><dt>Karakter</dt><dd>{profile === "CONSERVATIVE" ? "Selektif" : profile === "OPPORTUNISTIC" ? "Seimbang" : "Agresif"}</dd></div>
                </dl>
              </article>
            );
          })}
        </div>
        <div className="guide-warning">
          <strong>High Risk bukan berarti tanpa batas.</strong>
          <span>Profil ini tetap dibatasi maksimum 0.10 lot per posisi, exposure pair, total risk cap, spread, signal expiry, dan market regime.</span>
        </div>
      </section>

      <section className="guide-section">
        <div className="summary-section-heading compact">
          <div><span className="panel-title">Market condition</span><h2>Cara strategi menyesuaikan pendekatan</h2></div>
        </div>
        <div className="guide-condition-grid">
          <article><strong>Trending</strong><p>Prioritaskan continuation atau pullback searah EMA. Score minimum biasanya lebih rendah karena struktur lebih jelas.</p></article>
          <article><strong>Sideways</strong><p>Entry diarahkan ke batas support/resistance dengan konfirmasi lebih tinggi dan target lebih pendek.</p></article>
          <article><strong>High Volatility</strong><p>Butuh score lebih tinggi. Ukuran posisi tetap dibatasi karena pergerakan dan stop dapat melebar.</p></article>
          <article><strong>Choppy / News Shock</strong><p>Struktur tidak stabil. Mode strict memblokir entry baru sampai kondisi kembali dapat dibaca.</p></article>
        </div>
      </section>

      <section className="summary-table-card guide-table-card">
        <div className="summary-section-heading compact">
          <div><span className="panel-title">Advanced mode</span><h2>Arti parameter utama</h2></div>
        </div>
        <table className="summary-table">
          <thead><tr><th>Parameter</th><th>Fungsi</th><th>Contoh</th><th>Dampak</th></tr></thead>
          <tbody>
            <tr><td>Minimum score</td><td>Kualitas minimum confluence signal</td><td>75</td><td>Signal score 70 tidak boleh entry</td></tr>
            <tr><td>Risk per trade</td><td>Risiko target satu order terhadap equity</td><td>0.25%</td><td>Lot dihitung agar loss ke SL sesuai batas</td></tr>
            <tr><td>Total risk cap</td><td>Batas akumulasi seluruh exposure ke SL</td><td>12%</td><td>Order baru ditolak jika total proyeksi melewati 12%</td></tr>
            <tr><td>Maximum open positions</td><td>Batas posisi aktif per pair</td><td>XAUUSD 3</td><td>Posisi keempat diblokir</td></tr>
            <tr><td>Hard TP</td><td>Close posisi saat profit nominal tercapai</td><td>XAUUSD $10</td><td>Monitor mencoba close segera saat floating profit minimal $10</td></tr>
            <tr><td>Regime enforcement</td><td>Menentukan apakah kondisi pasar hanya warning atau hard block</td><td>Strict</td><td>Choppy tidak dapat membuka entry jika tidak diizinkan</td></tr>
            <tr><td>Shadow Mode</td><td>Menguji keputusan tanpa mengirim order</td><td>ON</td><td>Signal dan alasan tetap tercatat di audit</td></tr>
            <tr><td>Recovery</td><td>Hedge terbatas saat reversal tervalidasi</td><td>High Risk ON</td><td>Tetap tunduk pada lot cap dan basket loss cap</td></tr>
          </tbody>
        </table>
      </section>

      <section className="guide-section guide-example">
        <span className="panel-title">Contoh keputusan</span>
        <h2>Signal XAUUSD score 72 pada pasar sideways</h2>
        <div>
          <p><strong>Conservative:</strong> tidak entry karena minimum global 75 dan sideways membutuhkan score 82.</p>
          <p><strong>Opportunistic:</strong> dapat dipertimbangkan karena minimum global 65 dan sideways membutuhkan score 72, selama guard lain lolos.</p>
          <p><strong>High Risk:</strong> dapat dipertimbangkan mulai score 68, tetapi tetap ditolak jika exposure, spread, posisi, atau signal expiry bermasalah.</p>
        </div>
      </section>
    </section>
  );
}

function StrategySettingsPage({
  settings,
  autoMode,
  marketRegimes,
  settingsDirty,
  onChange: onSettingsChange,
  onSave,
  onReset
}: {
  settings: StrategyRiskSettings;
  autoMode: AutoModeStatus | null;
  marketRegimes: MarketRegimeAssessment[];
  settingsDirty: boolean;
  onChange: (patch: Partial<StrategyRiskSettings>) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const exposure = autoMode?.exposure;
  const [settingsView, setSettingsView] = React.useState<"simple" | "advanced">("simple");
  const [activeSection, setActiveSection] = React.useState<"general" | "pairs" | "exits" | "recovery">("general");
  const onChange = (patch: Partial<StrategyRiskSettings>) => onSettingsChange({ ...patch, strategyProfile: "CUSTOM" });
  const updatePairProfile = (symbol: SymbolName, patch: Partial<PairProfile>) => {
    onChange({
      pairProfiles: {
        ...settings.pairProfiles,
        [symbol]: { ...settings.pairProfiles[symbol], ...patch }
      }
    });
  };
  if (settingsView === "simple") {
    const selectedProfile = settings.strategyProfile === "CUSTOM" ? null : settings.strategyProfile;
    return (
      <section className="settings-page">
        <div className="settings-page-header">
          <div>
            <span className="panel-title">Simple settings</span>
            <h2>Pilih pendekatan trading</h2>
            <p>Pilih profil, pair aktif, dan mode eksekusi. Detail teknis akan diterapkan otomatis.</p>
          </div>
          <div className="settings-header-status">
            <span className={settings.enabled ? "settings-state on" : "settings-state off"}>AUTO {settings.enabled ? "ON" : "OFF"}</span>
            <span className={settingsDirty ? "settings-state warning" : "settings-state on"}>{settingsDirty ? "UNSAVED" : "SYNCED"}</span>
          </div>
        </div>

        <div className="settings-view-switch" role="group" aria-label="Settings complexity">
          <button className="active" onClick={() => setSettingsView("simple")}>Simple</button>
          <button onClick={() => setSettingsView("advanced")}>Advanced</button>
        </div>

        {settings.strategyProfile === "CUSTOM" && (
          <div className="settings-custom-notice">
            <strong>Konfigurasi Custom</strong>
            <span>Parameter pernah diubah melalui Advanced. Pilih salah satu profil untuk menerapkan preset lengkap.</span>
          </div>
        )}

        <div className="simple-profile-grid">
          {(["CONSERVATIVE", "OPPORTUNISTIC", "HIGH_RISK"] as const).map((profile) => {
            const detail = strategyProfileDescriptions[profile];
            return (
              <button
                key={profile}
                className={selectedProfile === profile ? `simple-profile-card active ${profile.toLowerCase()}` : `simple-profile-card ${profile.toLowerCase()}`}
                onClick={() => onSettingsChange(applyStrategyProfile(settings, profile))}
              >
                <span>{detail.classification}</span>
                <strong>{detail.title}</strong>
                <p>{detail.summary}</p>
                <small>{detail.bestFor}</small>
                <div>
                  <b>Risk cap {profile === "CONSERVATIVE" ? "6%" : profile === "OPPORTUNISTIC" ? "12%" : "20%"}</b>
                  <b>Min score {profile === "CONSERVATIVE" ? "75" : profile === "OPPORTUNISTIC" ? "65" : "60"}</b>
                </div>
              </button>
            );
          })}
        </div>

        <section className="settings-card simple-essential-card">
          <div className="settings-card-heading">
            <div><strong>Kontrol utama</strong><small>Pengaturan yang paling sering digunakan.</small></div>
            <span className="settings-state on">{selectedProfile ? strategyProfileDescriptions[selectedProfile].title : "Custom"}</span>
          </div>
          <div className="settings-switch-list">
            <label className="settings-switch">
              <span><strong>Full Auto</strong><small>Engine memindai dan mengeksekusi entry yang lolos seluruh guard.</small></span>
              <input type="checkbox" checked={settings.enabled} onChange={(event) => onSettingsChange({ enabled: event.target.checked })} />
            </label>
            <label className="settings-switch">
              <span><strong>Shadow Mode</strong><small>Analisis dan log aktif, tetapi order baru tidak dikirim.</small></span>
              <input type="checkbox" checked={settings.shadowMode} onChange={(event) => onSettingsChange({ shadowMode: event.target.checked })} />
            </label>
          </div>
          <div className="settings-field">
            <span>Pair yang boleh trading</span>
            <div className="pair-toggle-grid">
              {symbols.map((symbol) => (
                <label key={symbol} className={settings.activeSymbols.includes(symbol) ? "pair-toggle active" : "pair-toggle"}>
                  <input
                    type="checkbox"
                    checked={settings.activeSymbols.includes(symbol)}
                    onChange={(event) => onSettingsChange({
                      activeSymbols: event.target.checked
                        ? Array.from(new Set([...settings.activeSymbols, symbol]))
                        : settings.activeSymbols.filter((item) => item !== symbol)
                    })}
                  />
                  <span>{symbol}</span>
                  <small>{settings.activeSymbols.includes(symbol) ? "Trading aktif" : "Tidak membuka entry"}</small>
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <div><strong>Kondisi pasar saat ini</strong><small>Profil tetap tunduk pada market regime dan exposure guard.</small></div>
          </div>
          <div className="market-regime-grid simple-regime-grid">
            {marketRegimes.filter((item) => item.timeframe === "H1").map((item) => <MarketRegimeCard key={`${item.symbol}-${item.timeframe}`} item={item} />)}
          </div>
          <div className="settings-risk-preview">
            <Metric label="Total risk cap" value={formatPercent(positiveNumber(settings.maxTotalRiskPercent, 20))} />
            <Metric label="Minimum score" value={settings.minScore} />
            <Metric label="Maximum positions" value={settings.maxTotalOpenPositionsAllPairs} />
          </div>
        </section>

        <div className="settings-actions settings-actions-sticky">
          <div><strong>{settingsDirty ? "Perubahan belum disimpan" : "Settings tersinkronisasi"}</strong><small>Preset baru aktif setelah Save settings.</small></div>
          <div>
            <button className="settings-secondary" onClick={onReset} disabled={!settingsDirty}>Batalkan</button>
            <button className="summary-refresh" onClick={onSave} disabled={!settingsDirty}>Simpan settings</button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="settings-page">
      <div className="settings-page-header">
        <div>
          <span className="panel-title">Strategy & risk settings</span>
          <h2>Trading configuration</h2>
          <p>Atur parameter global, profil pair, exit, dan recovery tanpa mengubah data runtime MT5.</p>
        </div>
        <div className="settings-header-status">
          <span className={settings.enabled ? "settings-state on" : "settings-state off"}>AUTO {settings.enabled ? "ON" : "OFF"}</span>
          <span className={settings.shadowMode ? "settings-state warning" : "settings-state on"}>{settings.shadowMode ? "SHADOW" : "LIVE EXECUTION"}</span>
          <span className={settingsDirty ? "settings-state warning" : "settings-state on"}>{settingsDirty ? "UNSAVED" : "SYNCED"}</span>
        </div>
      </div>

      <div className="settings-view-switch" role="group" aria-label="Settings complexity">
        <button onClick={() => setSettingsView("simple")}>Simple</button>
        <button className="active" onClick={() => setSettingsView("advanced")}>Advanced</button>
      </div>

      <nav className="settings-section-nav" aria-label="Settings categories">
        <button className={activeSection === "general" ? "active" : ""} onClick={() => setActiveSection("general")}>
          <strong>General</strong>
          <small>Automation, account, global risk</small>
        </button>
        <button className={activeSection === "pairs" ? "active" : ""} onClick={() => setActiveSection("pairs")}>
          <strong>Pair Profiles</strong>
          <small>XAUUSD and EURUSD limits</small>
        </button>
        <button className={activeSection === "exits" ? "active" : ""} onClick={() => setActiveSection("exits")}>
          <strong>Exit & Trailing</strong>
          <small>Hard TP and execution rules</small>
        </button>
        <button className={activeSection === "recovery" ? "active" : ""} onClick={() => setActiveSection("recovery")}>
          <strong>Recovery</strong>
          <small>Hedge, layers, basket exit</small>
        </button>
      </nav>

      <div className="settings-context-bar">
        <div>
          <span>Active pairs</span>
          <strong>{formatActiveSymbols(settings.activeSymbols)}</strong>
        </div>
        <div>
          <span>Risk used</span>
          <strong>{formatPercent(exposure?.totalRiskPercent)} / {formatPercent(positiveNumber(settings.maxTotalRiskPercent, 20))}</strong>
        </div>
        <div>
          <span>Account</span>
          <strong>{settings.accountMode}</strong>
        </div>
        <div>
          <span>Minimum score</span>
          <strong>{settings.minScore}</strong>
        </div>
      </div>

      {activeSection === "general" && (
      <div className="settings-layout settings-layout-general">
        <section className="settings-card settings-card-primary">
          <div className="settings-card-heading">
            <div>
              <strong>Automation</strong>
              <small>Kontrol scan dan izin eksekusi strategi.</small>
            </div>
            <span className={settings.enabled ? "settings-state on" : "settings-state off"}>{settings.enabled ? "ON" : "OFF"}</span>
          </div>
          <div className="settings-switch-list">
            <label className="settings-switch">
              <span><strong>Full Auto</strong><small>Jalankan scan strategy otomatis.</small></span>
              <input type="checkbox" checked={settings.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
            </label>
            <label className="settings-switch">
              <span><strong>Shadow Mode</strong><small>Validasi dan log tanpa mengirim order.</small></span>
              <input type="checkbox" checked={settings.shadowMode} onChange={(event) => onChange({ shadowMode: event.target.checked })} />
            </label>
          </div>
          <div className="settings-form-grid">
            <SettingsNumber label="Minimum confluence score" value={settings.minScore} min={0} max={100} step={1} suffix="score" onChange={(value) => onChange({ minScore: value })} />
            <SettingsNumber label="Scan interval" value={settings.scanIntervalSeconds} min={5} max={300} step={1} suffix="seconds" onChange={(value) => onChange({ scanIntervalSeconds: value })} />
            <SettingsNumber label="Duplicate cooldown" value={settings.duplicateCooldownMinutes} min={0} max={1440} step={1} suffix="minutes" onChange={(value) => onChange({ duplicateCooldownMinutes: value })} />
          </div>
          <div className="settings-field">
            <span>Active trade pairs</span>
            <div className="pair-toggle-grid">
              {symbols.map((symbol) => (
                <label key={symbol} className={settings.activeSymbols.includes(symbol) ? "pair-toggle active" : "pair-toggle"}>
                  <input
                    type="checkbox"
                    checked={settings.activeSymbols.includes(symbol)}
                    onChange={(event) => {
                      const nextSymbols = event.target.checked
                        ? Array.from(new Set([...settings.activeSymbols, symbol]))
                        : settings.activeSymbols.filter((item) => item !== symbol);
                      onChange({ activeSymbols: nextSymbols });
                    }}
                  />
                  <span>{symbol}</span>
                  <small>{settings.activeSymbols.includes(symbol) ? "Auto-entry active" : "Data only"}</small>
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <div><strong>Account Type</strong><small>Normalisasi seluruh nilai uang.</small></div>
            <span className="settings-state on">{settings.accountMode}</span>
          </div>
          <div className="account-mode-grid">
            <label className={settings.accountMode === "USD" ? "account-mode-option active" : "account-mode-option"}>
              <input type="radio" name="account-mode" checked={settings.accountMode === "USD"} onChange={() => onChange({ accountMode: "USD" })} />
              <strong>Standard USD</strong>
              <small>1 unit = 1 USD</small>
            </label>
            <label className={settings.accountMode === "USC" ? "account-mode-option active" : "account-mode-option"}>
              <input type="radio" name="account-mode" checked={settings.accountMode === "USC"} onChange={() => onChange({ accountMode: "USC" })} />
              <strong>USC Cent</strong>
              <small>100 USC = 1 USD</small>
            </label>
          </div>
          <p className="settings-help">Mengubah kalkulasi equity, P/L, Hard TP, hedge, basket target, dan minimum balance.</p>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <div><strong>Global Risk</strong><small>Batas risiko sebelum pair guard.</small></div>
            <span>{formatPercent(exposure?.totalRiskPercent)} used</span>
          </div>
          <label className="settings-field">
            <span>Risk mode</span>
            <select value={settings.riskMode} onChange={(event) => onChange({ riskMode: event.target.value as RiskMode })}>
              <option value="percent_equity">Percent equity</option>
              <option value="fixed_lot">Fixed lot</option>
              <option value="fixed_usd">Fixed USD</option>
            </select>
          </label>
          <div className="settings-form-grid">
            <SettingsNumber label="Risk value per order" value={settings.riskValue} min={0.01} step={0.01} suffix={riskModeSuffix(settings.riskMode)} onChange={(value) => onChange({ riskValue: value })} />
            <SettingsNumber label="Total risk cap" value={settings.maxTotalRiskPercent} min={0.1} max={100} step={0.1} suffix="%" onChange={(value) => onChange({ maxTotalRiskPercent: value })} />
            <SettingsNumber label="All-pair position cap" value={settings.maxTotalOpenPositionsAllPairs} min={1} max={50} step={1} suffix="positions" onChange={(value) => onChange({ maxTotalOpenPositionsAllPairs: value })} />
          </div>
          <div className="settings-risk-preview">
            <Metric label="Projected risk" value={formatPercent(exposure?.totalRiskPercent)} />
            <Metric label="Available" value={formatPercent(exposure?.availableRiskPercent)} />
            <Metric label="Risk USD" value={formatMoney(exposure?.totalRiskUsd ?? 0)} />
          </div>
        </section>

        <MinimumBalanceCard estimate={autoMode?.minimumBalance ?? null} accountMode={settings.accountMode} />
      </div>
      )}

      {activeSection === "pairs" && (
        <div className="settings-pair-layout">
          {symbols.map((symbol) => (
            <PairProfileCard
              key={symbol}
              symbol={symbol}
              profile={settings.pairProfiles[symbol]}
              exposure={autoMode?.pairExposure?.find((item) => item.symbol === symbol) ?? null}
              regimes={marketRegimes.filter((item) => item.symbol === symbol)}
              onChange={(patch) => updatePairProfile(symbol, patch)}
            />
          ))}
        </div>
      )}

      {activeSection === "exits" && (
      <div className="settings-layout settings-layout-exits">
        <section className="settings-card">
          <div className="settings-card-heading">
            <div><strong>Hard Take Profit</strong><small>Target close otomatis per posisi.</small></div>
            <span>USD equivalent</span>
          </div>
          <SettingsNumber
            label="XAUUSD Hard TP"
            value={settings.xauusdHardTpUsd}
            min={0.01}
            step={0.01}
            suffix="USD"
            onChange={(value) => onChange({ xauusdHardTpUsd: value })}
          />
          <SettingsNumber
            label="EURUSD Hard TP"
            value={settings.eurusdHardTpUsd}
            min={0.01}
            step={0.01}
            suffix="USD"
            onChange={(value) => onChange({ eurusdHardTpUsd: value })}
          />
          <div className="settings-risk-preview">
            <Metric label="XAUUSD close at" value={formatMoney(positiveNumber(settings.xauusdHardTpUsd, 10))} />
            <Metric label="EURUSD close at" value={formatMoney(positiveNumber(settings.eurusdHardTpUsd, 10))} />
          </div>
        </section>

        <section className="settings-card settings-guide">
          <div className="settings-card-heading">
            <div><strong>Execution Rules</strong><small>Aturan tetap yang digunakan engine.</small></div>
            <span>{settingsDirty ? "Unsaved" : "Synced"}</span>
          </div>
          <div className="settings-rule-list">
            <span><strong>M15, M30, H1</strong> execution timeframe</span>
            <span><strong>H4, D1</strong> monitor/context only</span>
            <span><strong>0.10 lot</strong> maximum per position</span>
            <span><strong>{settings.accountMode}</strong> account normalization</span>
            <span><strong>{formatActiveSymbols(settings.activeSymbols)}</strong> active auto-entry pairs</span>
          </div>
        </section>

        <section className="settings-card settings-exit-summary">
          <div className="settings-card-heading">
            <div><strong>Exit Summary</strong><small>Nilai efektif setelah Save.</small></div>
          </div>
          <div className="settings-risk-preview">
            <Metric label="XAUUSD Hard TP" value={formatMoney(positiveNumber(settings.xauusdHardTpUsd, 10))} />
            <Metric label="EURUSD Hard TP" value={formatMoney(positiveNumber(settings.eurusdHardTpUsd, 10))} />
            <Metric label="Trailing monitor" value="1 second" />
          </div>
          <p className="settings-help">EURUSD trailing pip diatur pada Pair Profiles. XAUUSD tetap memakai trailing khusus gold.</p>
        </section>
      </div>
      )}

      {activeSection === "recovery" && (
      <div className="settings-layout settings-layout-recovery">
        <section className="settings-card">
          <div className="settings-card-heading">
            <div><strong>Hedge Recovery</strong><small>Aktifkan hanya setelah exposure diperiksa.</small></div>
            <span className={settings.recoveryEnabled ? "settings-state on" : "settings-state off"}>{settings.recoveryEnabled ? "ON" : "OFF"}</span>
          </div>
          <label className="settings-switch">
            <span><strong>Bounded hedge recovery</strong><small>Tetap tunduk pada pair exposure dan Shadow Mode.</small></span>
            <input type="checkbox" checked={settings.recoveryEnabled} onChange={(event) => onChange({ recoveryEnabled: event.target.checked })} />
          </label>
          <SettingsNumber label="Reversal hedge trigger" value={settings.reversalHedgeScore} min={50} max={100} step={1} suffix="score" onChange={(value) => onChange({ reversalHedgeScore: value })} />
          <SettingsNumber label="Recovery resume maximum" value={settings.recoveryResumeScore} min={0} max={74} step={1} suffix="score" onChange={(value) => onChange({ recoveryResumeScore: value })} />
          <SettingsNumber label="Partial hedge ratio" value={settings.hedgeRatioPercent} min={10} max={70} step={1} suffix="%" onChange={(value) => onChange({ hedgeRatioPercent: value })} />
          <SettingsNumber label="Shock candle threshold" value={settings.shockAtrMultiplier} min={1} max={5} step={0.1} suffix="ATR" onChange={(value) => onChange({ shockAtrMultiplier: value })} />
          <SettingsNumber label="Action cooldown" value={settings.recoveryCooldownSeconds} min={15} max={3600} step={1} suffix="seconds" onChange={(value) => onChange({ recoveryCooldownSeconds: value })} />
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <div><strong>Recovery Entry</strong><small>Ukuran hedge dan recovery layer.</small></div>
            <span>Bounded sizing</span>
          </div>
          <SettingsNumber label="XAUUSD hedge profit target" value={settings.xauusdHedgeProfitUsd} min={0.01} step={0.01} suffix="USD" onChange={(value) => onChange({ xauusdHedgeProfitUsd: value })} />
          <SettingsNumber label="EURUSD hedge profit target" value={settings.eurusdHedgeProfitUsd} min={0.01} step={0.01} suffix="USD" onChange={(value) => onChange({ eurusdHedgeProfitUsd: value })} />
          <SettingsNumber label="Recovery lot multiplier" value={settings.recoveryMultiplier} min={1} max={1.5} step={0.05} suffix="x" onChange={(value) => onChange({ recoveryMultiplier: value })} />
          <SettingsNumber label="Maximum recovery layers" value={settings.maxRecoveryLayers} min={0} max={2} step={1} suffix="layers" onChange={(value) => onChange({ maxRecoveryLayers: value })} />
          <div className="settings-risk-preview">
            <Metric label="Lot cap" value="0.10" />
            <Metric label="Hedge size" value={`${clampNumber(settings.hedgeRatioPercent, 10, 70, 50).toFixed(0)}%`} />
            <Metric label="Layers" value={`${Math.round(clampNumber(settings.maxRecoveryLayers, 0, 2, 2))}`} />
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <div><strong>Basket Exit</strong><small>Target dan emergency cap per siklus.</small></div>
            <span>USD equivalent</span>
          </div>
          <SettingsNumber label="XAUUSD basket target" value={settings.xauusdBasketTargetUsd} min={0.01} step={0.01} suffix="USD" onChange={(value) => onChange({ xauusdBasketTargetUsd: value })} />
          <SettingsNumber label="EURUSD basket target" value={settings.eurusdBasketTargetUsd} min={0.01} step={0.01} suffix="USD" onChange={(value) => onChange({ eurusdBasketTargetUsd: value })} />
          <SettingsNumber label="XAUUSD emergency loss cap" value={settings.xauusdBasketMaxLossUsd} min={0.01} step={0.01} suffix="USD" onChange={(value) => onChange({ xauusdBasketMaxLossUsd: value })} />
          <SettingsNumber label="EURUSD emergency loss cap" value={settings.eurusdBasketMaxLossUsd} min={0.01} step={0.01} suffix="USD" onChange={(value) => onChange({ eurusdBasketMaxLossUsd: value })} />
        </section>

        <section className="settings-card settings-guide settings-recovery-summary">
          <div className="settings-card-heading">
            <div><strong>Recovery Summary</strong><small>Konfigurasi efektif saat ini.</small></div>
            <span>{settingsDirty ? "Unsaved" : "Synced"}</span>
          </div>
          <div className="settings-rule-list">
            <span><strong>{settings.recoveryEnabled ? "ON" : "OFF"}</strong> global recovery</span>
            <span><strong>{clampNumber(settings.hedgeRatioPercent, 10, 70, 50).toFixed(0)}%</strong> hedge ratio</span>
            <span><strong>{Math.round(clampNumber(settings.maxRecoveryLayers, 0, 2, 2))}</strong> maximum layers</span>
            <span><strong>{clampNumber(settings.recoveryMultiplier, 1, 1.5, 1.35).toFixed(2)}x</strong> lot multiplier</span>
            <span><strong>EURUSD OFF</strong> by strict pair profile default</span>
          </div>
        </section>
      </div>
      )}

      <div className="settings-actions settings-actions-sticky">
        <div>
          <strong>{settingsDirty ? "Unsaved changes" : "Settings synchronized"}</strong>
          <small>{settingsDirty ? "Review lalu simpan agar parameter aktif di backend." : "Nilai form sama dengan konfigurasi backend."}</small>
        </div>
        <div>
          <button className="settings-secondary" onClick={onReset} disabled={!settingsDirty}>Discard changes</button>
          <button className="summary-refresh" onClick={onSave} disabled={!settingsDirty}>Save settings</button>
        </div>
      </div>
    </section>
  );
}

function PairProfileCard({
  symbol,
  profile,
  exposure,
  regimes,
  onChange
}: {
  symbol: SymbolName;
  profile: PairProfile;
  exposure: PairExposureStatus | null;
  regimes: MarketRegimeAssessment[];
  onChange: (patch: Partial<PairProfile>) => void;
}) {
  const allowedMarketRegimes = profile.allowedMarketRegimes ?? [];
  return (
    <section className="settings-card pair-profile-card">
      <div className="pair-profile-heading">
        <div>
          <span className="panel-title">Pair profile</span>
          <h3>{symbol}</h3>
          <small>{symbol === "EURUSD" ? "Strict fail-closed execution profile" : "Flexible gold profile with aggregate exposure guard"}</small>
        </div>
        <div className="pair-profile-status">
          <span className={`exposure-state ${exposure?.status?.toLowerCase() ?? "blocked"}`}>{exposure?.status ?? "NO DATA"}</span>
          <small>{exposure?.tradeMode ?? "UNKNOWN"}</small>
        </div>
      </div>

      <div className="pair-exposure-strip">
        <Metric label="Open" value={`${exposure?.openPositions ?? 0} / ${profile.maxOpenPositions}`} />
        <Metric label="Total lot" value={`${(exposure?.totalLot ?? 0).toFixed(2)} / ${profile.maxTotalLot.toFixed(2)}`} />
        <Metric label="SL exposure" value={`${(exposure?.aggregateSlRiskPercent ?? 0).toFixed(2)}% / ${profile.aggregateSlRiskCapPercent}%`} />
        <Metric label="Floating P/L" value={formatMoney(exposure?.floatingPnlAccount ?? 0)} />
      </div>

      <div className="pair-profile-section">
        <div className="pair-profile-section-heading"><strong>Market condition policy</strong><small>Sesuaikan entry dengan regime yang terdeteksi.</small></div>
        <div className="market-regime-live-strip">
          {regimes.filter((item) => profile.executionTimeframes.includes(item.timeframe)).map((item) => (
            <div key={`${symbol}-${item.timeframe}`} className={marketRegimeTone(item.regime)}>
              <span>{item.timeframe}</span>
              <strong>{item.regime.replace(/_/g, " ")}</strong>
              <small>{item.confidence}% confidence</small>
            </div>
          ))}
        </div>
        <div className="settings-form-grid">
          <label className="settings-field">
            <span>Regime enforcement</span>
            <select value={profile.marketRegimeMode} onChange={(event) => onChange({ marketRegimeMode: event.target.value as PairProfile["marketRegimeMode"] })}>
              <option value="advisory">Advisory only</option>
              <option value="strict">Strict block</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <CompactNumber label="Trending minimum score" value={profile.trendingMinScore} min={0} max={100} step={1} suffix="score" onChange={(value) => onChange({ trendingMinScore: value })} />
          <CompactNumber label="Sideways minimum score" value={profile.sidewaysMinScore} min={0} max={100} step={1} suffix="score" onChange={(value) => onChange({ sidewaysMinScore: value })} />
          <CompactNumber label="Volatile minimum score" value={profile.volatileMinScore} min={0} max={100} step={1} suffix="score" onChange={(value) => onChange({ volatileMinScore: value })} />
        </div>
        <div className="market-regime-options">
          {configurableMarketRegimes.map((regime) => {
            const active = allowedMarketRegimes.includes(regime);
            return (
              <label key={regime} className={active ? "active" : ""}>
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(event) => onChange({
                    allowedMarketRegimes: event.target.checked
                      ? Array.from(new Set([...allowedMarketRegimes, regime]))
                      : allowedMarketRegimes.filter((item) => item !== regime)
                  })}
                />
                <span>{regime.replace(/_/g, " ")}</span>
              </label>
            );
          })}
        </div>
        <p className="settings-help">Strict memblokir regime yang tidak dipilih dan menerapkan minimum score sesuai kondisi. Advisory hanya mencatat warning.</p>
      </div>

      <div className="pair-profile-section">
        <div className="pair-profile-section-heading"><strong>Permissions & market gates</strong><small>Kontrol biner dan sumber konfirmasi.</small></div>
        <div className="settings-toggle-row">
          <label className="settings-switch compact"><span><strong>Pair enabled</strong></span><input type="checkbox" checked={profile.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} /></label>
          <label className="settings-switch compact danger"><span><strong>Close-only</strong></span><input type="checkbox" checked={profile.closeOnly} onChange={(event) => onChange({ closeOnly: event.target.checked })} /></label>
          <label className="settings-switch compact"><span><strong>Recovery</strong></span><input type="checkbox" checked={profile.recoveryEnabled} onChange={(event) => onChange({ recoveryEnabled: event.target.checked })} /></label>
          <label className="settings-switch compact"><span><strong>Pivot required</strong></span><input type="checkbox" checked={profile.pivotRequired} onChange={(event) => onChange({ pivotRequired: event.target.checked })} /></label>
          <label className="settings-switch compact"><span><strong>News filter</strong></span><input type="checkbox" checked={profile.newsFilterEnabled} onChange={(event) => onChange({ newsFilterEnabled: event.target.checked })} /></label>
        </div>
        <div className="settings-form-grid two">
          <label className="settings-field"><span>Investing mode</span><select value={profile.investingMode} onChange={(event) => onChange({ investingMode: event.target.value as PairProfile["investingMode"] })}><option value="advisory">Advisory</option><option value="required">Required</option><option value="disabled">Disabled</option></select></label>
          <label className="settings-field"><span>Market Fact Gate</span><select value={profile.marketFactGate} onChange={(event) => onChange({ marketFactGate: event.target.value as PairProfile["marketFactGate"] })}><option value="advisory">Advisory</option><option value="strict">Strict</option><option value="disabled">Disabled</option></select></label>
        </div>
      </div>

      <div className="pair-profile-section">
        <div className="pair-profile-section-heading"><strong>Risk & exposure limits</strong><small>Order sizing dan batas akumulasi pair.</small></div>
        <div className="pair-profile-grid">
          <CompactNumber label="Risk per trade" value={profile.riskPercent} min={0.01} max={0.5} step={0.01} suffix="%" onChange={(value) => onChange({ riskPercent: value })} />
          <CompactNumber label="Maximum lot" value={profile.maxLot} min={0.01} max={0.1} step={0.01} suffix="lot" onChange={(value) => onChange({ maxLot: value })} />
          <CompactNumber label="Minimum RR" value={profile.minRiskReward} min={1} max={5} step={0.1} suffix="R" onChange={(value) => onChange({ minRiskReward: value })} />
          <CompactNumber label="Maximum spread" value={profile.maxSpread} min={1} max={1000} step={1} suffix="pts" onChange={(value) => onChange({ maxSpread: value })} />
          <CompactNumber label="Open positions" value={profile.maxOpenPositions} min={1} max={20} step={1} suffix="max" onChange={(value) => onChange({ maxOpenPositions: value })} />
          <CompactNumber label="Pending orders" value={profile.maxPendingOrders} min={0} max={20} step={1} suffix="max" onChange={(value) => onChange({ maxPendingOrders: value })} />
          <CompactNumber label="Maximum total lot" value={profile.maxTotalLot} min={0.01} max={2} step={0.01} suffix="lot" onChange={(value) => onChange({ maxTotalLot: value })} />
          <CompactNumber label="Aggregate SL cap" value={profile.aggregateSlRiskCapPercent} min={1} max={30} step={0.5} suffix="%" onChange={(value) => onChange({ aggregateSlRiskCapPercent: value })} />
        </div>
      </div>

      <div className="pair-profile-section">
        <div className="pair-profile-section-heading"><strong>Frequency & lock controls</strong><small>Mencegah overtrade dan loss streak.</small></div>
        <div className="pair-profile-grid">
          <CompactNumber label="Daily trades" value={profile.maxDailyTrades} min={0} max={100} step={1} suffix="max" onChange={(value) => onChange({ maxDailyTrades: value })} />
          <CompactNumber label="Hourly trades" value={profile.maxHourlyTrades} min={0} max={20} step={1} suffix="max" onChange={(value) => onChange({ maxHourlyTrades: value })} />
          <CompactNumber label="SL cooldown" value={profile.cooldownAfterSlMinutes} min={0} max={1440} step={1} suffix="min" onChange={(value) => onChange({ cooldownAfterSlMinutes: value })} />
          <CompactNumber label="Loss-streak lock" value={profile.lockAfterConsecutiveSl} min={0} max={10} step={1} suffix="SL" onChange={(value) => onChange({ lockAfterConsecutiveSl: value })} />
        </div>
      </div>

      {symbol === "EURUSD" && (
        <div className="pair-profile-section">
          <div className="pair-profile-section-heading"><strong>EURUSD trailing & daily guard</strong><small>Pip-based protection khusus EURUSD.</small></div>
          <div className="pair-profile-grid">
            <CompactNumber label="Break-even trigger" value={profile.trailingBreakEvenTriggerPips} min={0} max={100} step={1} suffix="pips" onChange={(value) => onChange({ trailingBreakEvenTriggerPips: value })} />
            <CompactNumber label="Break-even lock" value={profile.trailingBreakEvenLockPips} min={0} max={100} step={1} suffix="pips" onChange={(value) => onChange({ trailingBreakEvenLockPips: value })} />
            <CompactNumber label="Trailing trigger" value={profile.trailingTriggerPips} min={0} max={100} step={1} suffix="pips" onChange={(value) => onChange({ trailingTriggerPips: value })} />
            <CompactNumber label="Trailing distance" value={profile.trailingDistancePips} min={1} max={100} step={1} suffix="pips" onChange={(value) => onChange({ trailingDistancePips: value })} />
            <CompactNumber label="Trailing step" value={profile.trailingStepPips} min={1} max={100} step={1} suffix="pips" onChange={(value) => onChange({ trailingStepPips: value })} />
            <CompactNumber label="Daily loss limit" value={profile.dailyLossLimitPercent} min={0} max={20} step={0.1} suffix="%" onChange={(value) => onChange({ dailyLossLimitPercent: value })} />
          </div>
        </div>
      )}

      {(exposure?.reasons ?? []).length > 0 && (
        <div className="pair-exposure-alert">
          <strong>Current blockers</strong>
          {(exposure?.reasons ?? []).slice(0, 4).map((reason) => <span key={reason}>{reason}</span>)}
        </div>
      )}
    </section>
  );
}

function CompactNumber({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="compact-number"><span>{label}</span><div><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(clampNumber(event.target.value, min, max, value))} /><small>{suffix}</small></div></label>;
}

function MinimumBalanceCard({ estimate, accountMode }: { estimate: MinimumBalanceEstimate | null; accountMode: AccountMode }) {
  return (
    <section className="settings-card minimum-balance-card">
      <div className="settings-card-heading">
        <strong>Minimum Balance</strong>
        <span className={estimate?.sufficient ? "settings-state on" : "settings-state off"}>{estimate?.sufficient ? "SUFFICIENT" : "BELOW"}</span>
      </div>
      <div className="minimum-balance-hero">
        <span>Recommended with {formatPercent(estimate?.reservePercent ?? 25)} reserve</span>
        <strong>{formatModeAmount(estimate?.recommendedAccountUnits ?? 0, accountMode)}</strong>
        <small>Technical minimum {formatModeAmount(estimate?.minimumAccountUnits ?? 0, accountMode)}</small>
      </div>
      <div className="settings-risk-preview">
        <Metric label="Current equity" value={formatMoney(estimate?.currentEquityUsd ?? 0)} />
        <Metric label="Recommended USD" value={formatMoney(estimate?.recommendedUsd ?? 0)} />
        <Metric label="Min lot" value={(estimate?.minLot ?? 0.01).toFixed(2)} />
      </div>
      <div className="minimum-pair-list">
        {(estimate?.pairs ?? []).map((pair) => (
          <div key={pair.symbol}>
            <strong>{pair.symbol}</strong>
            <span>{formatMoney(pair.requiredEquityUsd)} minimum</span>
            <small>{formatMoney(pair.riskAtMinLotUsd)} risk at 0.01 lot · {pair.sourceTimeframe ?? "fallback"}</small>
          </div>
        ))}
      </div>
      <small>{estimate?.message ?? "Calculating current strategy stop distances..."}</small>
    </section>
  );
}

function SettingsNumber({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: {
  label: string;
  value: string;
  min: number;
  max?: number;
  step: number;
  suffix: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <div className="settings-input-row">
        <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} />
        <small>{suffix}</small>
      </div>
    </label>
  );
}

function ConfluenceCard({ score, symbol, timeframe }: { score: ConfluenceScoreCard | undefined; symbol: SymbolName; timeframe: Timeframe }) {
  const value = score?.score ?? null;
  const tone = value === null ? "loading" : value >= 60 ? "ready" : value >= 45 ? "watch" : "blocked";
  const actionLabel = score?.side ?? "NO TRADE";
  const reason = score?.blockedReasons.find((item) => item !== SCORE_BLOCK_REASON) ?? score?.setupType ?? "Loading";
  return (
    <article className={`confluence-card ${tone}`}>
      <div className="confluence-card-top">
        <span>{timeframe}</span>
        <small>{timeframe === "H4" || timeframe === "D1" ? "Monitor" : "Exec"}</small>
      </div>
      <strong>{value === null ? "--" : value}</strong>
      <div className="confluence-action">
        <span>{actionLabel}</span>
        <small>{symbol}</small>
      </div>
      <p>{reason}</p>
    </article>
  );
}

function buildSummary(status: Status | null, positions: OpenPosition[], journal: TradingJournalEntry[]) {
  const floatingPnl = positions.reduce((sum, position) => sum + position.profit, 0);
  const closedPnl = journal.reduce((sum, entry) => sum + (entry.profit ?? 0), 0);
  const todayKey = localDateKey(new Date());
  const dailyClosedPnl = journal
    .filter((entry) => localDateKey(new Date(entry.time)) === todayKey)
    .reduce((sum, entry) => sum + (entry.profit ?? 0), 0);
  const grossProfit = journal.reduce((sum, entry) => sum + Math.max(entry.profit ?? 0, 0), 0);
  const grossLoss = Math.abs(journal.reduce((sum, entry) => sum + Math.min(entry.profit ?? 0, 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  return {
    totalPnl: closedPnl,
    dailyPnl: dailyClosedPnl,
    floatingPnl,
    grossProfit,
    grossLoss,
    profitFactorLabel: Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞",
    winningOpenCount: positions.filter((position) => position.profit > 0).length,
    losingOpenCount: positions.filter((position) => position.profit < 0).length,
    accountCurrency: status?.currency ?? "USD"
  };
}

function buildPairRows(journal: TradingJournalEntry[]) {
  return symbols.map((symbol) => {
    const entries = journal.filter((entry) => entry.symbol === symbol);
    const wins = entries.filter((entry) => (entry.profit ?? 0) > 0);
    const losses = entries.filter((entry) => (entry.profit ?? 0) < 0);
    const winUsd = wins.reduce((sum, entry) => sum + (entry.profit ?? 0), 0);
    const lossUsd = losses.reduce((sum, entry) => sum + (entry.profit ?? 0), 0);
    return {
      symbol,
      wins: wins.length,
      losses: losses.length,
      winUsd,
      lossUsd,
      netUsd: winUsd + lossUsd
    };
  });
}

function LegacyApp() {
  const [symbol, setSymbol] = React.useState<SymbolName>("XAUUSD");
  const [timeframe, setTimeframe] = React.useState<Timeframe>("H1");
  const [riskMode, setRiskMode] = React.useState<RiskMode>("percent_equity");
  const [riskValue, setRiskValue] = React.useState("0.5");
  const [status, setStatus] = React.useState<Status | null>(null);
  const [backendHealth, setBackendHealth] = React.useState<BackendHealth | null>(null);
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [watchSnapshots, setWatchSnapshots] = React.useState<Partial<Record<SymbolName, Snapshot>>>({});
  const [ticks, setTicks] = React.useState<Partial<Record<SymbolName, MarketTick>>>({});
  const [indicators, setIndicators] = React.useState(defaultIndicators);
  const [priceContextFullscreen, setPriceContextFullscreen] = React.useState(false);
  const [signal, setSignal] = React.useState<Signal | null>(null);
  const [history, setHistory] = React.useState<HistoryItem[]>([]);
  const [positions, setPositions] = React.useState<OpenPosition[]>([]);
  const [positionAlerts, setPositionAlerts] = React.useState<PositionSetupAlert[]>([]);
  const [journal, setJournal] = React.useState<TradingJournalEntry[]>([]);
  const [trailingRules, setTrailingRules] = React.useState<TrailingRules>({ triggerPips: "5", distancePips: "3", stepPips: "1" });
  const [calendar, setCalendar] = React.useState<EconomicCalendarResponse | null>(null);
  const [signalLog, setSignalLog] = React.useState<SignalLogEntry[]>([]);
  const [autoMode, setAutoMode] = React.useState<AutoModeStatus | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const tickRequestId = React.useRef(0);

  const refreshBackendHealth = React.useCallback(async () => {
    try {
      setBackendHealth(await fetchJson<BackendHealth>(`${API_BASE}/api/backend/health`, { cache: "no-store" }));
    } catch {
      setBackendHealth(null);
    }
  }, []);

  const refreshTicks = React.useCallback(async () => {
    const requestId = ++tickRequestId.current;
    const nextTicks = await fetchJson<Partial<Record<SymbolName, MarketTick>>>(`${API_BASE}/api/market/ticks`, { cache: "no-store" });
    if (requestId === tickRequestId.current) {
      setTicks(nextTicks);
    }
  }, []);

  const refresh = React.useCallback(async () => {
    const query = `symbol=${symbol}&timeframe=${timeframe}`;
    const safeRiskValue = sanitizeRiskValue(riskValue);
    const [nextStatus, nextSignal, nextHistory, nextPositions, nextPositionAlerts, nextJournal, nextCalendar, nextSignalLog, nextAutoMode, activeSnapshot, watchResults] = await Promise.all([
      fetchJson<Status>(`${API_BASE}/api/status`),
      fetchJson<Signal>(`${API_BASE}/api/signals?${query}&riskMode=${riskMode}&riskValue=${safeRiskValue}`),
      fetchJson<HistoryItem[]>(`${API_BASE}/api/history`),
      fetchJson<OpenPosition[]>(`${API_BASE}/api/positions`, { cache: "no-store" }),
      fetchJson<PositionSetupAlert[]>(`${API_BASE}/api/positions/alerts`, { cache: "no-store" }),
      fetchJson<TradingJournalEntry[]>(`${API_BASE}/api/journal`, { cache: "no-store" }),
      fetchJson<EconomicCalendarResponse>(`${API_BASE}/api/economic-calendar`, { cache: "no-store" }),
      fetchJson<SignalLogEntry[]>(`${API_BASE}/api/signal-log?limit=80`, { cache: "no-store" }),
      fetchJson<AutoModeStatus>(`${API_BASE}/api/auto-mode/status`, { cache: "no-store" }),
      fetchJson<Snapshot>(`${API_BASE}/api/market/snapshot?${query}`, { cache: "no-store" }),
      Promise.all(
        symbols.map(async (item) => {
          return [item, await fetchJson<Snapshot>(`${API_BASE}/api/market/snapshot?symbol=${item}&timeframe=${timeframe}`, { cache: "no-store" })] as const;
        })
      )
    ]);
    const nextWatchSnapshots = Object.fromEntries(watchResults) as Partial<Record<SymbolName, Snapshot>>;
    setStatus(nextStatus);
    setWatchSnapshots(nextWatchSnapshots);
    setSnapshot(activeSnapshot);
    setSignal(nextSignal);
    setHistory(nextHistory);
    setPositions(nextPositions);
    setPositionAlerts(nextPositionAlerts);
    setJournal(nextJournal);
    setCalendar(nextCalendar);
    setSignalLog(nextSignalLog);
    setAutoMode(nextAutoMode);
    await refreshTicks();
  }, [refreshTicks, riskMode, riskValue, symbol, timeframe]);

  const scanPotentialSignals = React.useCallback(async () => {
    const safeRiskValue = sanitizeRiskValue(riskValue);
    await fetchJson<Signal[]>(`${API_BASE}/api/signals/scan?riskMode=${riskMode}&riskValue=${safeRiskValue}`, {
      method: "POST",
      cache: "no-store"
    });
    setSignalLog(await fetchJson<SignalLogEntry[]>(`${API_BASE}/api/signal-log?limit=80`, { cache: "no-store" }));
  }, [riskMode, riskValue]);

  const runAutoScan = React.useCallback(async () => {
    const response = await fetchJson<AutoScanResponse>(`${API_BASE}/api/auto-mode/scan-now`, {
      method: "POST",
      cache: "no-store"
    });
    setAutoMode(response.status);
    if (response.executed > 0) {
      setToast(`Full Auto executed ${response.executed} order(s).`);
    } else if (response.blocked.length > 0) {
      setToast(response.blocked[response.blocked.length - 1]);
    }
    refresh().catch(() => undefined);
  }, [refresh]);

  React.useEffect(() => {
    refreshBackendHealth().catch(() => undefined);
    refresh().catch(() => setToast("Backend belum aktif. Jalankan FastAPI di port 9000."));
  }, [refresh, refreshBackendHealth]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      refreshBackendHealth().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshBackendHealth]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  React.useEffect(() => {
    refreshTicks().catch(() => undefined);
    const timer = window.setInterval(() => {
      refreshTicks().catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refreshTicks]);

  React.useEffect(() => {
    scanPotentialSignals().catch(() => undefined);
    const timer = window.setInterval(() => {
      scanPotentialSignals().catch(() => undefined);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [scanPotentialSignals]);

  React.useEffect(() => {
    if (!autoMode?.enabled) return;
    const intervalMs = Math.max(autoMode.scanIntervalSeconds, 5) * 1000;
    const timer = window.setInterval(() => {
      runAutoScan().catch(() => undefined);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [autoMode?.enabled, autoMode?.scanIntervalSeconds, runAutoScan]);

  const mt5BlockedReason = status?.connected ? null : "MT5 is offline";
  const tradeBlockedReason =
    status?.connected && !status.trade_ready ? "MT5 AutoTrading/Algo Trading is disabled in the terminal" : null;
  const demoGuardBlockedReason = status?.connected && status.demo_guard_enabled && status.live_account ? "Demo guard blocks non-demo account execution" : null;
  const demoGuardOffWarning = status?.demo_guard_enabled === false ? "Demo guard is OFF; the app will not block non-demo account execution." : null;
  const scoreWarningReasons = signal?.blockedReasons.filter((reason) => reason === SCORE_BLOCK_REASON) ?? [];
  const parsedRiskValue = sanitizeRiskValue(riskValue);
  const invalidRiskInputReason = parseRiskValue(riskValue) === null ? "Risk value must be a positive number" : null;
  const riskGuardReason = signal?.riskPercent !== null && signal?.riskPercent !== undefined && signal.riskPercent > 0.5 ? "Risk exceeds 0.5% maximum" : null;
  const hardBlockedReasons = uniqueStrings([
    ...(signal?.blockedReasons.filter((reason) => reason !== SCORE_BLOCK_REASON) ?? []),
    ...(invalidRiskInputReason ? [invalidRiskInputReason] : []),
    ...(riskGuardReason ? [riskGuardReason] : []),
    ...(tradeBlockedReason ? [tradeBlockedReason] : []),
    ...(demoGuardBlockedReason ? [demoGuardBlockedReason] : []),
    ...(mt5BlockedReason ? [mt5BlockedReason] : [])
  ]);
  const executable = Boolean(
    status?.connected &&
      signal?.side &&
      signal.orderType &&
      signal.entry &&
      signal.stopLoss &&
      signal.takeProfit &&
      signal.lot &&
      hardBlockedReasons.length === 0
  );
  const executeLabel = signal?.orderType ? `Execute ${signal.orderType.replace("_", " ")}` : "No executable setup";
  const activeTick = ticks[symbol];

  function toggleIndicator(key: IndicatorKey) {
    setIndicators((current) => ({ ...current, [key]: !current[key] }));
  }

  async function confirmExecute() {
    if (!signal || !signal.side || !signal.orderType || !signal.entry || !signal.stopLoss || !signal.takeProfit) return;
    const res = await fetch(`${API_BASE}/api/orders/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        timeframe,
        side: signal.side,
        orderType: signal.orderType,
        entry: signal.entry,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskMode,
        riskValue: parsedRiskValue,
        lot: signal.lot,
        confirmed: true
      })
    });
    const payload = await res.json();
    setConfirmOpen(false);
    setToast(payload.message ?? "Order response received.");
    refresh().catch(() => undefined);
  }

  async function toggleDemoGuard(enabled: boolean) {
    const payload = await fetchJson<DemoGuardStatus>(`${API_BASE}/api/demo-guard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    setToast(payload.message);
    refresh().catch(() => undefined);
  }

  async function restartBackend() {
    if (!window.confirm("Restart backend now? App may be offline for a few seconds.")) return;
    const response = await fetchJson<BackendRestartResponse>(`${API_BASE}/api/backend/restart`, {
      method: "POST",
      cache: "no-store"
    });
    setToast(response.message);
    setBackendHealth(null);
    window.setTimeout(() => {
      refreshBackendHealth().catch(() => undefined);
      refresh().catch(() => undefined);
    }, 3500);
  }

  async function restartAllServices() {
    if (!window.confirm("Restart all services now? Backend may be offline for a few seconds; frontend will be started if port 5174 is down.")) return;
    const response = await fetchJson<AllServicesRestartResponse>(`${API_BASE}/api/services/restart-all`, {
      method: "POST",
      cache: "no-store"
    });
    setToast(`${response.message} ${formatServiceActions(response.actions)}`);
    setBackendHealth(null);
    window.setTimeout(() => {
      refreshBackendHealth().catch(() => undefined);
      refresh().catch(() => undefined);
    }, 4500);
  }

  async function toggleAutoMode(enabled: boolean) {
    const safeRiskValue = sanitizeRiskValue(riskValue);
    const payload = await fetchJson<AutoModeStatus>(`${API_BASE}/api/auto-mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        accountMode: autoMode?.accountMode ?? "USD",
        activeSymbols: autoMode?.activeSymbols ?? ["XAUUSD", "EURUSD"],
        hardTakeProfitUsd: autoMode?.hardTakeProfitUsd ?? { XAUUSD: 10, EURUSD: 10 },
        recoveryEnabled: autoMode?.recoveryEnabled ?? false,
        reversalHedgeScore: autoMode?.reversalHedgeScore ?? 75,
        recoveryResumeScore: autoMode?.recoveryResumeScore ?? 45,
        hedgeRatio: autoMode?.hedgeRatio ?? 0.5,
        hedgeProfitUsd: autoMode?.hedgeProfitUsd ?? { XAUUSD: 10, EURUSD: 10 },
        recoveryMultiplier: autoMode?.recoveryMultiplier ?? 1.35,
        maxRecoveryLayers: autoMode?.maxRecoveryLayers ?? 2,
        basketTargetUsd: autoMode?.basketTargetUsd ?? { XAUUSD: 15, EURUSD: 10 },
        basketMaxLossUsd: autoMode?.basketMaxLossUsd ?? { XAUUSD: 100, EURUSD: 50 },
        recoveryCooldownSeconds: autoMode?.recoveryCooldownSeconds ?? 60,
        shockAtrMultiplier: autoMode?.shockAtrMultiplier ?? 1.5,
        maxTotalRiskPercent: 20,
        minScore: 60,
        riskMode,
        riskValue: safeRiskValue,
        scanIntervalSeconds: 15,
        duplicateCooldownMinutes: 10
      })
    });
    setAutoMode(payload);
    setToast(enabled ? "Full Auto ON. Orders can be sent automatically with 20% total risk cap." : "Full Auto OFF.");
    if (enabled) {
      runAutoScan().catch(() => undefined);
    }
  }

  async function closePosition(payload: { ticket?: number; symbol?: SymbolName; all?: boolean }) {
    const target = payload.all ? "ALL open positions" : payload.ticket ? `ticket ${payload.ticket}` : payload.symbol ? `one ${payload.symbol} position` : "position";
    if (!window.confirm(`Close ${target} now?`)) return;
    const response = await fetchJson<ClosePositionResponse>(`${API_BASE}/api/positions/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, confirmed: true })
    });
    setToast(response.message);
    refresh().catch(() => undefined);
  }

  async function applyTrailingStop(ticket: number) {
    const triggerPips = parseRiskValue(trailingRules.triggerPips);
    const distancePips = parseRiskValue(trailingRules.distancePips);
    const stepPips = parseRiskValue(trailingRules.stepPips);
    if (triggerPips === null || distancePips === null || stepPips === null) {
      setToast("Trailing rules must be positive pip values.");
      return;
    }
    const response = await fetchJson<TrailingStopResponse>(`${API_BASE}/api/positions/trailing-stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, trigger_pips: triggerPips, distance_pips: distancePips, step_pips: stepPips, confirmed: true })
    });
    setToast(response.message);
    refresh().catch(() => undefined);
  }

  return (
    <main className="app-shell">
      <TopBar
        status={status}
        backendHealth={backendHealth}
        symbol={symbol}
        timeframe={timeframe}
        onSymbol={setSymbol}
        onTimeframe={setTimeframe}
        onRefresh={refresh}
        onRestartBackend={restartBackend}
        onRestartAllServices={restartAllServices}
        onDemoGuard={toggleDemoGuard}
        autoMode={autoMode}
        onAutoMode={toggleAutoMode}
      />
      <section className="workspace">
        <Watchlist active={symbol} snapshots={watchSnapshots} ticks={ticks} onSelect={setSymbol} />
        <section className={`chart-stage ${priceContextFullscreen ? "fullscreen" : ""}`}>
          <ChartHeader snapshot={snapshot} tick={activeTick} />
          <ChartToolbar
            indicators={indicators}
            fullscreen={priceContextFullscreen}
            onToggle={toggleIndicator}
            onToggleFullscreen={() => setPriceContextFullscreen((current) => !current)}
          />
          <CandlestickChart snapshot={snapshot} tick={activeTick} indicators={indicators} />
          <ChartInsights snapshot={snapshot} tick={activeTick} />
        </section>
        <aside className="right-rail">
          <AutoModeCard autoMode={autoMode} onScanNow={runAutoScan} />
          <SignalPanel
            signal={signal}
            riskMode={riskMode}
            riskValue={riskValue}
            spreadPoints={activeTick?.spread_points ?? snapshot?.spread_points ?? null}
            symbol={symbol}
            hardBlockedReasons={hardBlockedReasons}
            scoreWarningReasons={scoreWarningReasons}
            onRiskMode={setRiskMode}
            onRiskValue={setRiskValue}
            executable={executable}
            executeLabel={executeLabel}
            onExecute={() => setConfirmOpen(true)}
          />
          <EconomicCalendarBox calendar={calendar} activeSymbol={symbol} compact />
        </aside>
      </section>
      <section className="operations-grid">
        <PositionCard
          positions={positions}
          alerts={positionAlerts}
          journal={journal}
          activeSymbol={symbol}
          trailingRules={trailingRules}
          onTrailingRules={setTrailingRules}
          onApplyTrailing={applyTrailingStop}
          onCloseAll={() => closePosition({ all: true })}
          onCloseTicket={(ticket) => closePosition({ ticket })}
          onCloseSymbol={(item) => closePosition({ symbol: item })}
        />
        <div className="data-stack">
          <HistoryTable items={history} />
          <SignalLogTable items={signalLog} />
        </div>
      </section>
      {confirmOpen && signal && snapshot && (
        <ConfirmModal
          signal={signal}
          spread={snapshot.spread_points}
          scoreWarningReasons={scoreWarningReasons}
          demoGuardOffWarning={demoGuardOffWarning}
          accountLabel={status?.demo_mode ? "Demo account" : status?.live_account ? "Non-demo account" : "Account unknown"}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={confirmExecute}
        />
      )}
      {toast && (
        <button className="toast" onClick={() => setToast(null)}>
          {toast}
        </button>
      )}
    </main>
  );
}

function TopBar({
  status,
  backendHealth,
  symbol,
  timeframe,
  onSymbol,
  onTimeframe,
  onRefresh,
  onRestartBackend,
  onRestartAllServices,
  onDemoGuard,
  autoMode,
  onAutoMode
}: {
  status: Status | null;
  backendHealth: BackendHealth | null;
  symbol: SymbolName;
  timeframe: Timeframe;
  onSymbol: (value: SymbolName) => void;
  onTimeframe: (value: Timeframe) => void;
  onRefresh: () => void;
  onRestartBackend: () => void;
  onRestartAllServices: () => void;
  onDemoGuard: (enabled: boolean) => void;
  autoMode: AutoModeStatus | null;
  onAutoMode: (enabled: boolean) => void;
}) {
  const guardEnabled = status?.demo_guard_enabled ?? true;
  const autoEnabled = autoMode?.enabled ?? false;
  const tradeLabel = status?.connected ? (status.trade_ready ? "Trading enabled" : "AutoTrading OFF") : "Trading pending";
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <TrendingUp size={19} />
        </div>
        <div>
          <strong>XAUGBPEUUSD Strategy</strong>
          <span>Exness MT5 execution guard</span>
        </div>
      </div>
      <button
        className={`backend-chip ${backendHealth?.active ? "active" : "offline"}`}
        onClick={onRestartBackend}
        title={backendHealth?.active ? `Backend active. PID ${backendHealth.pid}. Click to restart backend.` : "Backend offline. Click to try restart."}
      >
        <Activity size={15} />
        <span>{backendHealth?.active ? "Backend Active" : "Backend Offline"}</span>
      </button>
      <button className="service-restart-chip" onClick={onRestartAllServices} title="Restart backend and start frontend if port 5174 is down">
        <Activity size={15} />
        <span>Restart all</span>
      </button>
      <div className={`connection ${status?.connected ? "connected" : "offline"}`} title={status?.message}>
        <PlugZap size={16} />
        <span>{status?.connected ? "MT5 Connected" : "MT5 Offline"}</span>
      </div>
      <button
        className={`demo-chip ${guardEnabled ? "active" : "off"}`}
        onClick={() => onDemoGuard(!guardEnabled)}
        title={guardEnabled ? "Turn demo guard OFF" : "Turn demo guard ON"}
      >
        <ShieldCheck size={15} />
        <span>Demo guard {guardEnabled ? "ON" : "OFF"}</span>
      </button>
      <button
        className={`auto-chip ${autoEnabled ? "active" : "off"}`}
        onClick={() => onAutoMode(!autoEnabled)}
        title={autoEnabled ? "Turn Full Auto OFF" : "Turn Full Auto ON"}
      >
        <Activity size={15} />
        <span>Full Auto {autoEnabled ? "ON" : "OFF"}</span>
      </button>
      <div className={`trade-chip ${status?.trade_ready ? "ready" : status?.connected ? "blocked" : ""}`}>{tradeLabel}</div>
      <Selector value={symbol} options={symbols} onChange={(value) => onSymbol(value as SymbolName)} />
      <Selector value={timeframe} options={timeframes} onChange={(value) => onTimeframe(value as Timeframe)} />
      <div className="equity">
        <span>Equity</span>
        <strong>{formatMoney(status?.equity ?? 10000)}</strong>
      </div>
      <button className="icon-button" onClick={onRefresh} title="Refresh market data">
        <Activity size={18} />
      </button>
    </header>
  );
}

function AutoModeCard({ autoMode, onScanNow }: { autoMode: AutoModeStatus | null; onScanNow: () => void }) {
  const exposure = autoMode?.exposure;
  const enabled = autoMode?.enabled ?? false;
  return (
    <section className={`auto-mode-card ${enabled ? "enabled" : "disabled"}`}>
      <div className="auto-mode-heading">
        <div>
          <span className="panel-title">Full Auto</span>
          <h2>{enabled ? "Automatic execution ON" : "Automatic execution OFF"}</h2>
        </div>
        <span className={`auto-state ${enabled ? "on" : "off"}`}>{enabled ? "ON" : "OFF"}</span>
      </div>
      {enabled && (
        <div className="auto-warning">
          <AlertTriangle size={15} />
          <span>Order dapat dikirim otomatis tanpa modal per order, tetap demo guard dan total risk cap aktif.</span>
        </div>
      )}
      <div className="auto-risk-grid">
        <Metric label="Total risk" value={`${formatPercent(exposure?.totalRiskPercent)} / ${formatPercent(autoMode?.maxTotalRiskPercent ?? 20)}`} />
        <Metric label="Available" value={formatPercent(exposure?.availableRiskPercent)} />
        <Metric label="Min score" value={`${autoMode?.minScore ?? 60}+`} />
        <Metric label="Interval" value={`${autoMode?.scanIntervalSeconds ?? 15}s`} />
      </div>
      {autoMode?.blockedReason && <div className="auto-blocked">{autoMode.blockedReason}</div>}
      <div className="auto-meta">
        <span>Last scan: {autoMode?.lastScan ? formatDateLabel(autoMode.lastScan) : "--"}</span>
        <span>{autoMode?.lastAction ?? "No auto action yet"}</span>
      </div>
      <button className="scan-now-button" disabled={!enabled} onClick={onScanNow}>
        Scan now
      </button>
    </section>
  );
}

function Selector({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="selector">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown size={15} />
    </label>
  );
}

function Watchlist({
  active,
  snapshots,
  ticks,
  onSelect
}: {
  active: SymbolName;
  snapshots: Partial<Record<SymbolName, Snapshot>>;
  ticks: Partial<Record<SymbolName, MarketTick>>;
  onSelect: (symbol: SymbolName) => void;
}) {
  return (
    <aside className="watchlist">
      <div className="panel-title">Watchlist</div>
      {symbols.map((item) => {
        const rowSnapshot = snapshots[item];
        const rowTick = ticks[item];
        const bid = rowTick?.bid ?? rowSnapshot?.bid;
        const ask = rowTick?.ask ?? rowSnapshot?.ask;
        const mid = rowTick?.mid ?? (bid !== undefined && ask !== undefined ? (bid + ask) / 2 : null);
        const spread = rowTick?.spread_points ?? rowSnapshot?.spread_points;
        return (
          <button key={item} className={`watch-row ${active === item ? "active" : ""}`} onClick={() => onSelect(item)}>
            <span className="watch-main">
              <strong>{item}</strong>
              <small>{rowSnapshot?.bias ?? "loading"}</small>
            </span>
            <span className="watch-price">
              <strong className={item === "XAUUSD" ? "gold" : "teal"}>{formatPrice(mid)}</strong>
              <small>
                Bid {formatPrice(bid)} / Ask {formatPrice(ask)}
              </small>
              <em className={spreadClass(item, spread)}>
                Spread {formatSpread(spread)} pts - {spreadStatus(item, spread)}
              </em>
            </span>
          </button>
        );
      })}
      <div className="guard-note">
        <AlertTriangle size={16} />
        Execution is blocked until MT5 is connected and validation passes.
      </div>
    </aside>
  );
}

function ChartHeader({ snapshot, tick }: { snapshot: Snapshot | null; tick: MarketTick | undefined }) {
  const bid = tick?.bid ?? snapshot?.bid;
  const ask = tick?.ask ?? snapshot?.ask;
  const spread = tick?.spread_points ?? snapshot?.spread_points;
  return (
    <div className="chart-header">
      <div>
        <span className="panel-title">Price context</span>
        <h1>{snapshot ? `${snapshot.symbol} ${snapshot.timeframe}` : "Loading chart"}</h1>
      </div>
      <div className="quote-strip">
        <span>Bid {formatPrice(bid)}</span>
        <span>Ask {formatPrice(ask)}</span>
        <span className={spreadClass(snapshot?.symbol, spread)}>
          Spread {formatSpread(spread)} pts
        </span>
        <span className={snapshot?.bias === "bearish" ? "danger" : "success"}>{snapshot?.bias ?? "neutral"}</span>
      </div>
    </div>
  );
}

function ChartToolbar({
  indicators,
  fullscreen,
  onToggleFullscreen,
  onToggle
}: {
  indicators: Record<IndicatorKey, boolean>;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onToggle: (key: IndicatorKey) => void;
}) {
  const items: Array<{ key: IndicatorKey; label: string }> = [
    { key: "ema", label: "EMA 21/55" },
    { key: "ma", label: "MA 20/50" },
    { key: "supportResistance", label: "Support/Resistance" },
    { key: "supplyDemand", label: "Supply/Demand" },
    { key: "fib", label: "Fibo" },
    { key: "live", label: "Live price" }
  ];
  return (
    <div className="chart-toolbar">
      <div className="chart-tool-label">
        <Layers size={15} />
        Indicators
      </div>
      <div className="indicator-toggles">
        {items.map((item) => (
          <button key={item.key} className={indicators[item.key] ? "selected" : ""} onClick={() => onToggle(item.key)}>
            {item.label}
          </button>
        ))}
        <button className="fullscreen-toggle selected" onClick={onToggleFullscreen} title={fullscreen ? "Exit fullscreen price context" : "Open price context fullscreen"}>
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {fullscreen ? "Exit full" : "Full screen"}
        </button>
      </div>
    </div>
  );
}

function CandlestickChart({
  snapshot,
  tick,
  indicators
}: {
  snapshot: Snapshot | null;
  tick: MarketTick | undefined;
  indicators: Record<IndicatorKey, boolean>;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const candleSeriesRef = React.useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaFastRef = React.useRef<ISeriesApi<"Line"> | null>(null);
  const emaSlowRef = React.useRef<ISeriesApi<"Line"> | null>(null);
  const maFastRef = React.useRef<ISeriesApi<"Line"> | null>(null);
  const maSlowRef = React.useRef<ISeriesApi<"Line"> | null>(null);
  const priceLineRefs = React.useRef<IPriceLine[]>([]);
  const candles = React.useMemo(() => snapshot?.candles.slice(-160) ?? [], [snapshot?.candles]);
  const livePrice = snapshot ? (tick?.mid ?? (snapshot.bid + snapshot.ask) / 2) : null;
  const latest = candles[candles.length - 1];

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth || 640,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#64748b"
      },
      grid: {
        vertLines: { color: "#edf2f7" },
        horzLines: { color: "#edf2f7" }
      },
      crosshair: {
        mode: CrosshairMode.Normal
      },
      rightPriceScale: {
        borderColor: "#dfe5ec",
        scaleMargins: {
          top: 0.12,
          bottom: 0.12
        }
      },
      timeScale: {
        borderColor: "#dfe5ec",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 14,
        barSpacing: 7
      },
      localization: {
        priceFormatter: (value: number) => formatPrice(value)
      }
    });

    chartRef.current = chart;
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#14b8a6",
      downColor: "#ef4444",
      borderUpColor: "#0f766e",
      borderDownColor: "#b91c1c",
      wickUpColor: "#0f766e",
      wickDownColor: "#b91c1c",
      priceLineVisible: false
    });
    emaFastRef.current = chart.addSeries(LineSeries, { color: "#b7791f", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    emaSlowRef.current = chart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    maFastRef.current = chart.addSeries(LineSeries, { color: "#7c3aed", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
    maSlowRef.current = chart.addSeries(LineSeries, { color: "#0f172a", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: container.clientWidth,
        height: Math.max(360, Math.round(container.clientHeight || 360))
      });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaFastRef.current = null;
      emaSlowRef.current = null;
      maFastRef.current = null;
      maSlowRef.current = null;
      priceLineRefs.current = [];
    };
  }, [candles.length, snapshot?.symbol, snapshot?.timeframe]);

  React.useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || !snapshot || candles.length === 0) return;

    const candleData = uniqueByTime(
      candles.map((candle) => ({
        time: toChartTimestamp(candle.time),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close
      }))
    );

    candleSeries.setData(candleData);
    emaFastRef.current?.setData(indicators.ema ? lineDataFromIndicator(candles, snapshot.indicators.ema_fast) : []);
    emaSlowRef.current?.setData(indicators.ema ? lineDataFromIndicator(candles, snapshot.indicators.ema_slow) : []);
    maFastRef.current?.setData(indicators.ma ? lineDataFromIndicator(candles, snapshot.indicators.ma_fast) : []);
    maSlowRef.current?.setData(indicators.ma ? lineDataFromIndicator(candles, snapshot.indicators.ma_slow) : []);

    for (const priceLine of priceLineRefs.current) {
      candleSeries.removePriceLine(priceLine);
    }
    priceLineRefs.current = buildPriceLines(snapshot, indicators, livePrice).map((line) => candleSeries.createPriceLine(line));

    chart.timeScale().fitContent();
    chart.timeScale().applyOptions({ rightOffset: 14 });
  }, [candles, indicators, livePrice, snapshot]);

  if (!snapshot || candles.length === 0) return <div className="chart-empty">Waiting for market data</div>;

  return (
    <div className="chart-wrap">
      <div ref={containerRef} className="chart lightweight-chart" role="img" aria-label={`${snapshot.symbol} TradingView lightweight candlestick chart`} />
      <div className="chart-status-strip">
        <strong>{formatDateLabel(latest.time)}</strong>
        <span>O {formatPrice(latest.open)}</span>
        <span>H {formatPrice(latest.high)}</span>
        <span>L {formatPrice(latest.low)}</span>
        <span>C {formatPrice(latest.close)}</span>
        <span>Live {formatPrice(livePrice)}</span>
      </div>
      <div className="legend-row">
        {indicators.ema ? <span className="legend-item ema">EMA 21/55</span> : null}
        {indicators.ma ? <span className="legend-item ma">MA 20/50</span> : null}
        {indicators.supportResistance ? <span className="legend-item support-resistance">Support/Resistance</span> : null}
        {indicators.supplyDemand ? <span className="legend-item supply-demand">Supply/Demand</span> : null}
        {indicators.fib ? <span className="legend-item fib">Fib retracement</span> : null}
      </div>
    </div>
  );
}

function toChartTimestamp(value: string): UTCTimestamp {
  const parsed = new Date(value).getTime();
  const seconds = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
  return seconds as UTCTimestamp;
}

function uniqueByTime<T extends { time: UTCTimestamp }>(data: T[]): T[] {
  const seen = new Set<number>();
  const unique: T[] = [];
  for (const item of data) {
    const key = item.time as number;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.sort((a, b) => (a.time as number) - (b.time as number));
}

function lineDataFromIndicator(candles: Candle[], values: number[]): LineData[] {
  const alignedValues = values.slice(-candles.length);
  const data: Array<{ time: UTCTimestamp; value: number }> = [];
  candles.forEach((candle, index) => {
    const value = alignedValues[index];
    if (Number.isFinite(value)) {
      data.push({
        time: toChartTimestamp(candle.time),
        value
      });
    }
  });
  return uniqueByTime(data);
}

function buildPriceLines(snapshot: Snapshot, indicators: Record<IndicatorKey, boolean>, livePrice: number | null): CreatePriceLineOptions[] {
  const lines: CreatePriceLineOptions[] = [];
  const addZone = (zone: Snapshot["zones"][number], color: string, title: string) => {
    lines.push(
      {
        price: zone.high,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: `${title} high`
      },
      {
        price: zone.low,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: `${title} low`
      }
    );
  };

  if (indicators.supportResistance) {
    snapshot.zones
      .filter((zone) => zone.kind === "SNR")
      .slice(0, 3)
      .forEach((zone) => addZone(zone, "#0f766e", `S/R ${zone.strength}/5`));
  }

  if (indicators.supplyDemand) {
    snapshot.zones
      .filter((zone) => zone.kind === "SND")
      .slice(0, 3)
      .forEach((zone) => addZone(zone, "#b45309", `S/D ${zone.strength}/5`));
  }

  if (indicators.fib) {
    snapshot.zones
      .filter((zone) => zone.kind === "FIB")
      .forEach((zone) => addZone(zone, "#2563eb", "Fib 61.8"));
  }

  if (indicators.live && livePrice !== null) {
    lines.push({
      price: livePrice,
      color: "#dc2626",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "Live"
    });
  }

  return lines;
}

function ChartInsights({ snapshot, tick }: { snapshot: Snapshot | null; tick: MarketTick | undefined }) {
  if (!snapshot || snapshot.candles.length === 0) {
    return <div className="insight-grid empty">Waiting for chart insight</div>;
  }
  const latest = snapshot.candles[snapshot.candles.length - 1];
  const candleRange = Math.max(latest.high - latest.low, 0);
  const body = Math.abs(latest.close - latest.open);
  const bodyShare = candleRange > 0 ? Math.round((body / candleRange) * 100) : 0;
  const livePrice = tick?.mid ?? (snapshot.bid + snapshot.ask) / 2;
  const nearZone = findNearestZone(livePrice, snapshot.zones);
  const emaFast = snapshot.indicators.ema_fast[snapshot.indicators.ema_fast.length - 1];
  const emaSlow = snapshot.indicators.ema_slow[snapshot.indicators.ema_slow.length - 1];
  const trendDistance = emaFast && emaSlow ? Math.abs(emaFast - emaSlow) : 0;
  const trendLabel = snapshot.bias === "neutral" ? "Neutral" : `${capitalize(snapshot.bias)} trend`;
  const candleLabel = latest.close >= latest.open ? "Bullish candle" : "Bearish candle";
  const spread = tick?.spread_points ?? snapshot.spread_points;
  const narrative = buildNarrativeInsight({
    snapshot,
    tick,
    nearZone,
    candleLabel,
    spread,
    bodyShare,
    livePrice
  });

  return (
    <>
      <div className="narrative-box">
        <div className="narrative-heading">
          <span>Market narrative</span>
          <strong>{narrative.title}</strong>
        </div>
        <p>{narrative.body}</p>
        <div className="narrative-points">
          {narrative.points.map((point) => (
            <span key={point}>{point}</span>
          ))}
        </div>
      </div>
      <div className="insight-grid">
        <div className="insight-item">
          <span>Trend read</span>
          <strong>{trendLabel}</strong>
          <small>EMA gap {formatPrice(trendDistance)}</small>
        </div>
        <div className="insight-item">
          <span>Last candle</span>
          <strong>{candleLabel}</strong>
          <small>Body {bodyShare}% of range</small>
        </div>
        <div className="insight-item">
          <span>Nearest zone</span>
          <strong>{nearZone ? nearZone.label : "No close zone"}</strong>
          <small>{nearZone ? `${zoneHumanName(nearZone.kind)} strength ${nearZone.strength}/5` : "Price is between mapped zones"}</small>
        </div>
        <div className={`insight-item ${spreadClass(snapshot.symbol, spread)}`}>
          <span>Execution cost</span>
          <strong>Spread {formatSpread(spread)} pts</strong>
          <small>{spreadStatus(snapshot.symbol, spread)}</small>
        </div>
      </div>
    </>
  );
}

function SignalPanel({
  signal,
  riskMode,
  riskValue,
  spreadPoints,
  symbol,
  hardBlockedReasons,
  scoreWarningReasons,
  onRiskMode,
  onRiskValue,
  executable,
  executeLabel,
  onExecute
}: {
  signal: Signal | null;
  riskMode: RiskMode;
  riskValue: string;
  spreadPoints: number | null;
  symbol: SymbolName;
  hardBlockedReasons: string[];
  scoreWarningReasons: string[];
  onRiskMode: (mode: RiskMode) => void;
  onRiskValue: (value: string) => void;
  executable: boolean;
  executeLabel: string;
  onExecute: () => void;
}) {
  const blocked = [...scoreWarningReasons, ...hardBlockedReasons];
  return (
    <aside className="signal-panel">
      <div className="panel-title">Signal workspace</div>
      <div className="score-block">
        <div>
          <span>Confluence score</span>
          <strong>{signal?.score ?? "--"}</strong>
        </div>
        <div className={`score-ring ${(signal?.score ?? 0) >= 70 ? "strong" : "weak"}`}>{signal?.side ?? "WAIT"}</div>
      </div>
      <div className="setup-name">{signal?.setupType ?? "Scanning setup"}</div>
      <div className="checklist">
        {(signal?.reasons.length ? signal.reasons : ["Waiting for confluence"]).map((reason) => (
          <div key={reason} className="check-row">
            <CheckCircle2 size={16} />
            {reason}
          </div>
        ))}
      </div>
      <div className="levels-grid">
        <Metric label="Entry" value={formatPrice(signal?.entry)} />
        <Metric label="Stop loss" value={formatPrice(signal?.stopLoss)} />
        <Metric label="Take profit" value={formatPrice(signal?.takeProfit)} />
        <Metric label="Lot" value={signal?.lot ? signal.lot.toFixed(2) : "--"} />
        <Metric label="Spread" value={`${formatSpread(spreadPoints)} pts - ${spreadStatus(symbol, spreadPoints)}`} tone={spreadClass(symbol, spreadPoints)} />
      </div>
      <div className="risk-control">
        <div className="tabs">
          <button className={riskMode === "fixed_lot" ? "selected" : ""} onClick={() => onRiskMode("fixed_lot")}>
            Lot
          </button>
          <button className={riskMode === "fixed_usd" ? "selected" : ""} onClick={() => onRiskMode("fixed_usd")}>
            USD
          </button>
          <button className={riskMode === "percent_equity" ? "selected" : ""} onClick={() => onRiskMode("percent_equity")}>
            %
          </button>
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={riskValue}
          onChange={(event) => {
            onRiskValue(event.target.value);
          }}
          onBlur={(event) => {
            const parsed = parseRiskValue(event.target.value);
            if (parsed !== null) {
              onRiskValue(formatRiskInput(parsed));
            }
          }}
        />
      </div>
      {blocked.length > 0 && (
        <div className="blocked-box">
          {blocked.map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </div>
      )}
      {executable ? (
        <button className={`execute-button ${scoreWarningReasons.length > 0 ? "warning" : ""}`} onClick={onExecute}>
          {executeLabel}
        </button>
      ) : (
        <div className="no-execute">No executable order until MT5, order levels, spread, and risk checks pass.</div>
      )}
      <p className="fine-print">One relevant action only. Max lot per position is 0.10 and confirmation is required before MT5 order send.</p>
    </aside>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${url}`);
  }
  return (await response.json()) as T;
}

function parseRiskValue(value: string | number) {
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeRiskValue(value: string | number) {
  return parseRiskValue(value) ?? 0.01;
}

function formatRiskInput(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function PositionCard({
  positions,
  alerts,
  journal,
  activeSymbol,
  trailingRules,
  onTrailingRules,
  onApplyTrailing,
  onCloseAll,
  onCloseTicket,
  onCloseSymbol
}: {
  positions: OpenPosition[];
  alerts: PositionSetupAlert[];
  journal: TradingJournalEntry[];
  activeSymbol: SymbolName;
  trailingRules: TrailingRules;
  onTrailingRules: (value: TrailingRules) => void;
  onApplyTrailing: (ticket: number) => void;
  onCloseAll: () => void;
  onCloseTicket: (ticket: number) => void;
  onCloseSymbol: (symbol: SymbolName) => void;
}) {
  const activeSymbolPositions = positions.filter((position) => position.symbol === activeSymbol);
  const totalProfit = positions.reduce((sum, position) => sum + position.profit, 0);
  const realizedPnl = journal.reduce((sum, item) => sum + (item.profit ?? 0), 0);
  const winningTrades = journal.filter((item) => (item.profit ?? 0) > 0).length;
  const losingTrades = journal.filter((item) => (item.profit ?? 0) < 0).length;
  const alertByTicket = React.useMemo(() => new Map(alerts.map((alert) => [alert.ticket, alert])), [alerts]);
  return (
    <section className="positions-card">
      <div className="positions-heading">
        <div>
          <span className="panel-title">Position</span>
          <h2>Open position monitor</h2>
          <small>Hard TP closes at $10 floating profit. Manual trailing remains available below.</small>
        </div>
        <div className={`position-pnl ${totalProfit >= 0 ? "positive" : "negative"}`}>
          <span>Floating P/L</span>
          <strong>{formatMoney(totalProfit)}</strong>
        </div>
      </div>
      <div className="position-actions">
        <button className="close-all-button" disabled={positions.length === 0} onClick={onCloseAll}>
          <XCircle size={16} />
          Close all
        </button>
        <button disabled={activeSymbolPositions.length === 0} onClick={() => onCloseSymbol(activeSymbol)}>
          <XCircle size={16} />
          Close one {activeSymbol}
        </button>
        <div className="trailing-rules">
          <TrailingRuleInput label="Trigger pips" value={trailingRules.triggerPips} onChange={(value) => onTrailingRules({ ...trailingRules, triggerPips: value })} />
          <TrailingRuleInput label="Distance pips" value={trailingRules.distancePips} onChange={(value) => onTrailingRules({ ...trailingRules, distancePips: value })} />
          <TrailingRuleInput label="Step pips" value={trailingRules.stepPips} onChange={(value) => onTrailingRules({ ...trailingRules, stepPips: value })} />
        </div>
        <span>
          {positions.length} open / {activeSymbolPositions.length} on active pair
        </span>
      </div>
      {positions.length > 0 ? (
        <div className="position-list">
          {positions.map((position) => (
            <article key={position.ticket} className={`position-row ${alertByTicket.get(position.ticket)?.status ?? ""}`}>
              <div className="position-main">
                <strong>{position.symbol}</strong>
                <span className={position.side === "BUY" ? "side-buy" : "side-sell"}>{position.side}</span>
                <small>#{position.ticket}</small>
              </div>
              <div className="position-metrics">
                <Metric label="Lot" value={position.volume.toFixed(2)} />
                <Metric label="Open" value={formatPrice(position.open_price)} />
                <Metric label="Now" value={formatPrice(position.current_price)} />
                <Metric label="SL" value={formatPrice(position.stopLoss)} />
                <Metric label="TP" value={formatPrice(position.takeProfit)} />
                <Metric label="P/L" value={formatMoney(position.profit)} tone={position.profit >= 0 ? "profit-positive" : "profit-negative"} />
              </div>
              {alertByTicket.get(position.ticket) ? <PositionSetupAlertBox alert={alertByTicket.get(position.ticket)!} /> : null}
              <div className="position-row-actions">
                <button className="close-position-button" onClick={() => onCloseTicket(position.ticket)}>
                  <XCircle size={15} />
                  Close ticket
                </button>
                <button className="trail-position-button" onClick={() => onApplyTrailing(position.ticket)}>
                  <TrendingUp size={15} />
                  Apply trailing
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="position-empty">No open MT5 positions.</div>
      )}
      <div className="journal-block">
        <div className="journal-heading">
          <div className="journal-title">
            <BookOpen size={16} />
            Trading journal
          </div>
          <div className={`realized-pnl ${realizedPnl >= 0 ? "positive" : "negative"}`}>
            <span>Total realized P/L</span>
            <strong>{formatMoney(realizedPnl)}</strong>
            <small>{journal.length} closed - {winningTrades} win / {losingTrades} loss</small>
          </div>
        </div>
        {journal.length > 0 ? (
          <div className="table-scroll journal-scroll">
          <table className="journal-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Ticket</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Lot</th>
                <th>Exit</th>
                <th>P/L</th>
                <th>Close reason</th>
              </tr>
            </thead>
            <tbody>
              {journal.slice(0, 12).map((item, idx) => (
                <tr key={`${item.ticket}-${item.time}-${idx}`}>
                  <td>{formatDateLabel(item.time)}</td>
                  <td>{item.ticket ?? "--"}</td>
                  <td>{item.symbol}</td>
                  <td>{item.side ?? "--"}</td>
                  <td>{item.volume?.toFixed(2) ?? "--"}</td>
                  <td>{formatPrice(item.exit)}</td>
                  <td className={item.profit !== null && item.profit >= 0 ? "profit-text" : "loss-text"}>{item.profit !== null ? formatMoney(item.profit) : "--"}</td>
                  <td>
                    <span className={`close-reason ${item.closeReason}`}>{closeReasonLabel(item.closeReason)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <div className="position-empty">Journal is waiting for closed positions from MT5 or user force close.</div>
        )}
      </div>
    </section>
  );
}

function PositionSetupAlertBox({ alert }: { alert: PositionSetupAlert }) {
  return (
    <div className={`position-setup-alert ${alert.status}`}>
      <div>
        <strong>{alert.title}</strong>
        <span>{alert.message}</span>
      </div>
      <small>
        Checked {alert.checkedTimeframes.join(", ")}
        {alert.supportingTimeframes.length > 0 ? ` | Support ${alert.supportingTimeframes.join(", ")}` : ""}
        {alert.opposingTimeframes.length > 0 ? ` | Oppose ${alert.opposingTimeframes.join(", ")}` : ""}
      </small>
    </div>
  );
}

function TrailingRuleInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="trailing-control">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => {
          const parsed = parseRiskValue(event.target.value);
          if (parsed !== null) onChange(formatRiskInput(parsed));
        }}
      />
    </label>
  );
}

function HistoryTable({ items }: { items: HistoryItem[] }) {
  return (
    <section className="history">
      <div className="panel-title">Alert and order history</div>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Symbol</th>
            <th>TF</th>
            <th>Score</th>
            <th>Action</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={`${item.time}-${item.symbol}-${idx}`}>
              <td>{item.time}</td>
              <td>{item.symbol}</td>
              <td>{item.timeframe}</td>
              <td>{item.score}</td>
              <td>{item.action.replace("_", " ")}</td>
              <td>
                <span className={`status-pill ${item.status}`}>{item.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SignalLogTable({ items }: { items: SignalLogEntry[] }) {
  const visibleItems = items.slice(0, 30);
  return (
    <section className="signal-log">
      <div className="signal-log-heading">
        <div>
          <span className="panel-title">Potential signals data</span>
          <h2>Score 60+ signal capture</h2>
        </div>
        <span className="capture-pill">Latest {visibleItems.length}/{items.length} - Auto scan 60s</span>
      </div>
      <p className="signal-log-note">
        Semua potensi sinyal dengan confluence score minimal 60 dicatat untuk dataset strategi, termasuk hari, tanggal, jam, market, timeframe, setup,
        entry, SL, TP, spread, dan status validasi.
      </p>
      {items.length > 0 ? (
        <div className="table-scroll signal-log-scroll">
        <table className="signal-log-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Day</th>
              <th>Time</th>
              <th>Market</th>
              <th>TF</th>
              <th>Score</th>
              <th>Setup</th>
              <th>Order</th>
              <th>Entry</th>
              <th>SL</th>
              <th>TP</th>
              <th>Spread</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr key={item.id}>
                <td>{item.date}</td>
                <td>{item.day}</td>
                <td>{item.time}</td>
                <td>{item.symbol}</td>
                <td>{item.timeframe}</td>
                <td>
                  <strong>{item.score}</strong>
                </td>
                <td>{item.setupType}</td>
                <td>{item.orderType ? item.orderType.replace("_", " ") : item.side ?? "WAIT"}</td>
                <td>{formatPrice(item.entry)}</td>
                <td>{formatPrice(item.stopLoss)}</td>
                <td>{formatPrice(item.takeProfit)}</td>
                <td>{formatSpread(item.spread_points)} pts</td>
                <td>
                  <span className={`status-pill ${item.status}`}>{item.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : (
        <div className="signal-log-empty">
          Belum ada sinyal score 60+ yang tercatat. Backend akan otomatis menyimpan data saat scan menemukan peluang valid atau blocked dengan score
          minimal 60.
        </div>
      )}
    </section>
  );
}

function EconomicCalendarBox({ calendar, activeSymbol, compact = false }: { calendar: EconomicCalendarResponse | null; activeSymbol: SymbolName; compact?: boolean }) {
  const relevantEvents = React.useMemo(() => {
    const events = calendar?.events ?? [];
    return events.filter((event) => event.affected_symbols.includes(activeSymbol)).slice(0, 8);
  }, [activeSymbol, calendar]);

  return (
    <section className={`economic-calendar ${compact ? "compact" : ""}`}>
      <div className="calendar-heading">
        <div>
          <span className="panel-title">Economic events</span>
          <h2>MQL5 Calendar impact for {activeSymbol}</h2>
        </div>
        <span className={calendar?.configured ? "calendar-source active" : "calendar-source"}>
          {calendar?.configured ? "MQL5 export active" : "MQL5 export needed"}
        </span>
      </div>
      <p className="calendar-message">{calendar?.message ?? "Loading economic calendar status..."}</p>
      {relevantEvents.length > 0 ? (
        <div className="event-list">
          {relevantEvents.map((event) => (
            <article key={event.id} className={`event-row ${event.impact}`}>
              <div className="event-time">
                <strong>{event.currency}</strong>
                <span>{formatDateLabel(event.time)}</span>
              </div>
              <div className="event-body">
                <strong>{event.title}</strong>
                <span>
                  Actual {event.actual ?? "--"} · Forecast {event.forecast ?? "--"} · Previous {event.previous ?? "--"}
                </span>
              </div>
              <span className={`impact-pill ${event.impact}`}>{event.impact}</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="calendar-empty">
          Run `mql5/ExportEconomicCalendar.mq5` in MetaTrader 5 to populate USD, GBP, and EUR events from the MQL5 Calendar API.
        </div>
      )}
    </section>
  );
}

function ConfirmModal({
  signal,
  spread,
  scoreWarningReasons,
  demoGuardOffWarning,
  accountLabel,
  onCancel,
  onConfirm
}: {
  signal: Signal;
  spread: number;
  scoreWarningReasons: string[];
  demoGuardOffWarning: string | null;
  accountLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const hasScoreWarning = scoreWarningReasons.length > 0;
  const hasDemoGuardWarning = Boolean(demoGuardOffWarning);
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <h2>Confirm MT5 execution</h2>
        <p>
          {hasScoreWarning
            ? "Score setup belum mendukung filter strategi. Review detail order dan konfirmasi hanya jika tetap ingin eksekusi manual."
            : hasDemoGuardWarning
              ? "Demo guard sedang OFF. Review detail order dan akun MT5 aktif sebelum mengirim eksekusi."
            : "Review the single recommended order before sending it to the connected demo terminal."}
        </p>
        {hasScoreWarning ? (
          <div className="execution-warning">
            <strong>Low-score execution warning</strong>
            <span>Confluence score saat ini {signal.score}, di bawah minimum strategi 60.</span>
            {scoreWarningReasons.map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </div>
        ) : null}
        {hasDemoGuardWarning ? (
          <div className="execution-warning live">
            <strong>Demo guard OFF</strong>
            <span>{demoGuardOffWarning}</span>
            <span>Connected status: {accountLabel}. Pastikan akun MT5 yang aktif memang akun yang ingin dipakai.</span>
          </div>
        ) : null}
        <div className="confirm-grid">
          <Metric label="Symbol" value={signal.symbol} />
          <Metric label="Order" value={signal.orderType?.replace("_", " ") ?? "--"} />
          <Metric label="Lot" value={signal.lot?.toFixed(2) ?? "--"} />
          <Metric label="Entry" value={formatPrice(signal.entry)} />
          <Metric label="SL" value={formatPrice(signal.stopLoss)} />
          <Metric label="TP" value={formatPrice(signal.takeProfit)} />
          <Metric label="Risk" value={`${signal.riskPercent ?? 0}%`} />
          <Metric label="Score" value={`${signal.score}/100`} />
          <Metric label="Spread" value={`${spread} pts`} />
          <Metric label="Account" value={accountLabel} />
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className={`confirm-button ${hasScoreWarning || hasDemoGuardWarning ? "warning" : ""}`} onClick={onConfirm}>
            {hasScoreWarning || hasDemoGuardWarning ? "Confirm Execute Anyway" : "Confirm Execute"}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatPrice(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return value > 10 ? value.toFixed(2) : value.toFixed(5);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function usdToAccountMoney(valueUsd: number, accountMode: AccountMode) {
  return accountMode === "USC" ? valueUsd * 100 : valueUsd;
}

function formatAccountMoney(value: number, accountMode: AccountMode) {
  if (accountMode === "USC") {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} USC`;
  }
  return formatMoney(value);
}

function formatModeAmount(value: number, accountMode: AccountMode) {
  if (accountMode === "USC") {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} USC`;
  }
  return formatMoney(value);
}

function positiveNumber(value: string | number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampNumber(value: string | number, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function riskModeSuffix(mode: RiskMode) {
  if (mode === "fixed_lot") return "lot";
  if (mode === "fixed_usd") return "USD";
  return "% equity";
}

function formatActiveSymbols(value: SymbolName[] | null | undefined) {
  if (!value || value.length === 0) return "None";
  return value.join(", ");
}

function formatServiceActions(actions: ServiceRestartAction[]) {
  if (!actions.length) return "";
  return actions.map((action) => `${action.service}:${action.status}`).join(" | ");
}

function formatSeconds(value: number) {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}s`;
}

function formatTrailingRules(rules: AutoTrailingRule[] | null | undefined) {
  if (!rules || rules.length === 0) return "Trigger $10";
  return rules.map((rule) => `${rule.symbol} ${formatCompactNumber(rule.distancePips)}p/${formatCompactNumber(rule.stepPips)}p`).join(" - ");
}

function formatRecoveryPhases(cycles: RecoveryCycleStatus[] | null | undefined) {
  if (!cycles || cycles.length === 0) return "No active cycle";
  return cycles.map((cycle) => `${cycle.symbol} ${cycle.phase.replace(/_/g, " ")}`).join(" - ");
}

function formatCompactNumber(value: number) {
  return value.toFixed(value % 1 === 0 ? 0 : 2);
}

function normalizeInvestingStatuses(response: InvestingStatusCollection | InvestingStatusResponse) {
  if ("items" in response && response.items) {
    return Object.fromEntries(
      Object.entries(response.items).map(([symbol, value]) => [symbol, value?.investing_data_sync]).filter(([, value]) => Boolean(value))
    ) as Partial<Record<SymbolName, InvestingDataSync>>;
  }
  if ("investing_data_sync" in response) {
    return { [response.investing_data_sync.symbol]: response.investing_data_sync } as Partial<Record<SymbolName, InvestingDataSync>>;
  }
  return {};
}

function formatInvestingCode(value: string | null | undefined) {
  if (!value) return "--";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function investingToneClass(value: string | null | undefined) {
  if (!value) return "";
  if (value.includes("buy")) return "profit-text";
  if (value.includes("sell")) return "loss-text";
  return "";
}

function formatInvestingPrice(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  return value.toFixed(5);
}

function pivotType(level: string) {
  if (level.startsWith("S")) return "Support";
  if (level.startsWith("R")) return "Resistance";
  return "Pivot";
}

function pivotDistance(level: string) {
  if (level === "PIVOT") return "Midpoint";
  const match = level.match(/\d+/);
  return match ? `Level ${match[0]}` : "--";
}

function formatPivotSource(value: string | null | undefined) {
  if (!value) return "--";
  if (value === "OK" || value === "pivot_fibonacci") return "Pivot page";
  if (value === "TECHNICAL_FALLBACK" || value.startsWith("technical_fibonacci")) return "Technical Fibonacci";
  if (value === "FAILED") return "Parser failed";
  if (value === "EMPTY") return "No pivot";
  return value.replace(/_/g, " ");
}

function localDateKey(date: Date) {
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatSpread(value: number | null | undefined) {
  return value === null || value === undefined ? "--" : value.toFixed(value % 1 === 0 ? 0 : 1);
}

function spreadStatus(symbol: SymbolName | undefined, value: number | null | undefined) {
  if (!symbol || value === null || value === undefined) return "Waiting";
  return value <= spreadLimits[symbol] ? "Normal" : "High";
}

function spreadClass(symbol: SymbolName | undefined, value: number | null | undefined) {
  if (!symbol || value === null || value === undefined) return "spread-waiting";
  return value <= spreadLimits[symbol] ? "spread-normal" : "spread-high";
}

function closeReasonLabel(reason: TradingJournalEntry["closeReason"]) {
  if (reason === "tp") return "TP";
  if (reason === "sl") return "SL";
  if (reason === "force_close_user") return "Force close";
  if (reason === "manual_external") return "Manual MT5";
  return "Unknown";
}

function buildNarrativeInsight({
  snapshot,
  tick,
  nearZone,
  candleLabel,
  spread,
  bodyShare,
  livePrice
}: {
  snapshot: Snapshot;
  tick: MarketTick | undefined;
  nearZone: Snapshot["zones"][number] | null;
  candleLabel: string;
  spread: number;
  bodyShare: number;
  livePrice: number;
}) {
  const trendText =
    snapshot.bias === "bullish"
      ? "market masih condong bullish selama harga bertahan di atas area support terdekat"
      : snapshot.bias === "bearish"
        ? "market masih condong bearish selama harga tertahan di bawah area resistance terdekat"
        : "market sedang netral dan butuh konfirmasi arah yang lebih kuat";
  const zoneText = nearZone
    ? `Harga sekarang berada dekat ${zoneHumanName(nearZone.kind).toLowerCase()} "${nearZone.label}" di sekitar ${formatPrice((nearZone.low + nearZone.high) / 2)}.`
    : "Harga belum berada dekat zona utama yang dipetakan, jadi validasi entry perlu menunggu reaksi area berikutnya.";
  const spreadText =
    spreadStatus(snapshot.symbol, spread) === "High"
      ? `Spread ${formatSpread(spread)} pts sedang tinggi, jadi eksekusi sebaiknya ditahan sampai biaya transaksi normal.`
      : `Spread ${formatSpread(spread)} pts masih normal untuk filter strategi.`;
  const title =
    snapshot.bias === "bullish"
      ? "Bias bullish, tunggu pullback valid"
      : snapshot.bias === "bearish"
        ? "Bias bearish, hindari buy melawan struktur"
        : "Belum ada dominasi arah yang kuat";

  return {
    title,
    body: `Pada ${snapshot.symbol} ${snapshot.timeframe}, ${trendText}. ${zoneText} Candle terakhir terbaca ${candleLabel.toLowerCase()} dengan body ${bodyShare}% dari range, sehingga kualitas reaksi harga masih perlu dibandingkan dengan confluence score. ${spreadText}`,
    points: [
      `Live price ${formatPrice(livePrice)} (${tick?.source ?? "snapshot"})`,
      `Bias ${snapshot.bias}`,
      nearZone ? `${zoneHumanName(nearZone.kind)} aktif` : "Zona belum dekat",
      `Spread ${spreadStatus(snapshot.symbol, spread)}`
    ]
  };
}

function zoneHumanName(kind: Snapshot["zones"][number]["kind"]) {
  if (kind === "SNR") return "Support/Resistance";
  if (kind === "SND") return "Supply/Demand";
  return "Fibonacci";
}

function findNearestZone(price: number, zones: Snapshot["zones"]) {
  let best: Snapshot["zones"][number] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const zone of zones) {
    const center = (zone.low + zone.high) / 2;
    const width = Math.max(zone.high - zone.low, Math.abs(price) * 0.0004);
    const distance = Math.abs(price - center);
    if (distance < bestDistance && distance <= width * 4) {
      best = zone;
      bestDistance = distance;
    }
  }
  return best;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function marketRegimeTone(regime: MarketRegime) {
  if (regime === "TRENDING") return "trending";
  if (regime === "SIDEWAYS" || regime === "LOW_VOLATILITY") return "sideways";
  if (regime === "HIGH_VOLATILITY") return "volatile";
  if (regime === "CHOPPY" || regime === "HARD_CHOPPY" || regime === "NEWS_SHOCK") return "blocked";
  return "uncertain";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
