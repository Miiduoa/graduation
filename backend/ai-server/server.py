"""Campus AI Server – FastAPI application.

Endpoints:
    POST /api/chat           – Main chat (RAG + LLM streaming)
    POST /api/chat/sync      – Non-streaming chat (for Cloud Function proxy)
    POST /api/feedback        – Save user feedback (thumbs up/down)
    GET  /api/status          – Health check & model info
    GET  /api/growth          – Self-training growth stats
    POST /api/admin/reindex   – Re-index APP knowledge + Firestore
    POST /api/admin/grow      – Manually trigger a growth cycle
    GET  /api/admin/feedback  – Download feedback log (for offline sync)
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    LLM_PROVIDER,
    SELF_TRAIN_INTERVAL_HOURS,
    ENABLE_SELF_TRAIN_LOOP,
    ENABLE_RAG,
    ENABLE_WEB_SEARCH,
    ENABLE_REFLEXION,
    FEEDBACK_DIR,
    FIREBASE_CRED_PATH,
    REQUIRE_FIREBASE_AUTH,
    AI_ADMIN_TOKEN,
    AI_ALLOWED_ORIGINS,
    PORT,
)
import llm_client
from reflexion import maybe_retry_with_reflexion, needs_quality_reflexion
from prompts.system import build_system_prompt
from prompts.campus_knowledge import get_full_knowledge_text
from web_search import search_public_web, format_web_context, should_use_web_search

if ENABLE_RAG:
    from rag.retriever import retrieve, format_context
    from rag.index_app_knowledge import index_all_app_knowledge

from self_training.dpo_trainer import save_feedback
from self_training.growth_engine import run_growth_cycle, get_growth_stats

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("campus-ai")

_campus_knowledge: str = ""
_growth_task: asyncio.Task | None = None


async def _scheduled_growth_loop():
    """Background loop that triggers self-training on a schedule."""
    while True:
        await asyncio.sleep(SELF_TRAIN_INTERVAL_HOURS * 3600)
        try:
            logger.info("Scheduled growth cycle starting...")
            result = await asyncio.to_thread(run_growth_cycle)
            logger.info("Scheduled growth result: %s", json.dumps(result, ensure_ascii=False)[:300])
        except Exception as e:
            logger.error("Scheduled growth failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _campus_knowledge, _growth_task

    logger.info("LLM provider: %s", LLM_PROVIDER)
    _campus_knowledge = get_full_knowledge_text()
    if ENABLE_RAG:
        logger.info("Indexing APP knowledge (RAG enabled)...")
        await asyncio.to_thread(index_all_app_knowledge)
        logger.info("APP knowledge indexed (%d chars)", len(_campus_knowledge))
    else:
        logger.info("RAG disabled – using hardcoded knowledge only (%d chars)", len(_campus_knowledge))

    if ENABLE_SELF_TRAIN_LOOP and LLM_PROVIDER == "ollama":
        _growth_task = asyncio.create_task(_scheduled_growth_loop())
        logger.info("Self-training scheduler started (every %dh)", SELF_TRAIN_INTERVAL_HOURS)
    else:
        logger.info("Self-training loop disabled (cloud mode or explicitly off)")

    yield

    if _growth_task:
        _growth_task.cancel()
    await llm_client.close()


app = FastAPI(title="Campus AI Server", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=AI_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return token.strip()


def _ensure_firebase_app():
    import firebase_admin
    from firebase_admin import credentials

    if firebase_admin._apps:
        return

    if FIREBASE_CRED_PATH:
        firebase_admin.initialize_app(credentials.Certificate(FIREBASE_CRED_PATH))
    else:
        firebase_admin.initialize_app()


async def require_firebase_user(authorization: str | None = Header(default=None)) -> dict:
    if not REQUIRE_FIREBASE_AUTH:
        return {"uid": "local-dev"}

    token = _extract_bearer_token(authorization)
    try:
        _ensure_firebase_app()
        from firebase_admin import auth

        return await asyncio.to_thread(auth.verify_id_token, token)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Firebase token verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid Firebase token") from exc


async def require_admin_token(authorization: str | None = Header(default=None)) -> None:
    if not AI_ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="AI admin token is not configured")

    token = _extract_bearer_token(authorization)
    if not node_safe_compare(token, AI_ADMIN_TOKEN):
        raise HTTPException(status_code=403, detail="Invalid admin token")


def node_safe_compare(left: str, right: str) -> bool:
    import hmac

    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


# ─── Request / Response Models ───────────────────────────────────────

class ChatMessage(BaseModel):
    role: str = "user"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    context: dict = Field(default_factory=dict)
    stream: bool = True


class FeedbackRequest(BaseModel):
    message_id: str
    user_message: str
    assistant_response: str
    rating: str = "thumbs_up"
    user_id: str | None = None


class WebSearchRequest(BaseModel):
    query: str


# ─── Chat Endpoints ──────────────────────────────────────────────────

async def _build_messages(req: ChatRequest) -> list[dict]:
    if ENABLE_RAG:
        rag_chunks = await asyncio.to_thread(retrieve, req.message)
        rag_context = format_context(rag_chunks)
    else:
        rag_context = ""

    web_context = ""
    if ENABLE_WEB_SEARCH and should_use_web_search(req.message):
        try:
            web_content, web_sources = await search_public_web(req.message)
            web_context = format_web_context(web_content, web_sources)
        except Exception as e:
            logger.warning("Web search failed: %s", e)

    system_prompt = build_system_prompt(
        campus_knowledge=_campus_knowledge,
        rag_context=rag_context,
        web_context=web_context,
        user_context=req.context,
        school_id=req.context.get("schoolId", "unknown"),
    )

    messages = [{"role": "system", "content": system_prompt}]
    for msg in req.history[-10:]:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": req.message})
    return messages


async def _stream_response(messages: list[dict]):
    """Yield SSE events from the LLM stream."""
    async for token in llm_client.stream(messages):
        yield f"data: {json.dumps({'token': token}, ensure_ascii=False)}\n\n"
    yield f"data: {json.dumps({'done': True})}\n\n"


async def _chat_response(req: ChatRequest):
    messages = await _build_messages(req)

    if req.stream:
        return StreamingResponse(
            _stream_response(messages),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    try:
        content = await llm_client.chat(messages)
        if ENABLE_REFLEXION and needs_quality_reflexion(content):
            content = await maybe_retry_with_reflexion(
                llm_client.chat,
                messages,
                req.message,
                content,
            )
    except Exception as e:
        logger.error("LLM chat failed: %s", e)
        content = "抱歉，AI 暫時忙碌中，請稍後再試。"

    suggestions = _extract_suggestions(content)

    return {
        "content": content,
        "suggestions": suggestions,
        "provider": LLM_PROVIDER,
    }


@app.post("/api/chat")
async def chat(req: ChatRequest, _user: dict = Depends(require_firebase_user)):
    return await _chat_response(req)


@app.post("/api/chat/sync")
async def chat_sync(req: ChatRequest, _user: dict = Depends(require_firebase_user)):
    req.stream = False
    return await _chat_response(req)


@app.post("/api/tools/web-search")
async def web_search(req: WebSearchRequest, _user: dict = Depends(require_firebase_user)):
    if not ENABLE_WEB_SEARCH:
        return {"enabled": False, "content": "", "sources": []}
    content, sources = await search_public_web(req.query)
    return {
        "enabled": True,
        "content": content,
        "sources": [source.__dict__ for source in sources],
    }


def _extract_suggestions(text: str) -> list[str]:
    import re
    match = re.search(r"(?:建議選項|建議)[：:]\s*([^\n]+)", text)
    if match:
        items = re.split(r"[、,，;；]", match.group(1))
        return [s.strip() for s in items if 1 < len(s.strip()) <= 8][:3]
    return []


# ─── Feedback Endpoint ───────────────────────────────────────────────

@app.post("/api/feedback")
async def submit_feedback_endpoint(req: FeedbackRequest, _user: dict = Depends(require_firebase_user)):
    await asyncio.to_thread(
        save_feedback,
        message_id=req.message_id,
        user_message=req.user_message,
        assistant_response=req.assistant_response,
        rating=req.rating,
        user_id=req.user_id,
    )
    return {"status": "ok", "message": "感謝你的回饋！這會幫助我變得更好。"}


# ─── Admin Endpoints ─────────────────────────────────────────────────

@app.post("/api/admin/reindex")
async def reindex(_admin: None = Depends(require_admin_token)):
    if not ENABLE_RAG:
        raise HTTPException(status_code=400, detail="RAG is disabled")
    count = await asyncio.to_thread(index_all_app_knowledge)
    return {"status": "ok", "chunks_indexed": count}


@app.post("/api/admin/grow")
async def trigger_growth(_admin: None = Depends(require_admin_token)):
    result = await asyncio.to_thread(run_growth_cycle, True)
    return {"status": "ok", "result": result}


@app.get("/api/admin/feedback")
async def download_feedback(_admin: None = Depends(require_admin_token)):
    """Return all feedback as JSON array – used by offline sync."""
    feedback_file = FEEDBACK_DIR / "feedback_log.jsonl"
    if not feedback_file.exists():
        return {"feedback": []}
    lines = feedback_file.read_text(encoding="utf-8").strip().split("\n")
    data = [json.loads(line) for line in lines if line.strip()]
    return {"feedback": data, "count": len(data)}


@app.get("/api/growth")
async def growth_stats(_admin: None = Depends(require_admin_token)):
    stats = await asyncio.to_thread(get_growth_stats)
    return stats


@app.get("/api/status")
async def status():
    return {
        "status": "running",
        "authRequired": REQUIRE_FIREBASE_AUTH,
        "ragEnabled": ENABLE_RAG,
        "webSearchEnabled": ENABLE_WEB_SEARCH,
    }


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=False)
