"""Centralized configuration for the Campus AI server."""

import os
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

LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "ollama")

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
