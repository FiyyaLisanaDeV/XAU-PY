# XAUGBPEUUSD Strategy App

Local strategy dashboard for `XAUUSD` and `EURUSD` with Exness MT5 integration.

The app is demo-first and uses mandatory confirmation before order execution. When MT5 is not installed or not connected, the backend serves mock market data for UI/strategy development and blocks real execution.

## Stack

- Frontend: React + Vite
- Backend: FastAPI
- Trading bridge: optional `MetaTrader5` Python package with local Exness MT5 terminal

## Setup

```powershell
npm install
python -m pip install -r requirements.txt
```

If the `MetaTrader5` Python package does not support the default Python version, install a compatible Python version and install `MetaTrader5` there.

## Run

Terminal 1:

```powershell
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 9000
```

Terminal 2:

```powershell
npm run dev
```

Open `http://127.0.0.1:5174`.

## MT5 Execution Requirements

1. Install Exness MT5 locally.
2. Log in to an Exness demo account first.
3. Enable Algo Trading in MT5.
4. Install the `MetaTrader5` Python package in a compatible Python environment.
5. Optionally set `MT5_TERMINAL_PATH` if the terminal is not auto-detected.

The app blocks execution when:

- MT5 is offline.
- The user has not confirmed the modal.
- Risk exceeds `0.5%`.
- Lot exceeds `0.10`; backend caps calculated and outgoing MT5 volume to `0.10` per position.
- Entry, SL, or TP are invalid.
- The signal has no valid single recommended order.

Open positions are monitored while the backend is active. Any position with floating profit `>= $10` is checked every second and closed immediately by the backend as auto take profit.

## Economic Calendar

The dashboard includes an Economic Events box powered by MQL5 Calendar exports.

The Python `MetaTrader5` package does not expose the MQL5 calendar functions directly, so real event data must be exported from MetaTrader 5 using the script in `mql5/ExportEconomicCalendar.mq5`.

Expected backend file:

```text
data/economic_calendar.json
```

Setup:

1. Open MetaEditor from MetaTrader 5.
2. Add and compile `mql5/ExportEconomicCalendar.mq5`.
3. Run it manually or schedule it with an EA/timer.
4. Refresh the app; `/api/economic-calendar` will load USD, GBP, and EUR events.

MQL5 calendar docs: https://www.mql5.com/en/docs/calendar

## Potential Signal Dataset

The backend records every scanned signal with confluence score `>= 60` to:

```text
data/potential_signals.jsonl
```

Each row includes detection date, day, time, symbol, timeframe, score, setup type, side/order type, entry, SL, TP, lot, risk percent, spread, reasons, and blocked reasons. The frontend runs `/api/signals/scan` every 60 seconds across `XAUUSD`, `EURUSD` and `M15`, `M30`, `H1`, `H4`, `D1`, then displays the newest rows in the Potential Signals Data table. Duplicate matching signals are suppressed for 30 minutes.

## Verification

```powershell
npm run build
python -m pytest backend/tests
```
