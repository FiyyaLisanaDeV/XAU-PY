from datetime import datetime, timezone

import backend.app.mt5_bridge as mt5_bridge_module
import backend.app.main as main_module
from backend.app.investing_sync import INVESTING_PIVOT_URLS, parse_pivot_html, parse_technical_html
from backend.app.models import ExecuteOrderRequest, OpenPosition, OrderRecommendation, OrderType, PendingOrder, RiskExposureItem, RiskMode, RiskRequest, Side, TradingJournalEntry
from backend.app.mt5_bridge import MT5Bridge
from backend.app.risk import build_risk_exposure, validate_order
from backend.app.strategy import build_snapshot, recommend


def test_risk_validation_blocks_more_than_half_percent():
    result = validate_order(
        RiskRequest(
            symbol="XAUUSD",
            timeframe="H1",
            side=Side.BUY,
            orderType=OrderType.BUY_MARKET,
            entry=2350.0,
            stopLoss=2340.0,
            takeProfit=2370.0,
            riskMode=RiskMode.FIXED_LOT,
            riskValue=1.0,
        ),
        equity=10000.0,
    )
    assert not result.valid
    assert any("0.5%" in reason for reason in result.blockedReasons)


def test_percent_equity_risk_calculates_lot():
    result = validate_order(
        RiskRequest(
            symbol="EURUSD",
            timeframe="H1",
            side=Side.SELL,
            orderType=OrderType.SELL_MARKET,
            entry=1.085,
            stopLoss=1.09,
            takeProfit=1.075,
            riskMode=RiskMode.PERCENT_EQUITY,
            riskValue=0.5,
        ),
        equity=10000.0,
    )
    assert result.valid
    assert result.lot is not None and result.lot > 0
    assert result.risk_percent is not None and result.risk_percent <= 0.5


def test_risk_validation_caps_lot_at_point_one():
    result = validate_order(
        RiskRequest(
            symbol="EURUSD",
            timeframe="H1",
            side=Side.BUY,
            orderType=OrderType.BUY_MARKET,
            entry=1.1000,
            stopLoss=1.0990,
            takeProfit=1.1030,
            riskMode=RiskMode.FIXED_LOT,
            riskValue=1.0,
        ),
        equity=10000.0,
    )

    assert result.lot == 0.10


def test_total_risk_exposure_includes_positions_pending_and_candidate():
    exposure = build_risk_exposure(
        positions=[
            OpenPosition(
                ticket=1,
                symbol="XAUUSD",
                broker_symbol="XAUUSDm",
                side=Side.BUY,
                volume=0.01,
                open_price=2350.0,
                current_price=2355.0,
                stopLoss=2340.0,
                takeProfit=2370.0,
                profit=5.0,
                swap=0.0,
                commission=0.0,
                opened_at="2026-06-04T00:00:00+00:00",
                comment=None,
            )
        ],
        pending_orders=[
            PendingOrder(
                ticket=2,
                symbol="EURUSD",
                broker_symbol="EURUSDm",
                side=Side.BUY,
                orderType=OrderType.BUY_LIMIT,
                volume=0.10,
                entry=1.0800,
                stopLoss=1.0750,
                takeProfit=1.0900,
                created_at="2026-06-04T00:00:00+00:00",
                comment=None,
            )
        ],
        equity=10000.0,
        max_total_risk_percent=20.0,
        candidate=RiskExposureItem(symbol="EURUSD", source="candidate", entry=1.0700, stopLoss=1.0650, lot=0.10),
    )

    assert not exposure.blocked
    assert exposure.totalRiskUsd == 110.0
    assert exposure.totalRiskPercent == 1.1


def test_total_risk_exposure_blocks_missing_stop_loss():
    exposure = build_risk_exposure(
        positions=[
            OpenPosition(
                ticket=1,
                symbol="XAUUSD",
                broker_symbol="XAUUSDm",
                side=Side.BUY,
                volume=0.01,
                open_price=2350.0,
                current_price=2355.0,
                stopLoss=None,
                takeProfit=2370.0,
                profit=5.0,
                swap=0.0,
                commission=0.0,
                opened_at="2026-06-04T00:00:00+00:00",
                comment=None,
            )
        ],
        pending_orders=[],
        equity=10000.0,
        max_total_risk_percent=20.0,
    )

    assert exposure.blocked
    assert any("no stop loss" in reason for reason in exposure.blockedReasons)


