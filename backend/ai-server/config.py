"""Centralized configuration for the Campus AI server."""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _parse_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() == "true"


def _parse_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _normalize_bind_host(host: str) -> str:
    return host.strip().lower().strip("[]")


def is_loopback_bind(host: str) -> bool:
    """Return True when the bind address is loopback-only."""
    normalized = _normalize_bind_host(host)
    return normalized in {"127.0.0.1", "localhost", "::1"}


def is_blank_bind(host: str | None) -> bool:
    """Return True for explicit empty/whitespace hosts (unsupported)."""
    return host is not None and str(host).strip() == ""


def is_public_bind(host: str) -> bool:
    """Return True when the bind address accepts non-loopback connections.

    Blank/whitespace hosts are treated as public/invalid (fail closed): real
    Uvicorn binds ``host=""`` to ``0.0.0.0``/``::``. Callers must still reject
    blanks via ``assert_bind_allowed`` — blank is unsupported, not a valid bind.
    """
    normalized = _normalize_bind_host(host)
    if not normalized:
        # Explicit empty / whitespace: Uvicorn wildcard semantics; fail closed.
        return True
    if is_loopback_bind(normalized):
        return False
    # Unspecified / all-interfaces binds used by containers and LAN exposure.
    return normalized in {"0.0.0.0", "::", "*"} or not is_loopback_bind(normalized)


def bind_host_from_argv(argv: list[str] | None = None) -> str | None:
    """Parse uvicorn/Click-style ``--host`` from argv.

    Click keeps the **last** duplicate option value (``multiple=False``), matching
    real ``uvicorn`` CLI behavior — not the first occurrence.
    """
    args = list(sys.argv if argv is None else argv)
    found: str | None = None
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--host" and index + 1 < len(args):
            found = args[index + 1]
            index += 2
            continue
        if arg.startswith("--host="):
            found = arg.split("=", 1)[1]
        index += 1
    return found


def _env_bind_host(value: str | None, *, click_empty_ignored: bool) -> str | None:
    """Map an env host value to resolved form, or None when absent/ignored.

    Click ignores a truly empty ``UVICORN_HOST`` (treats as unset → uvicorn
    default). Whitespace-only env values are **not** ignored: return ``""`` so
    policy fail-closes (unsupported blank). Non-blank values are stripped.
    """
    if value is None:
        return None
    if value == "" and click_empty_ignored:
        return None
    if not str(value).strip():
        return ""
    return str(value).strip()


def resolve_bind_host(
    *,
    explicit: str | None = None,
    argv: list[str] | None = None,
    environ: dict[str, str] | None = None,
) -> str:
    """Resolve listen host for owned entrypoints.

    Precedence: explicit > last CLI ``--host`` > ``UVICORN_HOST`` >
    ``AI_SERVER_HOST`` > loopback.

    Distinguishes **absent** (``None`` / omitted CLI) from **explicit blank**
    (``--host=``, ``--host ""``, whitespace). Explicit blanks are returned as
    ``""`` and must be rejected by ``assert_bind_allowed`` — never silently
    fall back to loopback (Uvicorn would still bind wildcard).

    ``UVICORN_HOST`` is the Click ``auto_envvar_prefix=UVICORN`` env for
    ``uvicorn``'s ``--host`` (cloud/external uvicorn CLI). A truly empty
    ``UVICORN_HOST=`` is ignored like Click; whitespace-only env is treated as
    unsupported blank (fail closed). Default remains loopback so
    unauthenticated local/Ollama runs are not LAN-exposed. Container images
    set ``AI_SERVER_HOST=0.0.0.0`` and/or uvicorn ``--host 0.0.0.0`` under the
    existing Firebase auth contract. No insecure opt-out.
    """
    env = os.environ if environ is None else environ

    if explicit is not None:
        # Present even when ""; strip whitespace-only → "" (unsupported blank).
        return str(explicit).strip()

    cli_host = bind_host_from_argv(argv)
    if cli_host is not None:
        # Last CLI --host / --host= including explicit empty — do not fall back.
        return str(cli_host).strip()

    for raw, click_empty_ignored in (
        (env.get("UVICORN_HOST"), True),
        (env.get("AI_SERVER_HOST"), True),
    ):
        mapped = _env_bind_host(raw, click_empty_ignored=click_empty_ignored)
        if mapped is not None:
            return mapped

    return "127.0.0.1"


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CHROMA_DIR = DATA_DIR / "chroma_db"
TRAINING_DIR = DATA_DIR / "training"
FEEDBACK_DIR = DATA_DIR / "feedback"
LORA_OUTPUT_DIR = DATA_DIR / "lora_adapters"
SELF_TRAIN_DIR = DATA_DIR / "self_training"

for d in (DATA_DIR, CHROMA_DIR, TRAINING_DIR, FEEDBACK_DIR, LORA_OUTPUT_DIR, SELF_TRAIN_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ─── LLM Provider ────────────────────────────────────────────────────
# "ollama"   – local Ollama server (development)
# "together" – Together.ai cloud API (production)
# "groq"     – Groq cloud API (free fallback)
#
# 預設改為 groq：訂餐／工具除錯時可避免未啟動 Ollama 卻被當成「本機模型失敗」。
# 本機純離線除錯請在 .env 設 LLM_PROVIDER=ollama。
# LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "ollama")
LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "groq")

