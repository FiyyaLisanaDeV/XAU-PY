import backend.app.mt5_bridge as mt5_bridge_module
from backend.app.models import ExecuteOrderRequest, OrderType, RiskMode, RiskRequest, Side
from backend.app.mt5_bridge import MT5Bridge
from backend.app.risk import validate_order
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
