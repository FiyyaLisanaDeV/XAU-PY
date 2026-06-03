from backend.app.models import OrderType, RiskMode, RiskRequest, Side
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
