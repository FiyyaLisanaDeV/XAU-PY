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

interface AutoModeStatus {
  enabled: boolean;
  activeSymbols: SymbolName[];
  maxTotalRiskPercent: number;
  minScore: number;
  riskMode: RiskMode;
  riskValue: number;
  scanIntervalSeconds: number;
  duplicateCooldownMinutes: number;
  lastScan: string | null;
  lastAction: string | null;
  blockedReason: string | null;
  exposure: RiskExposure;
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
  enabled: boolean;
  activeSymbols: SymbolName[];
  maxTotalRiskPercent: string;
  minScore: string;
  riskMode: RiskMode;
  riskValue: string;
  scanIntervalSeconds: string;
  duplicateCooldownMinutes: string;
}

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

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const symbols: SymbolName[] = ["XAUUSD", "EURUSD"];
const timeframes: Timeframe[] = ["M15", "M30", "H1", "H4", "D1"];
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
  enabled: true,
  activeSymbols: ["XAUUSD", "EURUSD"],
  maxTotalRiskPercent: "20",
  minScore: "60",
  riskMode: "percent_equity",
  riskValue: "0.5",
  scanIntervalSeconds: "15",
  duplicateCooldownMinutes: "10"
};

function App() {
  const [activePage, setActivePage] = React.useState<"summary" | "settings" | "investing">("summary");
  const [status, setStatus] = React.useState<Status | null>(null);
  const [backendHealth, setBackendHealth] = React.useState<BackendHealth | null>(null);
  const [positions, setPositions] = React.useState<OpenPosition[]>([]);
  const [journal, setJournal] = React.useState<TradingJournalEntry[]>([]);
  const [autoMode, setAutoMode] = React.useState<AutoModeStatus | null>(null);
  const [autoTrailing, setAutoTrailing] = React.useState<AutoTrailingStatus | null>(null);
  const [ticks, setTicks] = React.useState<Partial<Record<SymbolName, MarketTick>>>({});
  const [confluenceScores, setConfluenceScores] = React.useState<ConfluenceScoreCard[]>([]);
  const [strategySettings, setStrategySettings] = React.useState<StrategyRiskSettings>(defaultStrategyRiskSettings);
  const [investingStatus, setInvestingStatus] = React.useState<InvestingDataSync | null>(null);
  const [investingStatuses, setInvestingStatuses] = React.useState<Partial<Record<SymbolName, InvestingDataSync>>>({});
  const [investingTechnical, setInvestingTechnical] = React.useState<InvestingTechnicalData | null>(null);
  const [investingTechnicals, setInvestingTechnicals] = React.useState<Partial<Record<SymbolName, InvestingTechnicalData>>>({});
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
    const [nextStatus, nextPositions, nextJournal, nextAutoMode, nextAutoTrailing, nextTicks, nextBackendHealth, nextInvestingStatus, nextInvestingTechnical] = await Promise.all([
      fetchJson<Status>(`${API_BASE}/api/status`, { cache: "no-store" }),
      fetchJson<OpenPosition[]>(`${API_BASE}/api/positions`, { cache: "no-store" }),
      fetchJson<TradingJournalEntry[]>(`${API_BASE}/api/journal`, { cache: "no-store" }),
      fetchJson<AutoModeStatus>(`${API_BASE}/api/auto-mode/status`, { cache: "no-store" }),
      fetchJson<AutoTrailingStatus>(`${API_BASE}/api/auto-trailing/status`, { cache: "no-store" }),
      fetchJson<Partial<Record<SymbolName, MarketTick>>>(`${API_BASE}/api/market/ticks`, { cache: "no-store" }),
      fetchJson<BackendHealth>(`${API_BASE}/api/backend/health`, { cache: "no-store" }),
      fetchJson<InvestingStatusCollection>(`${API_BASE}/api/investing/status`, { cache: "no-store" }),
      fetchJson<InvestingTechnicalCollection>(`${API_BASE}/api/investing/technical`, { cache: "no-store" })
    ]);
    setStatus(nextStatus);
    setPositions(nextPositions);
    setJournal(nextJournal);
    setAutoMode(nextAutoMode);
    setAutoTrailing(nextAutoTrailing);
    setTicks(nextTicks);
    setBackendHealth(nextBackendHealth);
    const nextSyncBySymbol = normalizeInvestingStatuses(nextInvestingStatus);
    setInvestingStatuses(nextSyncBySymbol);
    setInvestingStatus(nextSyncBySymbol.EURUSD ?? nextSyncBySymbol.XAUUSD ?? null);
    setInvestingTechnicals(nextInvestingTechnical.items ?? {});
    setInvestingTechnical(nextInvestingTechnical.items?.EURUSD ?? nextInvestingTechnical.items?.XAUUSD ?? null);
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
    setStrategySettings({
      enabled: autoMode.enabled,
      activeSymbols: autoMode.activeSymbols ?? ["XAUUSD", "EURUSD"],
      maxTotalRiskPercent: String(autoMode.maxTotalRiskPercent),
      minScore: String(autoMode.minScore),
      riskMode: autoMode.riskMode,
      riskValue: String(autoMode.riskValue),
      scanIntervalSeconds: String(autoMode.scanIntervalSeconds),
      duplicateCooldownMinutes: String(autoMode.duplicateCooldownMinutes)
    });
  }, [autoMode, settingsDirty]);

  const summary = React.useMemo(() => buildSummary(status, positions, journal), [status, positions, journal]);
  const pairRows = React.useMemo(() => buildPairRows(journal), [journal]);
  const dailyTarget = (status?.balance ?? status?.equity ?? 0) * 0.1;
  const dailyProgress = dailyTarget > 0 ? Math.min(Math.max((summary.dailyPnl / dailyTarget) * 100, 0), 100) : 0;

  async function closePositionGroup(kind: "winning" | "losing") {
    const selected = positions.filter((position) => (kind === "winning" ? position.profit > 0 : position.profit < 0));
    if (selected.length === 0) {
      setToast(`Tidak ada ${kind} trade terbuka.`);
      return;
    }
    const total = selected.reduce((sum, position) => sum + position.profit, 0);
    if (!window.confirm(`Close ${selected.length} ${kind} trade dengan floating P/L ${formatMoney(total)}?`)) return;
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
        enabled: nextSettings.enabled,
        activeSymbols: nextSettings.activeSymbols.length > 0 ? nextSettings.activeSymbols : ["XAUUSD", "EURUSD"],
        maxTotalRiskPercent: clampNumber(nextSettings.maxTotalRiskPercent, 0.1, 100, 20),
        minScore: Math.round(clampNumber(nextSettings.minScore, 0, 100, 60)),
        riskMode: nextSettings.riskMode,
        riskValue: positiveNumber(nextSettings.riskValue, 0.5),
        scanIntervalSeconds: Math.round(clampNumber(nextSettings.scanIntervalSeconds, 5, 300, 15)),
        duplicateCooldownMinutes: Math.round(clampNumber(nextSettings.duplicateCooldownMinutes, 0, 1440, 10))
      })
    });
    setAutoMode(payload);
    setStrategySettings({
      enabled: payload.enabled,
      activeSymbols: payload.activeSymbols ?? ["XAUUSD", "EURUSD"],
      maxTotalRiskPercent: String(payload.maxTotalRiskPercent),
      minScore: String(payload.minScore),
      riskMode: payload.riskMode,
      riskValue: String(payload.riskValue),
      scanIntervalSeconds: String(payload.scanIntervalSeconds),
      duplicateCooldownMinutes: String(payload.duplicateCooldownMinutes)
    });
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
          <button className={activePage === "settings" ? "active" : ""} onClick={() => setActivePage("settings")}>Settings</button>
          <button className={activePage === "investing" ? "active" : ""} onClick={() => setActivePage("investing")}>Investing</button>
        </nav>
        <div className="summary-status-row">
          <span className={backendHealth?.active ? "summary-pill ok" : "summary-pill danger"}>{backendHealth?.active ? "Backend active" : "Backend offline"}</span>
          <span className={status?.connected ? "summary-pill ok" : "summary-pill warn"}>{status?.connected ? "MT5 connected" : "MT5 offline"}</span>
          <button className="summary-refresh service-restart" onClick={() => restartAllServices().catch((error) => setToast(error.message))}>Restart all services</button>
          <button className="summary-refresh" onClick={() => refresh().catch(() => undefined)}>Refresh</button>
        </div>
      </header>

      {activePage === "settings" ? (
        <StrategySettingsPage
          settings={strategySettings}
          autoMode={autoMode}
          settingsDirty={settingsDirty}
          onChange={updateStrategySettings}
          onSave={() => saveStrategySettings().catch((error) => setToast(error.message))}
          onReset={() => {
            setSettingsDirty(false);
            if (autoMode) {
              setStrategySettings({
                enabled: autoMode.enabled,
                activeSymbols: autoMode.activeSymbols ?? ["XAUUSD", "EURUSD"],
                maxTotalRiskPercent: String(autoMode.maxTotalRiskPercent),
                minScore: String(autoMode.minScore),
                riskMode: autoMode.riskMode,
                riskValue: String(autoMode.riskValue),
                scanIntervalSeconds: String(autoMode.scanIntervalSeconds),
                duplicateCooldownMinutes: String(autoMode.duplicateCooldownMinutes)
              });
            } else {
              setStrategySettings(defaultStrategyRiskSettings);
            }
          }}
        />
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
          <span>Auto Trailing</span>
          <strong>{autoTrailing?.activeTickets ?? 0}/{autoTrailing?.trackedTickets ?? 0}</strong>
          <small>Always ON - checks every {formatSeconds(autoTrailing?.monitorIntervalSeconds ?? 1)}</small>
          <small>{formatTrailingRules(autoTrailing?.rules)}</small>
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
        <SummaryMetric title="P/L Total" value={formatMoney(summary.totalPnl)} tone={summary.totalPnl >= 0 ? "positive" : "negative"} />
        <SummaryMetric title="P/L Daily" value={formatMoney(summary.dailyPnl)} tone={summary.dailyPnl >= 0 ? "positive" : "negative"} />
        <SummaryMetric title="Current Position P/L" value={formatMoney(summary.floatingPnl)} tone={summary.floatingPnl >= 0 ? "positive" : "negative"} detail="Floating open positions" />
        <SummaryMetric title="Daily Target" value={formatMoney(summary.dailyPnl)} detail={`${dailyProgress.toFixed(1)}% dari target 10% (${formatMoney(dailyTarget)})`} tone={summary.dailyPnl >= 0 ? "positive" : "negative"} />
        <SummaryMetric title="Open Positions" value={`${positions.length}`} detail={`${summary.winningOpenCount} win / ${summary.losingOpenCount} loss`} />
        <SummaryMetric title="Profit Factor" value={summary.profitFactorLabel} detail={`${formatMoney(summary.grossProfit)} win / ${formatMoney(summary.grossLoss)} loss`} />
        <SummaryMetric title="Equity" value={formatMoney(status?.equity ?? 0)} detail={`Balance ${formatMoney(status?.balance ?? 0)}`} />
      </section>

      <section className="target-card">
        <div>
          <span className="panel-title">Daily target achieved</span>
          <strong>{formatMoney(summary.dailyPnl)}</strong>
          <small>Target 10%: {formatMoney(dailyTarget)} - {dailyProgress.toFixed(1)}% reached</small>
        </div>
        <div className="target-track">
          <span style={{ width: `${dailyProgress}%` }} />
        </div>
      </section>

      <section className="summary-actions">
        <button className={autoMode?.enabled ? "auto-toggle on" : "auto-toggle off"} onClick={() => toggleAutoMode(!(autoMode?.enabled ?? false))}>
          Full Auto {autoMode?.enabled ? "ON" : "OFF"}
        </button>
        <button className="close-win" onClick={() => closePositionGroup("winning")}>Close all winning trades</button>
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
          <small>Closed trade journal, nominal USD.</small>
        </div>
        <table className="summary-table">
          <thead>
            <tr>
              <th>Pair</th>
              <th>Winning trades</th>
              <th>Winning $</th>
              <th>Losing trades</th>
              <th>Losing $</th>
              <th>Net $</th>
            </tr>
          </thead>
          <tbody>
            {pairRows.map((row) => (
              <tr key={row.symbol}>
                <td>{row.symbol}</td>
                <td>{row.wins}</td>
                <td className="profit-text">{formatMoney(row.winUsd)}</td>
                <td>{row.losses}</td>
                <td className="loss-text">{formatMoney(row.lossUsd)}</td>
                <td className={row.netUsd >= 0 ? "profit-text" : "loss-text"}>{formatMoney(row.netUsd)}</td>
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
          <small>{autoTrailing?.message ?? "Auto trailing activates when floating profit reaches $10."}</small>
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
                <td className={position.profit >= 0 ? "profit-text" : "loss-text"}>{formatMoney(position.profit)}</td>
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

function StrategySettingsPage({
  settings,
  autoMode,
  settingsDirty,
  onChange,
  onSave,
  onReset
}: {
  settings: StrategyRiskSettings;
  autoMode: AutoModeStatus | null;
  settingsDirty: boolean;
  onChange: (patch: Partial<StrategyRiskSettings>) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const exposure = autoMode?.exposure;
  return (
    <section className="settings-page">
      <div className="summary-section-heading">
        <div>
          <span className="panel-title">Strategy & risk settings</span>
          <h2>Cocokkan parameter auto strategy</h2>
        </div>
        <small>Perubahan aktif setelah Save settings.</small>
      </div>

      <div className="settings-layout">
        <section className="settings-card">
          <div className="settings-card-heading">
            <strong>Automation</strong>
            <span className={settings.enabled ? "settings-state on" : "settings-state off"}>{settings.enabled ? "ON" : "OFF"}</span>
          </div>
          <label className="settings-toggle">
            <input type="checkbox" checked={settings.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
            <span>Full Auto enabled</span>
          </label>
          <SettingsNumber label="Minimum confluence score" value={settings.minScore} min={0} max={100} step={1} suffix="score" onChange={(value) => onChange({ minScore: value })} />
          <SettingsNumber label="Scan interval" value={settings.scanIntervalSeconds} min={5} max={300} step={1} suffix="seconds" onChange={(value) => onChange({ scanIntervalSeconds: value })} />
          <SettingsNumber label="Duplicate cooldown" value={settings.duplicateCooldownMinutes} min={0} max={1440} step={1} suffix="minutes" onChange={(value) => onChange({ duplicateCooldownMinutes: value })} />
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
                </label>
              ))}
            </div>
            <small>Pair nonaktif tetap tampil di data, tetapi tidak boleh auto-entry.</small>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-heading">
            <strong>Risk</strong>
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
          <SettingsNumber label="Risk value per order" value={settings.riskValue} min={0.01} step={0.01} suffix={riskModeSuffix(settings.riskMode)} onChange={(value) => onChange({ riskValue: value })} />
          <SettingsNumber label="Total risk cap" value={settings.maxTotalRiskPercent} min={0.1} max={100} step={0.1} suffix="%" onChange={(value) => onChange({ maxTotalRiskPercent: value })} />
          <div className="settings-risk-preview">
            <Metric label="Total risk" value={`${formatPercent(exposure?.totalRiskPercent)} / ${formatPercent(autoMode?.maxTotalRiskPercent ?? 20)}`} />
            <Metric label="Available" value={formatPercent(exposure?.availableRiskPercent)} />
            <Metric label="Open risk items" value={`${exposure?.items?.length ?? 0}`} />
          </div>
        </section>

        <section className="settings-card settings-guide">
          <div className="settings-card-heading">
            <strong>Execution rules</strong>
            <span>{settingsDirty ? "Unsaved" : "Synced"}</span>
          </div>
          <div className="settings-rule-list">
            <span>M15, M30, H1 = execution timeframe</span>
            <span>H4, D1 = monitor/context only</span>
            <span>Lot max per position tetap 0.10</span>
            <span>Auto trailing aktif saat floating profit {">="} $10</span>
            <span>Pair aktif auto-entry: {formatActiveSymbols(settings.activeSymbols)}</span>
          </div>
        </section>
      </div>

      <div className="settings-actions">
        <button className="summary-refresh" onClick={onSave}>Save settings</button>
        <button className="settings-secondary" onClick={onReset}>Reset form</button>
      </div>
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
          <small>Auto trailing starts once floating profit reaches $10; SL then follows peak price.</small>
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