def test_total_risk_exposure_blocks_when_candidate_exceeds_cap():
    exposure = build_risk_exposure(
        positions=[],
        pending_orders=[],
        equity=10000.0,
        max_total_risk_percent=20.0,
        candidate=RiskExposureItem(symbol="EURUSD", source="candidate", entry=1.1000, stopLoss=1.0900, lot=3.0),
    )

    assert exposure.blocked
    assert exposure.totalRiskPercent == 30.0
    assert any("exceeds 20.0%" in reason for reason in exposure.blockedReasons)


def test_auto_scan_does_not_execute_when_auto_mode_is_off():
    main_module.auto_config.enabled = False
    response = main_module.run_auto_scan()

    assert response.executed == 0
    assert response.status.enabled is False
    assert "Auto mode is OFF" in response.blocked


def test_auto_duplicate_cooldown_blocks_recent_signature():
    class Signal:
        symbol = "XAUUSD"
        timeframe = "H1"
        side = Side.BUY
        orderType = OrderType.BUY_MARKET
        entry = 2350.0
        score = 72

    signature = main_module.build_auto_signature(Signal())  # type: ignore[arg-type]
    main_module.auto_config.duplicateCooldownMinutes = 10
    main_module.auto_executed_signatures[signature] = main_module.datetime.now(main_module.timezone.utc)

    assert main_module.is_auto_duplicate(signature)

    main_module.auto_executed_signatures.pop(signature, None)


def test_auto_execution_timeframes_exclude_swing_frames():
    assert "D1" in main_module.SCAN_TIMEFRAMES
    assert "H4" in main_module.SCAN_TIMEFRAMES
    assert "D1" not in main_module.EXECUTION_TIMEFRAMES
    assert "H4" not in main_module.EXECUTION_TIMEFRAMES
    assert main_module.EXECUTION_TIMEFRAMES == ("M15", "M30", "H1")


def test_investing_auto_sync_interval_is_one_minute():
    assert main_module.INVESTING_SYNC_INTERVAL_SECONDS == 60


def test_investing_pivot_fibonacci_url_and_parser():
    assert INVESTING_PIVOT_URLS["XAUUSD"] == "https://id.investing.com/technical/pivot-points-fibonacci"
    html = """
    <table>
      <thead>
        <tr><th>Name</th><th>S3</th><th>S2</th><th>S1</th><th>Pivot</th><th>R1</th><th>R2</th><th>R3</th></tr>
      </thead>
      <tbody>
        <tr><td>XAU/USD</td><td>4400.1</td><td>4420.2</td><td>4440.3</td><td>4460.4</td><td>4480.5</td><td>4500.6</td><td>4520.7</td></tr>
      </tbody>
    </table>
    """

    pivots = parse_pivot_html(html, "XAUUSD")

    assert pivots["S3"]["value"] == 4400.1
    assert pivots["PIVOT"]["value"] == 4460.4
    assert pivots["R3"]["value"] == 4520.7


def test_investing_technical_fibonacci_row_fills_pivots():
    html = """
    <table>
      <tr><td>RSI(14)</td><td>55.1</td><td>Buy</td></tr>
      <tr><td>MA5</td><td>4400 Buy</td><td>Buy</td></tr>
      <tr><td>Fibonacci</td><td>4329.56</td><td>4350.49</td><td>4363.41</td><td>4384.34</td><td>4405.27</td><td>4418.19</td><td>4439.12</td></tr>
    </table>
    """

    technical = parse_technical_html(html, "XAUUSD")

    assert technical["pivot_points"]["S3"]["value"] == 4329.56
    assert technical["pivot_points"]["PIVOT"]["value"] == 4384.34
    assert technical["pivot_points"]["R3"]["value"] == 4439.12


def test_investing_technical_parses_available_timeframe_tabs():
    html = """
    <button role="tab" data-test="15m"><span>15 min</span><span>Unlock</span></button>
    <button role="tab" data-test="30m"><span>30 Min</span><span>Strong Sell</span></button>
    <button role="tab" data-test="1h" class="!border-inv-blue-500"><span>Hourly</span><span>Buy</span></button>
    <button role="tab" data-test="5h"><span>5 Hours</span><span>Neutral</span></button>
    <button role="tab" data-test="1d"><span>Daily</span><span>Sell</span></button>
    <table>
      <tr><td>RSI(14)</td><td>55.1</td><td>Buy</td></tr>
      <tr><td>MA5</td><td>4400 Buy</td><td>Buy</td></tr>
    </table>
    """

    technical = parse_technical_html(html, "XAUUSD")

    assert technical["selected_timeframe"] == "1h"
    assert technical["app_timeframe_map"]["M30"] == "30m"
    assert technical["app_timeframe_map"]["H4"] == "5h"
    assert technical["timeframe_signals"]["15m"]["signal"]["code"] == "locked"
    assert technical["timeframe_signals"]["30m"]["signal"]["code"] == "strong_sell"
    assert technical["timeframe_signals"]["1h"]["signal"]["code"] == "buy"
    assert technical["timeframe_signals"]["1d"]["signal"]["code"] == "sell"


