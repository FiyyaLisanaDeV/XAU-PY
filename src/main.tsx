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
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Layers, Maximize2, Minimize2, PlugZap, ShieldCheck, TrendingUp } from "lucide-react";
import "./styles.css";

type SymbolName = "XAUUSD" | "GBPUSD" | "EURUSD";
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
  terminal_found: boolean;
  account_login: number | null;
  server: string | null;
  equity: number;
  balance: number;
  currency: string;
  message: string;
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
  riskValue: number;
  riskPercent: number | null;
  score: number;
  setupType: string;
  reasons: string[];
  blockedReasons: string[];
}

interface HistoryItem {
  time: string;
  symbol: SymbolName;
  timeframe: Timeframe;
  score: number;
  action: string;
  status: string;
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
const symbols: SymbolName[] = ["XAUUSD", "GBPUSD", "EURUSD"];
const timeframes: Timeframe[] = ["M15", "M30", "H1", "H4", "D1"];
const spreadLimits: Record<SymbolName, number> = {
  XAUUSD: 350,
  GBPUSD: 18,
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

function App() {
  const [symbol, setSymbol] = React.useState<SymbolName>("XAUUSD");
  const [timeframe, setTimeframe] = React.useState<Timeframe>("H1");
  const [riskMode, setRiskMode] = React.useState<RiskMode>("percent_equity");
  const [riskValue, setRiskValue] = React.useState(0.5);
  const [status, setStatus] = React.useState<Status | null>(null);
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [watchSnapshots, setWatchSnapshots] = React.useState<Partial<Record<SymbolName, Snapshot>>>({});
  const [ticks, setTicks] = React.useState<Partial<Record<SymbolName, MarketTick>>>({});
  const [indicators, setIndicators] = React.useState(defaultIndicators);
  const [priceContextFullscreen, setPriceContextFullscreen] = React.useState(false);
  const [signal, setSignal] = React.useState<Signal | null>(null);
  const [history, setHistory] = React.useState<HistoryItem[]>([]);
  const [calendar, setCalendar] = React.useState<EconomicCalendarResponse | null>(null);
  const [signalLog, setSignalLog] = React.useState<SignalLogEntry[]>([]);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const tickRequestId = React.useRef(0);

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
    const [nextStatus, nextSignal, nextHistory, nextCalendar, nextSignalLog, activeSnapshot, watchResults] = await Promise.all([
      fetchJson<Status>(`${API_BASE}/api/status`),
      fetchJson<Signal>(`${API_BASE}/api/signals?${query}&riskMode=${riskMode}&riskValue=${safeRiskValue}`),
      fetchJson<HistoryItem[]>(`${API_BASE}/api/history`),
      fetchJson<EconomicCalendarResponse>(`${API_BASE}/api/economic-calendar`, { cache: "no-store" }),
      fetchJson<SignalLogEntry[]>(`${API_BASE}/api/signal-log?limit=80`, { cache: "no-store" }),
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
    setCalendar(nextCalendar);
    setSignalLog(nextSignalLog);
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

  React.useEffect(() => {
    refresh().catch(() => setToast("Backend belum aktif. Jalankan FastAPI di port 8000."));
  }, [refresh]);

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

  const mt5BlockedReason = status?.connected ? null : "MT5 is offline";
  const scoreWarningReasons = signal?.blockedReasons.filter((reason) => reason === SCORE_BLOCK_REASON) ?? [];
  const riskGuardReason = signal?.riskPercent !== null && signal?.riskPercent !== undefined && signal.riskPercent > 0.5 ? "Risk exceeds 0.5% maximum" : null;
  const hardBlockedReasons = uniqueStrings([
    ...(signal?.blockedReasons.filter((reason) => reason !== SCORE_BLOCK_REASON) ?? []),
    ...(riskGuardReason ? [riskGuardReason] : []),
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
        riskValue: sanitizeRiskValue(riskValue),
        lot: signal.lot,
        confirmed: true
      })
    });
    const payload = await res.json();
    setConfirmOpen(false);
    setToast(payload.message ?? "Order response received.");
    refresh().catch(() => undefined);
  }

  return (
    <main className="app-shell">
      <TopBar status={status} symbol={symbol} timeframe={timeframe} onSymbol={setSymbol} onTimeframe={setTimeframe} onRefresh={refresh} />
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
      </section>
      <HistoryTable items={history} />
      <SignalLogTable items={signalLog} />
      <EconomicCalendarBox calendar={calendar} activeSymbol={symbol} />
      {confirmOpen && signal && snapshot && (
        <ConfirmModal
          signal={signal}
          spread={snapshot.spread_points}
          scoreWarningReasons={scoreWarningReasons}
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
  symbol,
  timeframe,
  onSymbol,
  onTimeframe,
  onRefresh
}: {
  status: Status | null;
  symbol: SymbolName;
  timeframe: Timeframe;
  onSymbol: (value: SymbolName) => void;
  onTimeframe: (value: Timeframe) => void;
  onRefresh: () => void;
}) {
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
      <div className={`connection ${status?.connected ? "connected" : "offline"}`} title={status?.message}>
        <PlugZap size={16} />
        <span>{status?.connected ? "MT5 Connected" : "MT5 Offline"}</span>
      </div>
      <div className="demo-chip">
        <ShieldCheck size={15} />
        Demo first
      </div>
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
  riskValue: number;
  spreadPoints: number | null;
  symbol: SymbolName;
  hardBlockedReasons: string[];
  scoreWarningReasons: string[];
  onRiskMode: (mode: RiskMode) => void;
  onRiskValue: (value: number) => void;
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
          type="number"
          min="0.01"
          step="0.01"
          value={riskValue}
          onChange={(event) => {
            const nextValue = Number(event.target.value);
            if (Number.isFinite(nextValue) && nextValue > 0) {
              onRiskValue(nextValue);
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
      <p className="fine-print">One relevant action only. Confirmation modal is required before MT5 order send.</p>
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

function sanitizeRiskValue(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0.01;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
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
  return (
    <section className="signal-log">
      <div className="signal-log-heading">
        <div>
          <span className="panel-title">Potential signals data</span>
          <h2>Score 60+ signal capture</h2>
        </div>
        <span className="capture-pill">Auto scan 60s</span>
      </div>
      <p className="signal-log-note">
        Semua potensi sinyal dengan confluence score minimal 60 dicatat untuk dataset strategi, termasuk hari, tanggal, jam, market, timeframe, setup,
        entry, SL, TP, spread, dan status validasi.
      </p>
      {items.length > 0 ? (
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
            {items.map((item) => (
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
      ) : (
        <div className="signal-log-empty">
          Belum ada sinyal score 60+ yang tercatat. Backend akan otomatis menyimpan data saat scan menemukan peluang valid atau blocked dengan score
          minimal 60.
        </div>
      )}
    </section>
  );
}

function EconomicCalendarBox({ calendar, activeSymbol }: { calendar: EconomicCalendarResponse | null; activeSymbol: SymbolName }) {
  const relevantEvents = React.useMemo(() => {
    const events = calendar?.events ?? [];
    return events.filter((event) => event.affected_symbols.includes(activeSymbol)).slice(0, 8);
  }, [activeSymbol, calendar]);

  return (
    <section className="economic-calendar">
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
  onCancel,
  onConfirm
}: {
  signal: Signal;
  spread: number;
  scoreWarningReasons: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const hasScoreWarning = scoreWarningReasons.length > 0;
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <h2>Confirm MT5 execution</h2>
        <p>
          {hasScoreWarning
            ? "Score setup belum mendukung filter strategi. Review detail order dan konfirmasi hanya jika tetap ingin eksekusi manual ke demo terminal."
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
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className={`confirm-button ${hasScoreWarning ? "warning" : ""}`} onClick={onConfirm}>
            {hasScoreWarning ? "Confirm Execute Anyway" : "Confirm Execute"}
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
