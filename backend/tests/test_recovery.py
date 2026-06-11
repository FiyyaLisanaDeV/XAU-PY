from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import backend.app.main as main_module
from backend.app.models import Candle, OpenPosition, RecoveryCycleStatus, Side
from backend.app.recovery import recovery_confirmed, reversal_score


def position(
    ticket: int,
    side: Side,
    profit: float,
    *,
    volume: float = 0.10,
    comment: str | None = None,
) -> OpenPosition:
    return OpenPosition(
        ticket=ticket,
        symbol="XAUUSD",
        broker_symbol="XAUUSDm",
        side=side,
        volume=volume,
        open_price=2000.0,
        current_price=1998.0,
        stopLoss=1990.0 if side == Side.BUY else 2010.0,
        takeProfit=2020.0 if side == Side.BUY else 1980.0,
        profit=profit,
        swap=0.0,
        commission=0.0,
        opened_at="2026-06-11T00:00:00+00:00",
        comment=comment,
    )


def range_candles(count: int = 70) -> list[Candle]:
    return [
        Candle(
            time=f"2026-06-11T00:{index:02d}:00+00:00",
            open=2000.0,
            high=2000.5,
            low=1999.5,
            close=2000.1,
            volume=100,
        )
        for index in range(count)
    ]


def configure_recovery(monkeypatch) -> None:
    monkeypatch.setattr(main_module, "recovery_cycles", {})
    monkeypatch.setattr(main_module.auto_config, "enabled", True)
    monkeypatch.setattr(main_module.auto_config, "recoveryEnabled", True)
    monkeypatch.setattr(main_module.auto_config, "activeSymbols", ["XAUUSD"])
    monkeypatch.setattr(main_module.auto_config, "reversalHedgeScore", 75)
    monkeypatch.setattr(main_module.auto_config, "recoveryResumeScore", 45)
    monkeypatch.setattr(main_module.auto_config, "hedgeRatio", 0.5)
    monkeypatch.setattr(main_module.auto_config, "hedgeProfitUsd", {"XAUUSD": 10.0, "EURUSD": 10.0})
    monkeypatch.setattr(main_module.auto_config, "recoveryMultiplier", 1.35)
    monkeypatch.setattr(main_module.auto_config, "maxRecoveryLayers", 2)
    monkeypatch.setattr(main_module.auto_config, "basketTargetUsd", {"XAUUSD": 15.0, "EURUSD": 10.0})
    monkeypatch.setattr(main_module.auto_config, "basketMaxLossUsd", {"XAUUSD": 100.0, "EURUSD": 50.0})
    monkeypatch.setattr(main_module.auto_config, "recoveryCooldownSeconds", 60)
    monkeypatch.setattr(main_module, "save_recovery_cycles", lambda: None)


def test_reversal_score_requires_confirmed_completed_candles():
    candles: list[Candle] = []
    for index in range(59):
        close = 2100.0 - index * 0.4
        candles.append(
            Candle(
                time=f"2026-06-10T{index:02d}:00:00+00:00",
                open=close + 0.2,
                high=close + 0.4,
                low=close - 0.4,
                close=close,
                volume=100,
            )
        )
    candles.append(
        Candle(
            time="2026-06-11T11:00:00+00:00",
            open=2077.0,
            high=2077.2,
            low=2071.0,
            close=2071.2,
            volume=250,
        )
    )
    candles.append(
        Candle(
            time="2026-06-11T11:15:00+00:00",
            open=2071.2,
            high=2200.0,
            low=2071.0,
            close=2199.0,
            volume=1000,
        )
    )

    score, reasons = reversal_score(Side.BUY, candles, candles, 1.5)

    assert score >= 75
    assert any("M15 and M30" in reason for reason in reasons)