def test_auto_take_profit_closes_positions_at_ten_dollars(monkeypatch):
    profitable = OpenPosition(
        ticket=11,
        symbol="XAUUSD",
        broker_symbol="XAUUSDm",
        side=Side.BUY,
        volume=0.01,
        open_price=2350.0,
        current_price=2360.0,
        stopLoss=2340.0,
        takeProfit=2370.0,
        profit=10.0,
        swap=0.0,
        commission=0.0,
        opened_at="2026-06-04T00:00:00+00:00",
        comment=None,
    )
    quiet = OpenPosition(
        ticket=12,
        symbol="EURUSD",
        broker_symbol="EURUSDm",
        side=Side.SELL,
        volume=0.01,
        open_price=1.1000,
        current_price=1.0998,
        stopLoss=1.1010,
        takeProfit=1.0980,
        profit=9.99,
        swap=0.0,
        commission=0.0,
        opened_at="2026-06-04T00:00:00+00:00",
        comment=None,
    )

    class FakeBridge:
        def __init__(self):
            self.closed: list[int] = []

        def open_positions(self):
            return [profitable, quiet]

        def close_position(self, ticket=None, symbol=None):
            self.closed.append(ticket)
            return True, ticket, "closed", profitable

    fake_bridge = FakeBridge()
    monkeypatch.setattr(main_module, "bridge", fake_bridge)
    main_module.auto_tp_closed_tickets.clear()
    main_module.journal.clear()
    main_module.history.clear()

    results = main_module.close_profitable_positions()

    assert [item.ticket for item in results] == [11]
    assert fake_bridge.closed == [11]
    assert main_module.journal[-1].closeReason == "tp"
    assert "10.00" in main_module.journal[-1].note


def test_position_setup_alert_marks_opposite_valid_signal_as_invalid():
    position = OpenPosition(
        ticket=10,
        symbol="XAUUSD",
        broker_symbol="XAUUSDm",
        side=Side.BUY,
        volume=0.01,
        open_price=2350.0,
        current_price=2345.0,
        stopLoss=2340.0,
        takeProfit=2370.0,
        profit=-5.0,
        swap=0.0,
        commission=0.0,
        opened_at="2026-06-04T00:00:00+00:00",
        comment=None,
    )
    signal = OrderRecommendation(
        symbol="XAUUSD",
        timeframe="M15",
        side=Side.SELL,
        orderType=OrderType.SELL_MARKET,
        entry=2345.0,
        stopLoss=2355.0,
        takeProfit=2325.0,
        lot=0.01,
        riskMode=RiskMode.PERCENT_EQUITY,
        riskValue=0.5,
        riskPercent=0.2,
        score=72,
        setupType="Trend pullback sell",
        reasons=["EMA/MA trend alignment"],
        blockedReasons=[],
    )

    alert = main_module.classify_position_setup(position, [signal])

    assert alert.status == "invalid"
    assert alert.opposingTimeframes == ["M15"]


def test_trading_journal_hides_entries_before_reset_baseline(monkeypatch):
    reset_at = datetime(2026, 6, 5, 8, 0, tzinfo=timezone.utc)
    old_entry = TradingJournalEntry(
        time="2026-06-05T07:59:59+00:00",
        ticket=1,
        symbol="XAUUSD",
        side=Side.BUY,
        volume=0.01,
        entry=4400.0,
        exit=4410.0,
        profit=5.0,
        closeReason="tp",
        source="mt5",
        note="before reset",
    )
    new_entry = TradingJournalEntry(
        time="2026-06-05T08:00:01+00:00",
        ticket=2,
        symbol="EURUSD",
        side=Side.SELL,
        volume=0.01,
        entry=1.16,
        exit=1.15,
        profit=12.0,
        closeReason="tp",
        source="mt5",
        note="after reset",
    )

    class FakeBridge:
        def recent_closed_deals(self, **_kwargs):
            return [old_entry, new_entry]

    monkeypatch.setattr(main_module, "bridge", FakeBridge())
    monkeypatch.setattr(main_module, "read_journal_reset_at", lambda: reset_at)
    main_module.journal.clear()
    main_module.journal.append(old_entry)

    result = main_module.trading_journal()

    assert [entry.ticket for entry in result] == [2]