# Ollama (local development)
OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
MODEL_NAME: str = os.getenv("OLLAMA_MODEL", "qwen3:8b")

# OpenAI-compatible cloud providers (Together.ai / Groq / OpenRouter)
_PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    "together": {
        "base_url": "https://api.together.xyz/v1",
        "model": "Qwen/Qwen3-8B",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "qwen/qwen3-32b",
    },
}

_defaults = _PROVIDER_DEFAULTS.get(LLM_PROVIDER, {})
OPENAI_COMPAT_BASE_URL: str = os.getenv("OPENAI_COMPAT_BASE_URL", _defaults.get("base_url", ""))
OPENAI_COMPAT_API_KEY: str = os.getenv("OPENAI_COMPAT_API_KEY", "")
OPENAI_COMPAT_MODEL: str = os.getenv("OPENAI_COMPAT_MODEL", _defaults.get("model", ""))

# Convenience aliases so env can also be provider-specific
if not OPENAI_COMPAT_API_KEY:
    OPENAI_COMPAT_API_KEY = os.getenv("TOGETHER_API_KEY", "") or os.getenv("GROQ_API_KEY", "")

EMBEDDING_MODEL = "BAAI/bge-m3"

# ─── RAG ─────────────────────────────────────────────────────────────

ENABLE_RAG: bool = os.getenv("ENABLE_RAG", "true").lower() == "true"
ENABLE_WEB_SEARCH: bool = os.getenv("ENABLE_WEB_SEARCH", "true").lower() == "true"
RAG_TOP_K = 5
RAG_CHUNK_SIZE = 512
RAG_CHUNK_OVERLAP = 64

# ─── Self-training ───────────────────────────────────────────────────

SELF_TRAIN_INTERVAL_HOURS = int(os.getenv("SELF_TRAIN_INTERVAL_HOURS", "6"))
SELF_TRAIN_MIN_FEEDBACK = 50
SELF_TRAIN_BATCH_SIZE = 200
ENABLE_SELF_TRAIN_LOOP: bool = os.getenv("ENABLE_SELF_TRAIN_LOOP", "false").lower() == "true"

# Reflexion：同步 /api/chat 時若首輪回答過短或典型失敗话术，反思後再問 LLM 一次（串流模式不套用）
ENABLE_REFLEXION: bool = _parse_bool("ENABLE_REFLEXION", default=False)

# ─── Firebase (optional – only for Firestore sync) ──────────────────

FIREBASE_CRED_PATH: str | None = os.getenv("FIREBASE_CRED_PATH")
REQUIRE_FIREBASE_AUTH: bool = _parse_bool(
    "REQUIRE_FIREBASE_AUTH",
    default=LLM_PROVIDER != "ollama",
)
AI_ADMIN_TOKEN: str = os.getenv("AI_ADMIN_TOKEN", "")
AI_ALLOWED_ORIGINS: list[str] = _parse_csv(
    os.getenv("AI_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"),
)

FIRESTORE_SYNC_INTERVAL_MINUTES = 15
FIRESTORE_COLLECTIONS = [
    "announcements",
    "events",
    "courses",
    "cafeterias",
    "menuItems",
    "pois",
]

# ─── Paths ───────────────────────────────────────────────────────────

APP_SRC_ROOT = BASE_DIR.parent.parent / "apps" / "mobile" / "src"

# ─── Server ──────────────────────────────────────────────────────────

PORT = int(os.getenv("PORT", "8100"))
# Default loopback for local `python server.py`. Docker sets AI_SERVER_HOST=0.0.0.0
# and/or uvicorn --host / UVICORN_HOST under REQUIRE_FIREBASE_AUTH (see render.yaml).
AI_SERVER_HOST: str = resolve_bind_host()


def assert_bind_allowed(
    host: str,
    *,
    require_firebase_auth: bool | None = None,
) -> None:
    """Fail closed on public binds unless Firebase auth is required.

    Explicit blank/whitespace hosts are always rejected (unsupported): Uvicorn
    treats ``host=""`` as a wildcard bind. Omit ``--host`` for the loopback
    default, or pass an explicit non-blank host. There is no insecure opt-out.
    Cloud/Docker public bind remains valid when ``REQUIRE_FIREBASE_AUTH=true``
    (Render blueprint / hosted contract).
    """
    if is_blank_bind(host):
        raise RuntimeError(
            "Refusing unsupported blank bind host. Explicit empty/whitespace "
            "`--host=` / `--host \"\"` (including a last duplicate blank) is "
            "not supported — Uvicorn would bind 0.0.0.0/::. Omit --host for "
            "loopback default, or set an explicit non-blank host "
            "(public binds still require REQUIRE_FIREBASE_AUTH=true)."
        )
    auth_required = (
        REQUIRE_FIREBASE_AUTH if require_firebase_auth is None else require_firebase_auth
    )
    if is_public_bind(host) and not auth_required:
        raise RuntimeError(
            "Refusing to bind AI server to a non-loopback address without "
            "REQUIRE_FIREBASE_AUTH=true. Local/unauthenticated use must stay on "
            "127.0.0.1 (default). For hosted Docker, keep Firebase auth enabled "
            "as in render.yaml; do not expose Ollama/dev mode on 0.0.0.0."
        )
