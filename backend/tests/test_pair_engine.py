from datetime import datetime, timedelta, timezone
from random import Random

from backend.app.models import Candle, OpenPosition, OrderRecommendation, PairState, RiskMode, Side, default_pair_profiles
from backend.app.pair_engine import apply_pair_risk_model, build_pair_exposure, normalize_investing_code


def candle(index: int, price: float = 1.1000) -> Candle:
    return Candle(
        time=(datetime(2026, 6, 11, tzinfo=timezone.utc) + timedelta(minutes=15 * index)).isoformat(),
        open=price,
        high=price + 0.0007,
        low=price - 0.0007,
        close=price + 0.0002,
        volume=100,
    )


def test_eurusd_pair_risk_model_clamps_stop_and_uses_one_point_six_rr():
    profile = default_pair_profiles()["EURUSD"]
    signal = OrderRecommendation(
        symbol="EURUSD",
        timeframe="M15",
        side=Side.BUY,
        orderType="BUY_MARKET",
        entry=1.1000,
        stopLoss=1.0999,
        takeProfit=1.1001,
        lot=None,
        riskMode=RiskMode.PERCENT_EQUITY,
        riskValue=0.25,
        riskPercent=None,
        score=80,
        setupType="test",
        reasons=[],
        blockedReasons=[],
    )
    apply_pair_risk_model(signal, profile, [candle(index) for index in range(20)])
    stop_pips = (signal.entry - signal.stopLoss) / 0.0001
    rr = (signal.takeProfit - signal.entry) / (signal.entry - signal.stopLoss)
    assert 10 <= stop_pips <= 30
    assert round(rr, 1) == 1.6


def test_investing_signal_normalization_fails_closed():
    assert normalize_investing_code("Strong Buy") == "strong_buy"
    assert normalize_investing_code("Premium") == "unavailable"
    assert normalize_investing_code(None) == "unavailable"


def test_xau_aggregate_exposure_guard_simulates_1500_candidates():
    random = Random(20260611)
    profile = default_pair_profiles()["XAUUSD"]
    state = PairState(symbol="XAUUSD")
    positions = [
        OpenPosition(
            ticket=1,
            symbol="XAUUSD",
            broker_symbol="XAUUSDm",
            side=Side.BUY,
            volume=0.10,
            open_price=4400.0,
            current_price=4401.0,
            stopLoss=4390.0,
            takeProfit=4420.0,
            profit=10.0,
            swap=0.0,
            commission=0.0,
            opened_at=datetime.now(timezone.utc).isoformat(),
        )
    ]
    for _ in range(1500):
        lot = random.choice([0.01, 0.02, 0.05, 0.10])
        stop_distance = random.uniform(5.0, 120.0)
        result = build_pair_exposure(
            "XAUUSD",
            profile,
            state,
            positions,
            [],
            100.0,
            100.0,
            (4400.0, 4400.0 - stop_distance, lot, Side.BUY),
        )
        if result.aggregateSlRiskPercent > profile.aggregateSlRiskCapPercent:
            assert result.status in {"BLOCKED", "CLOSE_ONLY"}
            assert any("aggregate SL exposure" in reason for reason in result.reasons)


def test_shadow_transition_warns_without_enforcing_close_only():
    profile = default_pair_profiles()["XAUUSD"]
    position = OpenPosition(
        ticket=2,
        symbol="XAUUSD",
        broker_symbol="XAUUSDm",
        side=Side.BUY,
        volume=0.10,
        open_price=4400.0,
        current_price=4400.0,
        stopLoss=4200.0,
        takeProfit=4500.0,
        profit=0.0,
        swap=0.0,
        commission=0.0,
        opened_at=datetime.now(timezone.utc).isoformat(),
    )
    result = build_pair_exposure(
        "XAUUSD",
        profile,
        PairState(symbol="XAUUSD"),
        [position],
        [],
        100.0,
        100.0,
        shadow_transition=True,
    )
    assert result.status == "WARNING"
    assert result.tradeMode == "NORMAL"
    assert any("CLOSE_ONLY not enforced" in reason for reason in result.reasons)