def test_strategy_returns_single_relevant_action_or_block():
    bridge = MT5Bridge()
    candles = bridge.fetch_candles("XAUUSD", "H1")
    bid, ask, spread = bridge.tick("XAUUSD")
    snapshot = build_snapshot("XAUUSD", "H1", candles, bid, ask, spread)
    signal = recommend(snapshot)
    if signal.blockedReasons:
        assert signal.side is None or signal.orderType is not None
    else:
        assert signal.side in {Side.BUY, Side.SELL}
        assert signal.orderType is not None


def test_mt5_trial_server_is_treated_as_demo_account():
    class Account:
        server = "Exness-MT5Trial17"
        trade_mode = "1"

    assert MT5Bridge._is_demo_account(Account())


def test_mt5_market_order_request_uses_broker_symbol_and_live_price(monkeypatch):
    class FakeInfo:
        digits = 5
        volume_min = 0.01
        volume_max = 100.0
        volume_step = 0.01
        filling_mode = 1

    class FakeTick:
        bid = 1.084
        ask = 1.08412

    class FakeMT5:
        TRADE_ACTION_DEAL = 1
        TRADE_ACTION_PENDING = 5
        ORDER_TYPE_BUY = 0
        ORDER_TYPE_SELL = 1
        ORDER_TYPE_BUY_LIMIT = 2
        ORDER_TYPE_SELL_LIMIT = 3
        ORDER_TYPE_BUY_STOP = 4
        ORDER_TYPE_SELL_STOP = 5
        ORDER_TIME_GTC = 0
        ORDER_FILLING_FOK = 0
        ORDER_FILLING_IOC = 1
        ORDER_FILLING_RETURN = 2

        @staticmethod
        def symbol_info(_symbol):
            return FakeInfo()

        @staticmethod
        def symbol_info_tick(_symbol):
            return FakeTick()

    monkeypatch.setattr(mt5_bridge_module, "mt5", FakeMT5)
    bridge = MT5Bridge()
    request = bridge._build_order_request(
        ExecuteOrderRequest(
            symbol="EURUSD",
            timeframe="H1",
            side=Side.BUY,
            orderType=OrderType.BUY_MARKET,
            entry=1.08,
            stopLoss=1.079,
            takeProfit=1.086,
            riskMode=RiskMode.FIXED_LOT,
            riskValue=0.01,
            lot=0.01,
            confirmed=True,
        ),
        "EURUSDm",
        fallback_lot=0.01,
    )

    assert request is not None
    assert request["action"] == FakeMT5.TRADE_ACTION_DEAL
    assert request["symbol"] == "EURUSDm"
    assert request["type"] == FakeMT5.ORDER_TYPE_BUY
    assert request["price"] == FakeTick.ask


def test_mt5_order_request_caps_volume_at_point_one(monkeypatch):
    class FakeInfo:
        digits = 5
        volume_min = 0.01
        volume_max = 100.0
        volume_step = 0.01
        filling_mode = 1

    class FakeTick:
        bid = 1.084
        ask = 1.08412

    class FakeMT5:
        TRADE_ACTION_DEAL = 1
        TRADE_ACTION_PENDING = 5
        ORDER_TYPE_BUY = 0
        ORDER_TYPE_SELL = 1
        ORDER_TYPE_BUY_LIMIT = 2
        ORDER_TYPE_SELL_LIMIT = 3
        ORDER_TYPE_BUY_STOP = 4
        ORDER_TYPE_SELL_STOP = 5
        ORDER_TIME_GTC = 0
        ORDER_FILLING_FOK = 0
        ORDER_FILLING_IOC = 1
        ORDER_FILLING_RETURN = 2

        @staticmethod
        def symbol_info(_symbol):
            return FakeInfo()

        @staticmethod
        def symbol_info_tick(_symbol):
            return FakeTick()

    monkeypatch.setattr(mt5_bridge_module, "mt5", FakeMT5)
    bridge = MT5Bridge()
    request = bridge._build_order_request(
        ExecuteOrderRequest(
            symbol="EURUSD",
            timeframe="H1",
            side=Side.BUY,
            orderType=OrderType.BUY_MARKET,
            entry=1.08,
            stopLoss=1.079,
            takeProfit=1.086,
            riskMode=RiskMode.FIXED_LOT,
            riskValue=1.0,
            lot=1.0,
            confirmed=True,
        ),
        "EURUSDm",
        fallback_lot=1.0,
    )

    assert request is not None
    assert request["volume"] == 0.10
