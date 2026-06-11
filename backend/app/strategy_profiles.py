from __future__ import annotations

from .models import AutoModeRequest


def apply_strategy_profile(request: AutoModeRequest) -> AutoModeRequest:
    if request.strategyProfile == "CUSTOM":
        return request

    configured = request.model_copy(deep=True)
    xau = configured.pairProfiles["XAUUSD"]
    eur = configured.pairProfiles["EURUSD"]

    if configured.strategyProfile == "CONSERVATIVE":
        configured.minScore = 75
        configured.riskValue = 0.2
        configured.maxTotalRiskPercent = 6.0
        configured.maxTotalOpenPositionsAllPairs = 4
        configured.scanIntervalSeconds = 30
        configured.duplicateCooldownMinutes = 30
        configured.recoveryEnabled = False
        _apply_pair(xau, 0.2, 0.05, 2, 0.10, 6, 2, 6.0, ["TRENDING", "SIDEWAYS"], 75, 82, 90)
        _apply_pair(eur, 0.15, 0.03, 1, 0.03, 3, 1, 3.0, ["TRENDING"], 78, 85, 92)
    elif configured.strategyProfile == "HIGH_RISK":
        configured.minScore = 60
        configured.riskValue = 0.5
        configured.maxTotalRiskPercent = 20.0
        configured.maxTotalOpenPositionsAllPairs = 15
        configured.scanIntervalSeconds = 10
        configured.duplicateCooldownMinutes = 5
        configured.recoveryEnabled = True
        _apply_pair(xau, 0.5, 0.10, 5, 0.50, 20, 10, 15.0, ["TRENDING", "SIDEWAYS", "HIGH_VOLATILITY"], 60, 68, 75)
        _apply_pair(eur, 0.5, 0.10, 2, 0.20, 10, 4, 10.0, ["TRENDING", "SIDEWAYS", "HIGH_VOLATILITY"], 62, 70, 78)
    else:
        configured.minScore = 65
        configured.riskValue = 0.35
        configured.maxTotalRiskPercent = 12.0
        configured.maxTotalOpenPositionsAllPairs = 8
        configured.scanIntervalSeconds = 15
        configured.duplicateCooldownMinutes = 15
        configured.recoveryEnabled = False
        _apply_pair(xau, 0.35, 0.10, 3, 0.30, 12, 4, 10.0, ["TRENDING", "SIDEWAYS", "HIGH_VOLATILITY"], 65, 72, 82, "advisory")
        _apply_pair(eur, 0.25, 0.05, 1, 0.05, 5, 2, 5.0, ["TRENDING", "SIDEWAYS"], 68, 76, 86)
    return configured


def _apply_pair(
    profile,
    risk_percent: float,
    max_lot: float,
    max_positions: int,
    max_total_lot: float,
    max_daily: int,
    max_hourly: int,
    aggregate_cap: float,
    allowed_regimes: list[str],
    trending_score: int,
    sideways_score: int,
    volatile_score: int,
    regime_mode: str = "strict",
) -> None:
    profile.riskPercent = risk_percent
    profile.maxLot = max_lot
    profile.maxOpenPositions = max_positions
    profile.maxTotalLot = max_total_lot
    profile.dailyTradeLimitEnabled = True
    profile.maxDailyTrades = max_daily
    profile.maxHourlyTrades = max_hourly
    profile.aggregateSlRiskCapPercent = aggregate_cap
    profile.marketRegimeMode = regime_mode
    profile.allowedMarketRegimes = allowed_regimes
    profile.trendingMinScore = trending_score
    profile.sidewaysMinScore = sideways_score
    profile.volatileMinScore = volatile_score
