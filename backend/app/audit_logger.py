from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock


_lock = Lock()


def append_audit(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "recordedAt": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    with _lock, path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, separators=(",", ":"), default=str) + "\n")
        file.flush()

