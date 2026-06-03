from backend.app.models import IndicatorSet, MarketSnapshot, OrderRecommendation, OrderType, RiskMode, Side
from backend.app.signal_logger import record_potential_signal, read_signal_log


def make_snapshot() -> MarketSnapshot:
    return MarketSnapshot(
        symbol="XAUUSD",
        timeframe="H1",
        bid=2350.0,
        ask=2350.28,
        spread_points=280,
        bias="bullish",
        candles=[],
        indicators=IndicatorSet(ema_fast=[], ema_slow=[], ma_fast=[], ma_slow=[]),
        zones=[],
    )


def make_signal(score: int) -> OrderRecommendation:
    return OrderRecommendation(
        symbol="XAUUSD",
        timeframe="H1",
        side=Side.BUY,
        orderType=OrderType.BUY_LIMIT,
        entry=2348.0,
        stopLoss=2343.0,
        takeProfit=2358.0,
        lot=0.01,
        riskMode=RiskMode.PERCENT_EQUITY,
        riskValue=0.5,
        riskPercent=0.2,
        score=score,
        setupType="Trend pullback",
        reasons=["Bullish trend", "Demand zone"],
        blockedReasons=[],
    )


def test_signal_logger_records_score_sixty_and_above(tmp_path):
    path = tmp_path / "potential_signals.jsonl"

    ignored = record_potential_signal(make_snapshot(), make_signal(59), path=path)
    recorded = record_potential_signal(make_snapshot(), make_signal(60), path=path)

    assert ignored is None
    assert recorded is not None
    entries = read_signal_log(path)
    assert len(entries) == 1
    assert entries[0].score == 60
    assert entries[0].date
    assert entries[0].day
    assert entries[0].time
    assert entries[0].symbol == "XAUUSD"


def test_signal_logger_deduplicates_recent_signal(tmp_path):
    path = tmp_path / "potential_signals.jsonl"

    first = record_potential_signal(make_snapshot(), make_signal(72), path=path)
    duplicate = record_potential_signal(make_snapshot(), make_signal(72), path=path)

    assert first is not None
    assert duplicate is None
    assert len(read_signal_log(path)) == 1
