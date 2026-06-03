import React from "react";
import ReactDOM from "react-dom/client";
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
    const tickRes = await fetch(`${API_BASE}/api/market/ticks`, { cache: "no-store" });
    const nextTicks = (await tickRes.json()) as Partial<Record<SymbolName, MarketTick>>;
    if (requestId === tickRequestId.current) {
      setTicks(nextTicks);
    }
  }, []);

  const refresh = React.useCallback(async () => {
    const query = `symbol=${symbol}&timeframe=${timeframe}`;
    const [statusRes, signalRes, historyRes, calendarRes, signalLogRes, activeSnapshotRes, watchResults] = await Promise.all([
      fetch(`${API_BASE}/api/status`),
      fetch(`${API_BASE}/api/signals?${query}&riskMode=${riskMode}&riskValue=${riskValue}`),
      fetch(`${API_BASE}/api/history`),
      fetch(`${API_BASE}/api/economic-calendar`, { cache: "no-store" }),
      fetch(`${API_BASE}/api/signal-log?limit=80`, { cache: "no-store" }),
      fetch(`${API_BASE}/api/market/snapshot?${query}`, { cache: "no-store" }),
      Promise.all(
        symbols.map(async (item) => {
          const res = await fetch(`${API_BASE}/api/market/snapshot?symbol=${item}&timeframe=${timeframe}`, { cache: "no-store" });
          return [item, (await res.json()) as Snapshot] as const;
        })
      )
    ]);
    const nextWatchSnapshots = Object.fromEntries(watchResults) as Partial<Record<SymbolName, Snapshot>>;
    setStatus(await statusRes.json());
    setWatchSnapshots(nextWatchSnapshots);
    setSnapshot(await activeSnapshotRes.json());
    setSignal(await signalRes.json());
    setHistory(await historyRes.json());
    setCalendar(await calendarRes.json());
    setSignalLog(await signalLogRes.json());
    await refreshTicks();
  }, [refreshTicks, riskMode, riskValue, symbol, timeframe]);

  const scanPotentialSignals = React.useCallback(async () => {
    await fetch(`${API_BASE}/api/signals/scan?riskMode=${riskMode}&riskValue=${riskValue}`, {
      method: "POST",
      cache: "no-store"
    });
    const signalLogRes = await fetch(`${API_BASE}/api/signal-log?limit=80`, { cache: "no-store" });
    setSignalLog(await signalLogRes.json());
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
  const executable = Boolean(status?.connected && signal && signal.blockedReasons.length === 0 && signal.orderType && signal.lot);
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
        riskValue,
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
          mt5BlockedReason={mt5BlockedReason}
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
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const candles = snapshot?.candles.slice(-64) ?? [];
  if (!snapshot || candles.length === 0) return <div className="chart-empty">Waiting for market data</div>;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const livePrice = tick?.mid ?? (snapshot.bid + snapshot.ask) / 2;
  const max = Math.max(...highs, livePrice);
  const min = Math.min(...lows, livePrice);
  const height = 310;
  const width = 680;
  const y = (price: number) => height - ((price - min) / (max - min || 1)) * height;
  const step = width / candles.length;
  const hovered = hoverIndex !== null ? candles[hoverIndex] : candles[candles.length - 1];
  const hoverX = hoverIndex !== null ? hoverIndex * step + step / 2 : width - step / 2;
  const priceLevels = [max, max - (max - min) * 0.25, max - (max - min) * 0.5, max - (max - min) * 0.75, min];

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const index = Math.max(0, Math.min(candles.length - 1, Math.round((x - step / 2) / step)));
    setHoverIndex(index);
  }

  return (
    <div className="chart-wrap">
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${snapshot.symbol} candlestick chart`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {priceLevels.map((price) => (
          <g key={price}>
            <line x1="0" x2={width} y1={y(price)} y2={y(price)} className="grid-line" />
            <text x={width - 4} y={y(price) - 4} className="price-axis">
              {formatPrice(price)}
            </text>
          </g>
        ))}
        {indicators.supportResistance &&
          snapshot.zones
            .filter((zone) => zone.kind === "SNR")
            .slice(0, 3)
            .map((zone) => (
              <g key={`${zone.kind}-${zone.label}`}>
                <rect x="0" width={width} y={y(zone.high)} height={Math.max(5, y(zone.low) - y(zone.high))} className={`zone zone-${zone.kind.toLowerCase()}`} />
                <text x="8" y={y(zone.high) + 13} className="zone-label">
                  S/R {zone.strength}/5
                </text>
              </g>
            ))}
        {indicators.supplyDemand &&
          snapshot.zones
            .filter((zone) => zone.kind === "SND")
            .slice(0, 3)
            .map((zone) => (
              <g key={`${zone.kind}-${zone.label}`}>
                <rect x="0" width={width} y={y(zone.high)} height={Math.max(5, y(zone.low) - y(zone.high))} className={`zone zone-${zone.kind.toLowerCase()}`} />
                <text x="8" y={y(zone.high) + 13} className="zone-label snd-label">
                  S/D {zone.strength}/5
                </text>
              </g>
            ))}
        {indicators.fib &&
          snapshot.zones
            .filter((zone) => zone.kind === "FIB")
            .map((zone) => (
              <g key={`${zone.kind}-${zone.label}`}>
                <rect x="0" width={width} y={y(zone.high)} height={Math.max(5, y(zone.low) - y(zone.high))} className="zone zone-fib" />
                <text x="8" y={y(zone.high) + 13} className="zone-label fib-label">
                  Fib 61.8
                </text>
              </g>
            ))}
        {candles.map((candle, idx) => {
          const x = idx * step + step / 2;
          const bullish = candle.close >= candle.open;
          const bodyTop = y(Math.max(candle.open, candle.close));
          const bodyHeight = Math.max(2, Math.abs(y(candle.open) - y(candle.close)));
          return (
            <g key={`${candle.time}-${idx}`} className={bullish ? "candle bullish" : "candle bearish"}>
              <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} />
              <rect x={x - 3.2} y={bodyTop} width="6.4" height={bodyHeight} rx="1.2" />
            </g>
          );
        })}
        {indicators.ema ? (
          <>
            <PathLine values={snapshot.indicators.ema_fast.slice(-64)} min={min} max={max} width={width} height={height} className="ema-fast" />
            <PathLine values={snapshot.indicators.ema_slow.slice(-64)} min={min} max={max} width={width} height={height} className="ema-slow" />
          </>
        ) : null}
        {indicators.ma ? (
          <>
            <PathLine values={snapshot.indicators.ma_fast.slice(-64)} min={min} max={max} width={width} height={height} className="ma-fast" />
            <PathLine values={snapshot.indicators.ma_slow.slice(-64)} min={min} max={max} width={width} height={height} className="ma-slow" />
          </>
        ) : null}
        {indicators.live ? (
          <g>
            <line x1="0" x2={width} y1={y(livePrice)} y2={y(livePrice)} className="live-price-line" />
            <text x={width - 94} y={Math.max(14, y(livePrice) - 7)} className="live-price-label">
              Live {formatPrice(livePrice)}
            </text>
          </g>
        ) : null}
        {hovered ? (
          <g className="crosshair">
            <line x1={hoverX} x2={hoverX} y1="0" y2={height} />
            <line x1="0" x2={width} y1={y(hovered.close)} y2={y(hovered.close)} />
          </g>
        ) : null}
      </svg>
      {hovered ? (
        <div className="chart-tooltip">
          <strong>{formatDateLabel(hovered.time)}</strong>
          <span>O {formatPrice(hovered.open)}</span>
          <span>H {formatPrice(hovered.high)}</span>
          <span>L {formatPrice(hovered.low)}</span>
          <span>C {formatPrice(hovered.close)}</span>
        </div>
      ) : null}
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

function PathLine({ values, min, max, width, height, className }: { values: number[]; min: number; max: number; width: number; height: number; className: string }) {
  const step = width / values.length;
  const points = values
    .map((value, idx) => {
      const x = idx * step + step / 2;
      const y = height - ((value - min) / (max - min || 1)) * height;
      return `${x},${y}`;
    })
    .join(" ");
  return <polyline className={className} points={points} fill="none" />;
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
  mt5BlockedReason,
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
  mt5BlockedReason: string | null;
  onRiskMode: (mode: RiskMode) => void;
  onRiskValue: (value: number) => void;
  executable: boolean;
  executeLabel: string;
  onExecute: () => void;
}) {
  const blocked = [...(signal?.blockedReasons ?? []), ...(mt5BlockedReason ? [mt5BlockedReason] : [])];
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
        <input type="number" min="0.01" step="0.01" value={riskValue} onChange={(event) => onRiskValue(Number(event.target.value))} />
      </div>
      {blocked.length > 0 && (
        <div className="blocked-box">
          {blocked.map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </div>
      )}
      {executable ? (
        <button className="execute-button" onClick={onExecute}>
          {executeLabel}
        </button>
      ) : (
        <div className="no-execute">No executable order until signal and risk checks pass.</div>
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

function ConfirmModal({ signal, spread, onCancel, onConfirm }: { signal: Signal; spread: number; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <h2>Confirm MT5 execution</h2>
        <p>Review the single recommended order before sending it to the connected demo terminal.</p>
        <div className="confirm-grid">
          <Metric label="Symbol" value={signal.symbol} />
          <Metric label="Order" value={signal.orderType?.replace("_", " ") ?? "--"} />
          <Metric label="Lot" value={signal.lot?.toFixed(2) ?? "--"} />
          <Metric label="Entry" value={formatPrice(signal.entry)} />
          <Metric label="SL" value={formatPrice(signal.stopLoss)} />
          <Metric label="TP" value={formatPrice(signal.takeProfit)} />
          <Metric label="Risk" value={`${signal.riskPercent ?? 0}%`} />
          <Metric label="Spread" value={`${spread} pts`} />
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="confirm-button" onClick={onConfirm}>
            Confirm Execute
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
