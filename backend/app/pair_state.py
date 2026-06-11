from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .models import PairState, Symbol


def default_states() -> dict[Symbol, PairState]:
    return {
        "XAUUSD": PairState(symbol="XAUUSD"),
        "EURUSD": PairState(symbol="EURUSD"),
    }


class PairStateStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.corrupt = False
        self.error: str | None = None
        self.states = default_states()
        self.load()

    def load(self) -> None:
        if not self.path.exists():
            self.save()
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self.states = {
                symbol: PairState.model_validate(raw.get(symbol, {"symbol": symbol}))
                for symbol in ("XAUUSD", "EURUSD")
            }
        except Exception as exc:
            self.corrupt = True
            self.error = str(exc)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self.path.with_name(f"{self.path.stem}.tmp{self.path.suffix}")
        payload = {
            symbol: state.model_dump(mode="json")
            for symbol, state in self.states.items()
        }
        with temp_path.open("w", encoding="utf-8") as file:
            json.dump(payload, file, indent=2)
            file.flush()
            os.fsync(file.fileno())
        temp_path.replace(self.path)

    def get(self, symbol: Symbol) -> PairState:
        return self.states[symbol]

    def update(self, symbol: Symbol, **changes) -> PairState:
        state = self.states[symbol].model_copy(update=changes)
        state.updatedAt = datetime.now(timezone.utc).isoformat()
        self.states[symbol] = state
        self.save()
        return state

    def reset(self) -> None:
        self.corrupt = False
        self.error = None
        self.states = default_states()
        self.save()