def test_recovery_confirmation_follows_original_direction():
    candles = [
        Candle(
            time=f"2026-06-11T00:{index:02d}:00+00:00",
            open=2000.0 + index * 0.05,
            high=2000.3 + index * 0.05,
            low=1999.8 + index * 0.05,
            close=2000.1 + index * 0.05,
            volume=100,
        )
        for index in range(24)
    ]
    previous = candles[-1]
    candles.append(
        Candle(
            time="2026-06-11T01:00:00+00:00",
            open=previous.close,
            high=previous.high + 1.2,
            low=previous.close - 0.1,
            close=previous.high + 1.0,
            volume=150,
        )
    )
    candles.append(
        Candle(
            time="2026-06-11T01:15:00+00:00",
            open=2002.0,
            high=2002.1,
            low=2001.9,
            close=2002.0,
            volume=10,
        )
    )

    assert recovery_confirmed(Side.BUY, candles)
    assert not recovery_confirmed(Side.SELL, candles)


def test_recovery_engine_opens_partial_opposite_hedge(monkeypatch):
    configure_recovery(monkeypatch)
    main = position(1, Side.BUY, -12.0)
    calls: list[tuple[Side, float, str]] = []

    class FakeBridge:
        def status(self):
            return SimpleNamespace(
                connected=True,
                trade_ready=True,
                demo_guard_enabled=True,
                live_account=False,
                equity=10000.0,
            )

        def open_positions(self):
            return [main]

        def fetch_candles(self, _symbol, _timeframe):
            return range_candles()

    monkeypatch.setattr(main_module, "bridge", FakeBridge())
    monkeypatch.setattr(main_module, "reversal_score", lambda *_args: (82, ["confirmed reversal"]))

    def fake_open(_symbol, side, requested_lot, _candles, comment, _positions, _equity):
        calls.append((side, requested_lot, comment))
        return True, 99, "sent"

    monkeypatch.setattr(main_module, "open_recovery_order", fake_open)

    status = main_module.process_recovery_engine()

    assert status.cycles[0].phase == "HEDGE_ACTIVE"
    assert calls == [(Side.SELL, 0.05, "XAPY-H-XAUUSD")]


def test_recovery_engine_closes_profitable_hedge_then_waits(monkeypatch):
    configure_recovery(monkeypatch)
    main = position(1, Side.BUY, -12.0)
    hedge = position(2, Side.SELL, 10.5, volume=0.05, comment="XAPY-H-XAUUSD")
    closed: list[int] = []

    class FakeBridge:
        def status(self):
            return SimpleNamespace(
                connected=True,
                trade_ready=True,
                demo_guard_enabled=True,
                live_account=False,
                equity=10000.0,
            )

        def open_positions(self):
            return [main, hedge]

        def fetch_candles(self, _symbol, _timeframe):
            return range_candles()

        def close_position(self, ticket=None, symbol=None):
            closed.append(ticket)
            return True, ticket, "closed", hedge

    monkeypatch.setattr(main_module, "bridge", FakeBridge())
    monkeypatch.setattr(main_module, "reversal_score", lambda *_args: (80, ["confirmed reversal"]))

    status = main_module.process_recovery_engine()
    cycle = status.cycles[0]

    assert closed == [2]
    assert cycle.phase == "WAIT_RECOVERY"
    assert cycle.realizedHedgeProfit == 10.5


