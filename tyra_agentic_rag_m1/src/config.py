from __future__ import annotations
import os
from pathlib import Path
from dataclasses import dataclass

# Commands should be executed from the project root.
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def root_path(value: str | Path) -> Path:
    value = Path(value).expanduser()
    return value if value.is_absolute() else PROJECT_ROOT / value


def load_env() -> None:
    f = PROJECT_ROOT / ".env"
    if not f.exists():
        return
    for line in f.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()


@dataclass(frozen=True)
class Settings:
    model: str = os.getenv("OLLAMA_MODEL", "qwen3:1.7b")
    host: str = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
    num_ctx: int = int(os.getenv("NUM_CTX", "4096"))
    max_rounds: int = int(os.getenv("MAX_RETRIEVAL_ROUNDS", "2"))
    db_path: Path = root_path(os.getenv("DB_PATH", "data/building.duckdb"))


SETTINGS = Settings()
