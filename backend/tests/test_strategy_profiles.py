from backend.app.models import AutoModeRequest
from backend.app.strategy_profiles import apply_strategy_profile


def test_conservative_profile_is_applied_by_backend():
    configured = apply_strategy_profile(
        AutoModeRequest(enabled=True, strategyProfile="CONSERVATIVE", maxTotalRiskPercent=99)
    )
    assert configured.maxTotalRiskPercent == 6
    assert configured.minScore == 75
    assert configured.recoveryEnabled is False
    assert configured.pairProfiles["XAUUSD"].maxOpenPositions == 2
    assert configured.pairProfiles["EURUSD"].allowedMarketRegimes == ["TRENDING"]


def test_opportunistic_profile_is_applied_by_backend():
    configured = apply_strategy_profile(AutoModeRequest(enabled=True, strategyProfile="OPPORTUNISTIC"))
    assert configured.maxTotalRiskPercent == 12
    assert configured.minScore == 65
    assert configured.pairProfiles["XAUUSD"].marketRegimeMode == "advisory"
    assert configured.pairProfiles["EURUSD"].maxLot == 0.05


def test_high_risk_profile_keeps_hard_system_caps():
    configured = apply_strategy_profile(AutoModeRequest(enabled=True, strategyProfile="HIGH_RISK"))
    assert configured.maxTotalRiskPercent == 20
    assert configured.recoveryEnabled is True
    assert configured.pairProfiles["XAUUSD"].maxLot == 0.10
    assert configured.pairProfiles["EURUSD"].maxLot == 0.10


def test_custom_profile_is_not_rewritten():
    request = AutoModeRequest(enabled=True, strategyProfile="CUSTOM", maxTotalRiskPercent=7.5, minScore=71)
    configured = apply_strategy_profile(request)
    assert configured is request
    assert configured.maxTotalRiskPercent == 7.5
    assert configured.minScore == 71