def test_recovery_engine_opens_limited_same_direction_layer(monkeypatch):
    configure_recovery(monkeypatch)
    main = position(1, Side.BUY, -8.0)
    calls: list[tuple[Side, float, str]] = []
    main_module.recovery_cycles["XAUUSD"] = RecoveryCycleStatus(
        symbol="XAUUSD",
        phase="WAIT_RECOVERY",
        mainSide=Side.BUY,
        realizedHedgeProfit=10.0,
        updatedAt=(datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
    )

    class FakeBridge:
        def status(self):
            return SimpleNamespace(
                connected=True,
                trade_ready=True,
                demo_guard_enabled=True,
                live_account=False,
                equity=10000.0,
            )

        def open_positions(self):
            return [main]

        def fetch_candles(self, _symbol, _timeframe):
            return range_candles()

    monkeypatch.setattr(main_module, "bridge", FakeBridge())
    monkeypatch.setattr(main_module, "reversal_score", lambda *_args: (30, ["reversal faded"]))
    monkeypatch.setattr(main_module, "recovery_confirmed", lambda *_args: True)

    def fake_open(_symbol, side, requested_lot, _candles, comment, _positions, _equity):
        calls.append((side, requested_lot, comment))
        return True, 100, "sent"

    monkeypatch.setattr(main_module, "open_recovery_order", fake_open)

    status = main_module.process_recovery_engine()
    cycle = status.cycles[0]

    assert cycle.phase == "RECOVERY_ACTIVE"
    assert cycle.recoveryLayers == 1
    assert calls == [(Side.BUY, 0.135, "XAPY-R1-XAUUSD")]


def test_recovery_engine_closes_complete_basket_at_combined_target(monkeypatch):
    configure_recovery(monkeypatch)
    main = position(1, Side.BUY, -2.0)
    recovery = position(3, Side.BUY, 8.0, comment="XAPY-R1-XAUUSD")
    main_module.recovery_cycles["XAUUSD"] = RecoveryCycleStatus(
        symbol="XAUUSD",
        phase="RECOVERY_ACTIVE",
        mainSide=Side.BUY,
        recoveryLayers=1,
        realizedHedgeProfit=10.0,
    )
    closed: list[int] = []

    class FakeBridge:
        def status(self):
            return SimpleNamespace(
                connected=True,
                trade_ready=True,
                demo_guard_enabled=True,
                live_account=False,
                equity=10000.0,
            )

        def open_positions(self):
            return [main, recovery]

        def fetch_candles(self, _symbol, _timeframe):
            return range_candles()

        def close_position(self, ticket=None, symbol=None):
            selected = main if ticket == main.ticket else recovery
            closed.append(ticket)
            return True, ticket, "closed", selected

    monkeypatch.setattr(main_module, "bridge", FakeBridge())
    monkeypatch.setattr(main_module, "reversal_score", lambda *_args: (20, []))

    status = main_module.process_recovery_engine()

    assert closed == [1, 3]
    assert status.cycles[0].phase == "BASKET_EXIT"


def test_recovery_order_caps_lot_at_point_one(monkeypatch):
    main = position(1, Side.BUY, -5.0, volume=0.01)
    sent: list[tuple[float, float | None, str | None]] = []

    class FakeBridge:
        def tick(self, _symbol):
            return 2000.0, 2000.2, 20.0

        def pending_orders(self):
            return []

        def send_order(self, request, fallback_lot=None):
            sent.append((request.riskValue, fallback_lot, request.comment))
            return True, 200, "sent"

    monkeypatch.setattr(main_module, "bridge", FakeBridge())

    accepted, ticket, _message = main_module.open_recovery_order(
        "XAUUSD",
        Side.BUY,
        0.135,
        range_candles(20),
        "XAPY-R1-XAUUSD",
        [main],
        10000.0,
    )

    assert accepted
    assert ticket == 200
    assert sent == [(0.1, 0.1, "XAPY-R1-XAUUSD")]


def test_per_position_hard_tp_waits_for_active_recovery_basket(monkeypatch):
    main = position(1, Side.BUY, 12.0)
    monkeypatch.setattr(
        main_module,
        "recovery_cycles",
        {
            "XAUUSD": RecoveryCycleStatus(
                symbol="XAUUSD",
                phase="RECOVERY_ACTIVE",
                mainSide=Side.BUY,
                recoveryLayers=1,
            )
        },
    )

    class FakeBridge:
        def open_positions(self):
            return [main]

        def close_position(self, ticket=None, symbol=None):
            raise AssertionError("Hard TP must not split an active recovery basket")

    monkeypatch.setattr(main_module, "bridge", FakeBridge())
    monkeypatch.setattr(main_module.auto_config, "hardTakeProfitUsd", {"XAUUSD": 10.0, "EURUSD": 10.0})
    main_module.trailing_states.clear()
    main_module.trailing_last_attempts.clear()
    main_module.hard_tp_last_attempts.clear()

    assert main_module.process_trailing_positions() == []
