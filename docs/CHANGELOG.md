# Change Log

## 2026-06-11

### Added

- Added Simple and Advanced Settings modes, including Conservative, Opportunistic, High Risk, and Custom configuration classification.
- Added backend-authoritative profile normalization so Simple-mode presets cannot drift from their documented risk and strategy limits.
- Added an Indonesian `Penjelasan Setting` page with profile guidance, market-condition behavior, parameter definitions, and decision examples.
- Added live market-regime classification for trending, sideways, choppy, low/high volatility, news shock, and uncertain conditions across every pair and timeframe.
- Added configurable per-pair regime enforcement, allowed conditions, and separate confluence thresholds for trending, sideways, and volatile markets.
- Redesigned the Settings page into focused General, Pair Profiles, Exit & Trailing, and Recovery workspaces with live context, clearer switches, exposure summaries, and a sticky save state.
- Added the AFPL v8 license, copyright notice, AI usage policy, repository agent policy, package license metadata, and an in-app copyright footer.
- Added a live `Strategy System` parameter-check page covering runtime health, pair profiles, strategy components, risk limits, exposure, pair state, market data, confluence, signal logger, and decision audit.
- Added config v2 pair profiles with automatic backup, atomic migration, rollback-safe shadow mode, and persistent pair state.
- Added strict EURUSD Market Fact Gate, fresh Investing M15/M30/H1 validation, Fibonacci pivot guard, news guard, cooldown/loss locks, closed-candle confirmation, and signal expiry.
- Added EURUSD 10-30 pip ATR stop clamp, 1.6R target, and configurable pip-based break-even/trailing.
- Added XAUUSD aggregate SL exposure calculation including open positions, pending orders, and candidate orders, with pair-level execution locking.
- Added pair exposure API/cards, close-only controls, all-pair position cap, signal audit log, and a 1,500-candidate exposure safety simulation.
- Added manual `USD / USC` account mode with `100 USC = 1 USD`.
- Added USC-aware hard TP, trailing trigger, hedge target, basket target, emergency loss cap, and equity-risk conversion.
- Added USC labels across account summary, pair performance, and open-position P/L.
- Added explicit Standard USD / USC Cent selection cards in Settings.
- Added a dynamic minimum-balance calculator using current execution-timeframe SL distance, `0.01` lot, the `0.5%` position-risk guard, and a `25%` reserve.
- Added optional bounded martingale hedge recovery, disabled by default.
- Added completed-candle M15/M30 reversal scoring and original-direction recovery confirmation.
- Added persisted recovery phases: `NORMAL`, `HEDGE_ACTIVE`, `WAIT_RECOVERY`, `RECOVERY_ACTIVE`, `BASKET_EXIT`, and `EMERGENCY_EXIT`.
- Added configurable hedge ratio, hedge profit targets, recovery multiplier, maximum layers, cooldown, shock threshold, basket targets, and emergency loss caps.
- Added `GET /api/recovery/status` and `POST /api/recovery/scan-now`.
- Added Summary recovery status and complete recovery controls on the Settings page.
- Added backend tests for reversal detection, hedge exit, recovery entry, lot cap, and basket-safe hard TP behavior.

### Safety

- Recovery positions use MT5 comments so they remain separate from ordinary strategy positions.
- Hedge and recovery orders remain capped at `0.10` lot.
- Recovery orders still pass spread, stop-loss, per-order risk, total exposure, MT5 readiness, and demo guard checks.
- Per-position hard TP and trailing are paused while a pair recovery basket is active.
- Recovery engine state survives backend restarts in `data/recovery_state.json`.

## 2026-06-05

### Added

- Added live backend mode on port `9000`.
- Added frontend serving on port `5174`.
- Added Full Auto status, settings, scan-now endpoint, and backend monitor.
- Added active pair control for `XAUUSD` and `EURUSD`.
- Removed `GBPUSD` from active strategy pair coverage.
- Added total risk cap support with default `20%`.
- Added max lot cap of `0.10` per position.
- Added auto trailing monitor that starts moving SL after floating profit `>= $10`.
- Added account summary dashboard:
  - P/L Total.
  - P/L Daily.
  - Current Position P/L.
  - Daily target progress.
  - Open positions.
  - Profit factor.
  - Pair-level winning and losing trade stats.
- Added close-all controls:
  - Close all winning trades.
  - Close all losing trades.
  - Close all open trades.
- Added local dashboard data reset baseline.
- Added Investing.com technical sync:
  - `XAUUSD` technical data.
  - `EURUSD` technical data.
  - Auto sync every `60 seconds`.
  - Manual sync endpoint.
  - Cache and fail-safe strategy blocking.
- Added Investing.com timeframe signal parsing:
  - `15m`, `30m`, `1h`, `5h`, `1d`, `1w`, `1mo`.
  - App mapping for `M15`, `M30`, `H1`, `H4`, `D1`.
- Added Fibonacci pivot level view:
  - `S3`, `S2`, `S1`, `PIVOT`, `R1`, `R2`, `R3`.
  - Support/Pivot/Resistance formatting.
  - Source labeling for pivot page or technical fallback.
- Added `/api/ea/status` endpoint for MT5 EA health checks.
- Added backend health and restart endpoints.
- Added local launcher scripts:
  - `launch-app.ps1`
  - `start-backend-9000.cmd`
  - `start-frontend-5174.cmd`
  - `scripts/start-live.py`
  - `scripts/serve-dist-proxy.cjs`
- Added documentation:
  - README quick-start and system overview.
  - Feature catalog.
  - Strategy and risk guide.
  - Decision guide.

### Changed

- Changed Vite dev port from `5173` to `5174`.
- Changed backend API target from `8000` to `9000`.
- Updated UI from a chart-first workspace toward account summary, settings, and Investing data pages.
- Updated trading journal logic so P/L Total uses closed trades from baseline onward.
- Updated P/L Daily logic so it only counts trades closed today.
- Updated Full Auto to execute only on `M15`, `M30`, and `H1`.
- Updated `H4` and `D1` to monitor/context use only.
- Updated economic calendar affected symbols after removing `GBPUSD`.
- Updated risk validation and tests for total exposure, pending orders, and max lot cap.
- Updated Investing pivot display to hide raw scraper rows and show user-readable trading levels.

### Fixed

- Fixed backend port mismatch that caused EA requests to hit `8000` while backend was live on `9000`.
- Fixed reset behavior by creating a local journal baseline instead of relying only on in-memory cache clearing.
- Fixed trailing monitor so it runs in the backend loop and does not depend on frontend refresh.
- Fixed stale UI confusion by exposing backend health and MT5 trade readiness in the top summary.
- Fixed Investing page readability by separating sync status, timeframe confirmation, technical bias, and pivot levels.

### Notes

- Runtime data files are ignored by Git:
  - `data/investing_*.json`
  - `data/reset_state.json`
  - `data/potential_signals.jsonl`
  - `.tmp/`
- The app still depends on local MT5 state for real execution.
- Investing.com can lock some short timeframes, especially `5m` and `15m`; locked data is shown as locked and not treated as a valid fresh signal.
