# Feature Catalog

This page lists the main user-facing and backend features in the XAU-PY trading dashboard.

## Account Summary

| Feature | Description |
| --- | --- |
| P/L Total | Realized closed-trade P/L from the reset baseline onward |
| P/L Daily | Realized closed-trade P/L for today only, using local day grouping |
| Current Position P/L | Floating P/L from open MT5 positions |
| Daily Target | Shows progress toward a 10% daily account target |
| Open Positions | Count of open positions, split into winning and losing |
| Profit Factor | Gross winning P/L divided by gross losing P/L |
| Pair Performance | Winning/losing count and nominal account unit per pair |

## USD And USC Account Modes

The Settings page supports:

| Mode | Conversion | Use |
| --- | --- | --- |
| `USD` | `1 account unit = 1 USD` | standard account |
| `USC` | `100 USC = 1 USD` | Exness cent account |

In USC mode:

- Balance, equity, floating P/L, realized P/L, and journal values display as USC.
- Hard TP `$10` is compared to `1,000 USC`.
- Hedge and basket USD targets are multiplied by `100` before comparison.
- Broker equity is divided by `100` before percent-equity and total-risk calculations.
- Account mode cannot change during an active hedge/recovery basket.

## Position Controls

| Control | Behavior |
| --- | --- |
| Close winning trades | Closes currently open positions with floating profit `>= $10` |
| Close all losing trades | Closes currently open positions with floating profit below zero |
| Close all open trades | Closes every open position after confirmation |
| Hard TP | Backend sends a market close as soon as floating profit reaches `>= $10` |
| Auto trailing status | Shows tracked tickets, active trailing tickets, and XAUUSD/EURUSD trailing rules |
| Reset all data | Resets local dashboard baseline without deleting broker history or closing positions |
| Restart all services | Restarts backend and starts frontend on `5174` if it is not running |

## Full Auto

Full Auto can send orders automatically when all safety checks pass.

| Setting | Default |
| --- | --- |
| Enabled | user controlled |
| Active pairs | `XAUUSD`, `EURUSD` |
| Minimum score | `60` |
| Scan interval | `15 seconds` |
| Duplicate cooldown | `10 minutes` |
| XAUUSD Hard TP | configurable USD amount, default `$10` |
| EURUSD Hard TP | configurable USD amount, default `$10` |
| Risk mode | `percent_equity` |
| Risk value | `0.5` |
| Total risk cap | `20%` |
| Bounded hedge recovery | `OFF` by default |

## Bounded Hedge Recovery

When enabled together with Full Auto, the backend checks reversal conditions every `5 seconds`.

| Stage | Behavior |
| --- | --- |
| `NORMAL` | monitors completed M15 and M30 candles |
| `HEDGE_ACTIVE` | opens one partial opposite hedge when reversal score reaches the configured threshold |
| `WAIT_RECOVERY` | closes a profitable hedge and waits for the original direction to confirm |
| `RECOVERY_ACTIVE` | opens a same-direction recovery layer with a bounded multiplier |
| `BASKET_EXIT` | closes the pair basket when combined P/L reaches target |
| `EMERGENCY_EXIT` | closes the pair basket at the configured maximum loss |

Safety limits:

- Hedge ratio is limited to `10-70%`.
- Recovery multiplier is limited to `1.00-1.50x`.
- Recovery layers are limited to `0-2`.
- Every hedge/recovery position remains capped at `0.10` lot.
- Spread, per-order risk, total risk, MT5 readiness, and demo guard still apply.
- Per-position hard TP is suspended while a recovery basket is active; basket target controls the coordinated exit.
- Recovery state persists in `data/recovery_state.json`.

Full Auto only executes on:

```text
M15, M30, H1
```

It monitors but does not execute on:

```text
H4, D1
```

## Active Pair Switches

The Settings page can enable or disable auto-entry by pair.

| Pair | Can be displayed | Can be auto-traded |
| --- | --- | --- |
| `XAUUSD` | yes | only if enabled |
| `EURUSD` | yes | only if enabled |

If a pair is disabled, it can still appear in data tables, but strategy execution is blocked for that pair.

## Investing.com Data Page

The Investing page shows one section per pair.

| Section | Purpose |
| --- | --- |
| Sync card | Shows sync status, cache age, parser status, strategy use, retry count |
| Confirmation snapshot | Shows overall bias, selected Investing timeframe, last sync, pivot source |
| Technical bias | Shows overall, moving-average, and indicator bias |
| Timeframe map | Shows Investing timeframe signals and which app timeframe uses each signal |
| Technical indicators | RSI, Stoch, ADX, CCI, ATR, ROC, and other parsed values |
| Moving averages | MA/MACD signals from Investing |
| Fibonacci pivot levels | Clean `S3/S2/S1/PIVOT/R1/R2/R3` support/resistance table |

## Investing Timeframe Coverage

| Investing tab | Stored | Used by app |
| --- | --- | --- |
| `5m` | yes when visible | not mapped |
| `15m` | yes when visible | `M15` |
| `30m` | yes | `M30` |
| `1h` | yes | `H1` |
| `5h` | yes | `H4` |
| `1d` | yes | `D1` |
| `1w` | yes | monitoring only |
| `1mo` | yes | monitoring only |

## Backend Monitoring

| Monitor | Interval | Behavior |
| --- | --- | --- |
| Position profit monitor | `1 second` | closes at hard TP `$10`; trailing remains secondary |
| Hedge recovery monitor | `5 seconds` | detects reversal, manages partial hedge/recovery, and enforces basket exits |
| Full Auto strategy monitor | configurable, default `15 seconds` | scans and executes if valid |
| Investing sync monitor | `60 seconds` | refreshes Investing technical data for all active source symbols |

## Service Recovery

The frontend has a `Restart all services` button for laptop startup recovery. It calls `POST /api/services/restart-all`, starts the frontend on port `5174` when needed, and schedules a backend restart on port `9000`.

## Safety Features

- Demo guard for non-demo account protection.
- MT5 connected and trade-ready checks.
- Spread limits.
- SL/TP direction validation.
- Lot capped at `0.10`.
- Total risk cap at `20%`.
- Duplicate auto-entry cooldown.
- Pending orders and open positions included in exposure.
- Missing stop loss blocks Full Auto exposure.
