from __future__ import annotations

import math
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from .models import AccountStatus, Candle, ExecuteOrderRequest, OpenPosition, OrderType, PendingOrder, Side, Symbol, Timeframe, TradingJournalEntry

try:
    import MetaTrader5 as mt5  # type: ignore
except Exception:  # pragma: no cover - depends on local terminal/Python version
    mt5 = None


TIMEFRAME_MINUTES: dict[Timeframe, int] = {
    "M15": 15,
    "M30": 30,
    "H1": 60,
    "H4": 240,
    "D1": 1440,
}

BASE_PRICE: dict[Symbol, float] = {
    "XAUUSD": 2348.0,
    "EURUSD": 1.084,
}

POINT_SIZE: dict[Symbol, float] = {
    "XAUUSD": 0.01,
    "EURUSD": 0.00001,
}
MAX_LOT_PER_POSITION = 0.10


class MT5Bridge:
    def __init__(self) -> None:
        self.demo_only = os.getenv("XAUGBPEUUSD_DEMO_ONLY", "true").lower() != "false"
        self._initialized = False
        self._symbol_map: dict[Symbol, str] = {}

    def set_demo_guard(self, enabled: bool) -> None:
        self.demo_only = enabled

    def initialize(self) -> bool:
        if mt5 is None:
            return False
        if self._initialized:
            return True
        path = os.getenv("MT5_TERMINAL_PATH")
        self._initialized = bool(mt5.initialize(path=path) if path else mt5.initialize())
        return self._initialized

    def status(self) -> AccountStatus:
        if mt5 is None:
            return AccountStatus(
                connected=False,
                demo_mode=True,
                demo_guard_enabled=self.demo_only,
                live_account=False,
                terminal_trade_allowed=False,
                account_trade_allowed=False,
                trade_ready=False,
                terminal_found=False,
                message="MetaTrader5 Python package or terminal is not available. Market data uses mock mode; execution is blocked.",
            )

        connected = self.initialize()
        if not connected:
            return AccountStatus(
                connected=False,
                demo_mode=True,
                demo_guard_enabled=self.demo_only,
                live_account=False,
                terminal_trade_allowed=False,
                account_trade_allowed=False,
                trade_ready=False,
                terminal_found=True,
                message="MetaTrader5 package is installed, but no Exness MT5 terminal session is connected.",
            )

        account = mt5.account_info()
        if account is None:
            return AccountStatus(
                connected=False,
                demo_mode=True,
                demo_guard_enabled=self.demo_only,
                live_account=False,
                terminal_trade_allowed=False,
                account_trade_allowed=False,
                trade_ready=False,
                terminal_found=True,
                message="MT5 initialized, but account info is unavailable. Log in to an Exness demo account.",
            )

        terminal = mt5.terminal_info()
        server = getattr(account, "server", None)
        demo_account = self._is_demo_account(account)
        terminal_trade_allowed = bool(getattr(terminal, "trade_allowed", False)) if terminal else False
        account_trade_allowed = bool(getattr(account, "trade_allowed", False))
        trade_ready = terminal_trade_allowed and account_trade_allowed
        guard_message = "Demo guard is ON." if self.demo_only else "Demo guard is OFF; live account execution is not blocked by the app."
        trade_message = "Trading is enabled." if trade_ready else "Trading is blocked because MT5 AutoTrading/Algo Trading is disabled."
        return AccountStatus(
            connected=True,
            demo_mode=demo_account,
            demo_guard_enabled=self.demo_only,
            live_account=not demo_account,
            terminal_trade_allowed=terminal_trade_allowed,
            account_trade_allowed=account_trade_allowed,
            trade_ready=trade_ready,
            terminal_found=True,
            account_login=getattr(account, "login", None),
            server=server,
            equity=float(getattr(account, "equity", 10000.0)),
            balance=float(getattr(account, "balance", 10000.0)),
            currency=getattr(account, "currency", "USD"),
            message=f"Connected to MT5. {guard_message} {trade_message}",
        )

    def fetch_candles(self, symbol: Symbol, timeframe: Timeframe, count: int = 120) -> list[Candle]:
        if mt5 is not None and self.initialize():
            broker_symbol = self.resolve_symbol(symbol)
            mt5_timeframe = self._map_timeframe(timeframe)
            rates = mt5.copy_rates_from_pos(broker_symbol, mt5_timeframe, 0, count) if broker_symbol else None
            if rates is not None and len(rates) > 0:
                return [
                    Candle(
                        time=datetime.fromtimestamp(int(row["time"]), tz=timezone.utc).isoformat(),
                        open=float(row["open"]),
                        high=float(row["high"]),
                        low=float(row["low"]),
                        close=float(row["close"]),
                        volume=int(row["tick_volume"]),
                    )
                    for row in rates
                ]
        return self._mock_candles(symbol, timeframe, count)

    def tick(self, symbol: Symbol) -> tuple[float, float, float]:
        if mt5 is not None and self.initialize():
            broker_symbol = self.resolve_symbol(symbol)
            tick = mt5.symbol_info_tick(broker_symbol) if broker_symbol else None
            info = mt5.symbol_info(broker_symbol) if broker_symbol else None
            if tick is not None and info is not None:
                point = float(getattr(info, "point", POINT_SIZE[symbol]))
                bid = float(tick.bid)
                ask = float(tick.ask)
                if bid > 0 and ask > 0:
                    return bid, ask, round((ask - bid) / point, 1)

        base = BASE_PRICE[symbol]
        point = POINT_SIZE[symbol]
        spread = 28.0 if symbol == "XAUUSD" else 12.0
        bid = base + math.sin(datetime.now().minute / 7) * point * 120
        ask = bid + spread * point
        return round(bid, 5), round(ask, 5), spread

    def has_real_market_data(self, symbol: Symbol, timeframe: Timeframe) -> bool:
        if mt5 is None or not self.initialize():
            return False
        broker_symbol = self.resolve_symbol(symbol)
        if broker_symbol is None:
            return False
        tick = mt5.symbol_info_tick(broker_symbol)
        rates = mt5.copy_rates_from_pos(broker_symbol, self._map_timeframe(timeframe), 0, 3)
        return bool(
            tick is not None
            and float(getattr(tick, "bid", 0.0)) > 0
            and float(getattr(tick, "ask", 0.0)) > 0
            and rates is not None
            and len(rates) >= 3
        )

    def resolve_symbol(self, symbol: Symbol) -> str | None:
        if mt5 is None or not self.initialize():
            return None
        cached = self._symbol_map.get(symbol)
        if cached:
            return cached

        candidates: list[str] = []
        exact = mt5.symbol_info(symbol)
        if exact is not None:
            candidates.append(symbol)

        for pattern in (f"{symbol}*", f"*{symbol}*"):
            matches = mt5.symbols_get(pattern)
            if matches:
                candidates.extend(match.name for match in matches)

        def score(name: str) -> tuple[int, int, int]:
            info = mt5.symbol_info(name)
            tick = mt5.symbol_info_tick(name)
            visible = 1 if info is not None and getattr(info, "visible", False) else 0
            live = 1 if tick is not None and float(getattr(tick, "bid", 0.0)) > 0 and float(getattr(tick, "ask", 0.0)) > 0 else 0
            suffix_penalty = len(name.replace(symbol, ""))
            return live, visible, -suffix_penalty

        unique_candidates = list(dict.fromkeys(candidates))
        unique_candidates.sort(key=score, reverse=True)
        for candidate in unique_candidates:
            info = mt5.symbol_info(candidate)
            if info is None:
                continue
            if not getattr(info, "visible", False):
                mt5.symbol_select(candidate, True)
            tick = mt5.symbol_info_tick(candidate)
            if tick is not None and float(getattr(tick, "bid", 0.0)) > 0 and float(getattr(tick, "ask", 0.0)) > 0:
                self._symbol_map[symbol] = candidate
                return candidate
        return None

    def send_order(self, order: ExecuteOrderRequest, fallback_lot: float | None = None) -> tuple[bool, int | None, str]:
        if mt5 is None or not self.initialize():
            return False, None, "MT5 is not connected; order was not sent."
        if self.demo_only:
            account = mt5.account_info()
            if not self._is_demo_account(account):
                return False, None, "Demo guard blocked execution on a non-demo account."
        terminal = mt5.terminal_info()
        account = mt5.account_info()
        if not bool(getattr(terminal, "trade_allowed", False)) or not bool(getattr(account, "trade_allowed", False)):
            return False, None, "MT5 trading is blocked. Enable Algo Trading/AutoTrading in the MT5 terminal and allow automated trading for the account."

        broker_symbol = self.resolve_symbol(order.symbol)
        if broker_symbol is None:
            return False, None, f"Broker symbol for {order.symbol} is unavailable."
        request = self._build_order_request(order, broker_symbol, fallback_lot)
        if request is None:
            return False, None, "MT5 order request could not be built from the selected setup."

        check = mt5.order_check(request)
        if check is None:
            return False, None, f"MT5 order_check returned no result. Last error: {mt5.last_error()}"
        check_retcode = getattr(check, "retcode", None)
        if check_retcode not in {0, 10008, 10009}:
            comment = getattr(check, "comment", None) or getattr(check, "retcode_external", None) or check_retcode
            return False, None, f"MT5 order_check blocked request: {comment}"

        result = mt5.order_send(request)
        if result is None:
            return False, None, f"MT5 order_send returned no result. Last error: {mt5.last_error()}"
        retcode = getattr(result, "retcode", None)
        ticket = getattr(result, "order", None) or getattr(result, "deal", None)
        ok = retcode in {10008, 10009}
        comment = getattr(result, "comment", None) or retcode
        if not ok:
            return False, None, f"MT5 order_send rejected request: {comment}"
        return True, int(ticket) if ticket else None, str(comment)

    def open_positions(self) -> list[OpenPosition]:
        if mt5 is None or not self.initialize():
            return []
        positions = mt5.positions_get()
        if not positions:
            return []
        mapped: list[OpenPosition] = []
        for position in positions:
            symbol = self._base_symbol(str(getattr(position, "symbol", "")))
            if symbol is None:
                continue
            side = Side.BUY if int(getattr(position, "type", 0)) == mt5.POSITION_TYPE_BUY else Side.SELL
            mapped.append(
                OpenPosition(
                    ticket=int(getattr(position, "ticket", 0)),
                    symbol=symbol,
                    broker_symbol=str(getattr(position, "symbol", "")),
                    side=side,
                    volume=float(getattr(position, "volume", 0.0)),
                    open_price=float(getattr(position, "price_open", 0.0)),
                    current_price=float(getattr(position, "price_current", 0.0)),
                    stopLoss=float(getattr(position, "sl", 0.0)) or None,
                    takeProfit=float(getattr(position, "tp", 0.0)) or None,
                    profit=float(getattr(position, "profit", 0.0)),
                    swap=float(getattr(position, "swap", 0.0)),
                    commission=float(getattr(position, "commission", 0.0)),
                    opened_at=datetime.fromtimestamp(int(getattr(position, "time", 0)), tz=timezone.utc).isoformat(),
                    comment=str(getattr(position, "comment", "")) or None,
                )
            )
        return mapped

    def pending_orders(self) -> list[PendingOrder]:
        if mt5 is None or not self.initialize():
            return []
        orders = mt5.orders_get()
        if not orders:
            return []
        mapped: list[PendingOrder] = []
        for order in orders:
            symbol = self._base_symbol(str(getattr(order, "symbol", "")))
            if symbol is None:
                continue
            order_type = self._base_order_type(int(getattr(order, "type", -1)))
            if order_type is None:
                continue
            side = Side.BUY if order_type in {OrderType.BUY_LIMIT, OrderType.BUY_STOP} else Side.SELL
            mapped.append(
                PendingOrder(
                    ticket=int(getattr(order, "ticket", 0)),
                    symbol=symbol,
                    broker_symbol=str(getattr(order, "symbol", "")),
                    side=side,
                    orderType=order_type,
                    volume=float(getattr(order, "volume_current", 0.0) or getattr(order, "volume_initial", 0.0)),
                    entry=float(getattr(order, "price_open", 0.0)),
                    stopLoss=float(getattr(order, "sl", 0.0)) or None,
                    takeProfit=float(getattr(order, "tp", 0.0)) or None,
                    created_at=datetime.fromtimestamp(int(getattr(order, "time_setup", 0)), tz=timezone.utc).isoformat(),
                    comment=str(getattr(order, "comment", "")) or None,
                )
            )
        return mapped

    def close_position(self, ticket: int | None = None, symbol: Symbol | None = None) -> tuple[bool, int | None, str, OpenPosition | None]:
        if mt5 is None or not self.initialize():
            return False, ticket, "MT5 is not connected; position was not closed.", None
        terminal = mt5.terminal_info()
        account = mt5.account_info()
        if not bool(getattr(terminal, "trade_allowed", False)) or not bool(getattr(account, "trade_allowed", False)):
            return False, ticket, "MT5 trading is blocked. Enable Algo Trading/AutoTrading in the MT5 terminal.", None
        positions = self.open_positions()
        selected = self._select_position(positions, ticket, symbol)
        if selected is None:
            return False, ticket, "No matching open position was found.", None

        tick = mt5.symbol_info_tick(selected.broker_symbol)
        info = mt5.symbol_info(selected.broker_symbol)
        if tick is None or info is None:
            return False, selected.ticket, "Live tick or symbol info is unavailable for closing.", selected
        digits = int(getattr(info, "digits", 5))
        close_type = mt5.ORDER_TYPE_SELL if selected.side == Side.BUY else mt5.ORDER_TYPE_BUY
        price = float(tick.bid) if selected.side == Side.BUY else float(tick.ask)
        request: dict[str, Any] = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": selected.broker_symbol,
            "volume": selected.volume,
            "type": close_type,
            "position": selected.ticket,
            "price": round(price, digits),
            "deviation": int(os.getenv("XAUGBPEUUSD_MT5_DEVIATION", "30")),
            "magic": int(os.getenv("XAUGBPEUUSD_MT5_MAGIC", "260603")),
            "comment": "XAUGBPEUUSD force close",
        }
        filling = self._select_filling_mode(info, is_market=True)
        if filling is not None:
            request["type_filling"] = filling
        result = mt5.order_send(request)
        if result is None:
            return False, selected.ticket, f"MT5 close returned no result. Last error: {mt5.last_error()}", selected
        retcode = getattr(result, "retcode", None)
        comment = getattr(result, "comment", None) or retcode
        if retcode not in {10008, 10009}:
            return False, selected.ticket, f"MT5 close rejected request: {comment}", selected
        return True, selected.ticket, str(comment), selected

    def apply_trailing_stop(self, ticket: int, trigger_pips: float, distance_pips: float, step_pips: float) -> tuple[bool, str, float | None, float | None, float | None]:
        if mt5 is None or not self.initialize():
            return False, "MT5 is not connected; trailing stop was not updated.", None, None, None
        terminal = mt5.terminal_info()
        account = mt5.account_info()
        if not bool(getattr(terminal, "trade_allowed", False)) or not bool(getattr(account, "trade_allowed", False)):
            return False, "MT5 trading is blocked. Enable Algo Trading/AutoTrading in the MT5 terminal.", None, None, None
        selected = self._select_position(self.open_positions(), ticket=ticket, symbol=None)
        if selected is None:
            return False, "No matching open position was found.", None, None, None
        info = mt5.symbol_info(selected.broker_symbol)
        tick = mt5.symbol_info_tick(selected.broker_symbol)
        if info is None or tick is None:
            return False, "Live tick or symbol info is unavailable for trailing stop.", selected.stopLoss, None, None

        point = float(getattr(info, "point", 0.0) or 0.0)
        digits = int(getattr(info, "digits", 5))
        if point <= 0:
            return False, "Symbol point metadata is invalid.", selected.stopLoss, None, None
        pip_size = self._pip_size(info)
        min_stop_points = float(getattr(info, "trade_stops_level", 0.0) or 0.0)
        distance_price = max(distance_pips * pip_size, min_stop_points * point)
        step_price = step_pips * pip_size
        current_price = float(tick.bid) if selected.side == Side.BUY else float(tick.ask)
        if selected.side == Side.BUY:
            profit_pips = (current_price - selected.open_price) / pip_size
        else:
            profit_pips = (selected.open_price - current_price) / pip_size
        profit_pips = round(profit_pips, 1)
        if profit_pips < trigger_pips:
            return False, f"Trailing trigger not reached: {profit_pips:g}/{trigger_pips:g} pips.", selected.stopLoss, None, profit_pips
        if selected.side == Side.BUY:
            candidate_sl = round(current_price - distance_price, digits)
            if candidate_sl <= selected.open_price:
                return False, "Trailing stop is not in profit yet.", selected.stopLoss, candidate_sl, profit_pips
            if selected.stopLoss is not None and candidate_sl <= selected.stopLoss:
                return False, "Existing stop loss is already tighter than this trailing stop.", selected.stopLoss, candidate_sl, profit_pips
            if selected.stopLoss is not None and candidate_sl - selected.stopLoss < step_price:
                return False, f"Trailing step not reached: need {step_pips:g} pips movement.", selected.stopLoss, candidate_sl, profit_pips
        else:
            candidate_sl = round(current_price + distance_price, digits)
            if candidate_sl >= selected.open_price:
                return False, "Trailing stop is not in profit yet.", selected.stopLoss, candidate_sl, profit_pips
            if selected.stopLoss is not None and candidate_sl >= selected.stopLoss:
                return False, "Existing stop loss is already tighter than this trailing stop.", selected.stopLoss, candidate_sl, profit_pips
            if selected.stopLoss is not None and selected.stopLoss - candidate_sl < step_price:
                return False, f"Trailing step not reached: need {step_pips:g} pips movement.", selected.stopLoss, candidate_sl, profit_pips

        request: dict[str, Any] = {
            "action": mt5.TRADE_ACTION_SLTP,
            "position": selected.ticket,
            "symbol": selected.broker_symbol,
            "sl": candidate_sl,
            "tp": selected.takeProfit or 0.0,
            "magic": int(os.getenv("XAUGBPEUUSD_MT5_MAGIC", "260603")),
            "comment": "XAUGBPEUUSD trailing stop",
        }
        result = mt5.order_send(request)
        if result is None:
            return False, f"MT5 trailing stop returned no result. Last error: {mt5.last_error()}", selected.stopLoss, candidate_sl, profit_pips
        retcode = getattr(result, "retcode", None)
        comment = getattr(result, "comment", None) or retcode
        if retcode not in {10008, 10009}:
            return False, f"MT5 trailing stop rejected request: {comment}", selected.stopLoss, candidate_sl, profit_pips
        return True, f"Trailing stop updated to {candidate_sl} at {profit_pips:g} pips profit.", selected.stopLoss, candidate_sl, profit_pips

    def modify_position_stop(self, ticket: int, stop_loss: float, take_profit: float | None = None) -> tuple[bool, str, float | None, float | None]:
        if mt5 is None or not self.initialize():
            return False, "MT5 is not connected; stop loss was not updated.", None, None
        terminal = mt5.terminal_info()
        account = mt5.account_info()
        if not bool(getattr(terminal, "trade_allowed", False)) or not bool(getattr(account, "trade_allowed", False)):
            return False, "MT5 trading is blocked. Enable Algo Trading/AutoTrading in the MT5 terminal.", None, None
        selected = self._select_position(self.open_positions(), ticket=ticket, symbol=None)
        if selected is None:
            return False, "No matching open position was found.", None, None
        info = mt5.symbol_info(selected.broker_symbol)
        if info is None:
            return False, "Symbol info is unavailable for stop loss update.", selected.stopLoss, None
        digits = int(getattr(info, "digits", 5))
        rounded_sl = round(stop_loss, digits)
        request: dict[str, Any] = {
            "action": mt5.TRADE_ACTION_SLTP,
            "position": selected.ticket,
            "symbol": selected.broker_symbol,
            "sl": rounded_sl,
            "tp": take_profit or selected.takeProfit or 0.0,
            "magic": int(os.getenv("XAUGBPEUUSD_MT5_MAGIC", "260603")),
            "comment": "XAUGBPEUUSD auto trailing",
        }
        result = mt5.order_send(request)
        if result is None:
            return False, f"MT5 stop loss update returned no result. Last error: {mt5.last_error()}", selected.stopLoss, rounded_sl
        retcode = getattr(result, "retcode", None)
        comment = getattr(result, "comment", None) or retcode
        if retcode not in {10008, 10009}:
            return False, f"MT5 stop loss update rejected request: {comment}", selected.stopLoss, rounded_sl
        return True, f"Stop loss updated to {rounded_sl}.", selected.stopLoss, rounded_sl

    @staticmethod
    def _pip_size(info: Any) -> float:
        point = float(getattr(info, "point", 0.00001) or 0.00001)
        digits = int(getattr(info, "digits", 5))
        return point * 10 if digits in {3, 5} else point

    def recent_closed_deals(self, hours: int | None = None, date_from: datetime | None = None) -> list[TradingJournalEntry]:
        if mt5 is None or not self.initialize():
            return []
        date_to = datetime.now(timezone.utc)
        if date_from is None:
            date_from = date_to - timedelta(hours=hours if hours is not None else 24 * 365)
        deals = mt5.history_deals_get(date_from, date_to)
        if not deals:
            return []
        entries: list[TradingJournalEntry] = []
        for deal in deals:
            entry_type = int(getattr(deal, "entry", -1))
            if entry_type not in {getattr(mt5, "DEAL_ENTRY_OUT", 1), getattr(mt5, "DEAL_ENTRY_INOUT", 2)}:
                continue
            symbol = self._base_symbol(str(getattr(deal, "symbol", "")))
            if symbol is None:
                continue
            side = Side.SELL if int(getattr(deal, "type", 0)) == getattr(mt5, "DEAL_TYPE_SELL", 1) else Side.BUY
            reason = self._deal_close_reason(deal)
            entries.append(
                TradingJournalEntry(
                    time=datetime.fromtimestamp(int(getattr(deal, "time", 0)), tz=timezone.utc).isoformat(),
                    ticket=int(getattr(deal, "position_id", 0)) or int(getattr(deal, "ticket", 0)),
                    symbol=symbol,
                    side=side,
                    volume=float(getattr(deal, "volume", 0.0)),
                    entry=None,
                    exit=float(getattr(deal, "price", 0.0)) or None,
                    profit=float(getattr(deal, "profit", 0.0)),
                    closeReason=reason,
                    source="mt5",
                    note=str(getattr(deal, "comment", "")) or "MT5 closed deal",
                )
            )
        return entries

    @staticmethod
    def _select_position(positions: list[OpenPosition], ticket: int | None, symbol: Symbol | None) -> OpenPosition | None:
        if ticket is not None:
            return next((position for position in positions if position.ticket == ticket), None)
        if symbol is not None:
            return next((position for position in positions if position.symbol == symbol), None)
        return None

    @staticmethod
    def _base_symbol(broker_symbol: str) -> Symbol | None:
        for symbol in ("XAUUSD", "EURUSD"):
            if symbol in broker_symbol.upper():
                return symbol  # type: ignore[return-value]
        return None

    @staticmethod
    def _deal_close_reason(deal: Any) -> str:
        if mt5 is not None:
            deal_reason = getattr(deal, "reason", None)
            if deal_reason == getattr(mt5, "DEAL_REASON_TP", None):
                return "tp"
            if deal_reason == getattr(mt5, "DEAL_REASON_SL", None):
                return "sl"
            if deal_reason in {
                getattr(mt5, "DEAL_REASON_CLIENT", None),
                getattr(mt5, "DEAL_REASON_MOBILE", None),
                getattr(mt5, "DEAL_REASON_WEB", None),
            }:
                return "manual_external"
            if deal_reason == getattr(mt5, "DEAL_REASON_EXPERT", None):
                return "force_close_user"
        comment = str(getattr(deal, "comment", "")).lower()
        text = comment
        if "tp" in text or "take" in text:
            return "tp"
        if "sl" in text or "stop" in text:
            return "sl"
        if "force close" in text or "xaugbpeuusd" in text:
            return "force_close_user"
        if comment:
            return "manual_external"
        return "unknown"

    def _build_order_request(self, order: ExecuteOrderRequest, broker_symbol: str, fallback_lot: float | None) -> dict[str, Any] | None:
        if mt5 is None:
            return None
        info = mt5.symbol_info(broker_symbol)
        tick = mt5.symbol_info_tick(broker_symbol)
        if info is None or tick is None:
            return None
        volume = self._normalize_volume(float(order.lot or fallback_lot or 0.0), info)
        if volume <= 0:
            return None
        digits = int(getattr(info, "digits", 5))
        mt5_type = self._map_order_type(order.orderType)
        if mt5_type is None:
            return None
        is_market = order.orderType in {OrderType.BUY_MARKET, OrderType.SELL_MARKET}
        if order.orderType == OrderType.BUY_MARKET:
            price = float(tick.ask)
        elif order.orderType == OrderType.SELL_MARKET:
            price = float(tick.bid)
        else:
            price = order.entry

        request: dict[str, Any] = {
            "action": mt5.TRADE_ACTION_DEAL if is_market else mt5.TRADE_ACTION_PENDING,
            "symbol": broker_symbol,
            "volume": volume,
            "type": mt5_type,
            "price": round(float(price), digits),
            "sl": round(float(order.stopLoss), digits),
            "tp": round(float(order.takeProfit), digits),
            "deviation": int(os.getenv("XAUGBPEUUSD_MT5_DEVIATION", "30")),
            "magic": int(os.getenv("XAUGBPEUUSD_MT5_MAGIC", "260603")),
            "comment": (order.comment or "XAUGBPEUUSD strategy app")[:31],
            "type_time": mt5.ORDER_TIME_GTC,
        }
        filling = self._select_filling_mode(info, is_market)
        if filling is not None:
            request["type_filling"] = filling
        return request

    @staticmethod
    def _map_order_type(order_type: OrderType) -> int | None:
        if mt5 is None:
            return None
        return {
            OrderType.BUY_MARKET: mt5.ORDER_TYPE_BUY,
            OrderType.SELL_MARKET: mt5.ORDER_TYPE_SELL,
            OrderType.BUY_LIMIT: mt5.ORDER_TYPE_BUY_LIMIT,
            OrderType.SELL_LIMIT: mt5.ORDER_TYPE_SELL_LIMIT,
            OrderType.BUY_STOP: mt5.ORDER_TYPE_BUY_STOP,
            OrderType.SELL_STOP: mt5.ORDER_TYPE_SELL_STOP,
        }.get(order_type)

    @staticmethod
    def _base_order_type(mt5_order_type: int) -> OrderType | None:
        if mt5 is None:
            return None
        mapping = {
            getattr(mt5, "ORDER_TYPE_BUY_LIMIT", None): OrderType.BUY_LIMIT,
            getattr(mt5, "ORDER_TYPE_SELL_LIMIT", None): OrderType.SELL_LIMIT,
            getattr(mt5, "ORDER_TYPE_BUY_STOP", None): OrderType.BUY_STOP,
            getattr(mt5, "ORDER_TYPE_SELL_STOP", None): OrderType.SELL_STOP,
        }
        return mapping.get(mt5_order_type)

    @staticmethod
    def _normalize_volume(volume: float, info: Any) -> float:
        min_volume = float(getattr(info, "volume_min", 0.01) or 0.01)
        max_volume = float(getattr(info, "volume_max", volume) or volume)
        step = float(getattr(info, "volume_step", 0.01) or 0.01)
        capped_max_volume = min(max_volume, MAX_LOT_PER_POSITION)
        normalized = max(min_volume, min(volume, capped_max_volume))
        steps = math.floor((normalized + 1e-12) / step)
        return round(max(min_volume, steps * step), 2)

    @staticmethod
    def _select_filling_mode(info: Any, is_market: bool) -> int | None:
        if mt5 is None:
            return None
        if not is_market:
            return getattr(mt5, "ORDER_FILLING_RETURN", None)
        broker_mode = getattr(info, "filling_mode", None)
        if broker_mode in {
            getattr(mt5, "ORDER_FILLING_FOK", None),
            getattr(mt5, "ORDER_FILLING_IOC", None),
            getattr(mt5, "ORDER_FILLING_RETURN", None),
        }:
            return int(broker_mode)
        return getattr(mt5, "ORDER_FILLING_IOC", None)

    @staticmethod
    def _is_demo_account(account: Any | None) -> bool:
        if account is None:
            return False
        server = str(getattr(account, "server", "")).lower()
        trade_mode = str(getattr(account, "trade_mode", "")).lower()
        return "demo" in server or "trial" in server or trade_mode == "0"

    @staticmethod
    def _map_timeframe(timeframe: Timeframe) -> int:
        if mt5 is None:
            return 0
        return {
            "M15": mt5.TIMEFRAME_M15,
            "M30": mt5.TIMEFRAME_M30,
            "H1": mt5.TIMEFRAME_H1,
            "H4": mt5.TIMEFRAME_H4,
            "D1": mt5.TIMEFRAME_D1,
        }[timeframe]

    @staticmethod
    def _mock_candles(symbol: Symbol, timeframe: Timeframe, count: int) -> list[Candle]:
        seed = f"{symbol}-{timeframe}"
        rng = random.Random(seed)
        minutes = TIMEFRAME_MINUTES[timeframe]
        base = BASE_PRICE[symbol]
        point = POINT_SIZE[symbol]
        drift = 0.18 if symbol == "XAUUSD" else 0.00004
        if timeframe in {"H4", "D1"}:
            drift *= 1.8
        price = base - drift * count * 0.35
        now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        candles: list[Candle] = []
        for idx in range(count):
            wave = math.sin(idx / 7.5) * point * (260 if symbol == "XAUUSD" else 90)
            impulse = drift + wave
            open_price = price
            close = open_price + impulse + rng.uniform(-1, 1) * point * (80 if symbol == "XAUUSD" else 35)
            high = max(open_price, close) + abs(rng.uniform(12, 80) * point)
            low = min(open_price, close) - abs(rng.uniform(12, 80) * point)
            price = close
            candles.append(
                Candle(
                    time=(now - timedelta(minutes=minutes * (count - idx))).isoformat(),
                    open=round(open_price, 5),
                    high=round(high, 5),
                    low=round(low, 5),
                    close=round(close, 5),
                    volume=rng.randint(350, 2200),
                )
            )
        return candles
