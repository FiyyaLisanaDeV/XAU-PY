from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
FLAGS = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP


def start(command: list[str], log_name: str, env: dict[str, str] | None = None) -> int:
    logs = ROOT / "logs"
    logs.mkdir(exist_ok=True)
    log = (logs / log_name).open("ab")
    process = subprocess.Popen(
        command,
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        creationflags=FLAGS,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        close_fds=True,
    )
    return process.pid


def main() -> None:
    backend_python = ROOT / ".venv" / "Scripts" / "python.exe"
    backend_pid = start(
        [
            str(backend_python),
            "-m",
            "uvicorn",
            "backend.app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "9000",
        ],
        "detached-backend.log",
    )
    frontend_pid = start(
        ["node", "scripts/serve-dist-proxy.cjs"],
        "detached-frontend.log",
        {"BACKEND_URL": "http://127.0.0.1:9000", "FRONTEND_PORT": "5174"},
    )
    print(f"backend_pid={backend_pid}")
    print(f"frontend_pid={frontend_pid}")


if __name__ == "__main__":
    main()
