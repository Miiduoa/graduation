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
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import (
    LLM_PROVIDER,
    SELF_TRAIN_INTERVAL_HOURS,
    ENABLE_SELF_TRAIN_LOOP,
    ENABLE_RAG,
    FEEDBACK_DIR,
    PORT,
)
import llm_client
from prompts.system import build_system_prompt
from prompts.campus_knowledge import get_full_knowledge_text

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
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


# ─── Chat Endpoints ──────────────────────────────────────────────────

async def _build_messages(req: ChatRequest) -> list[dict]:
    if ENABLE_RAG:
        rag_chunks = await asyncio.to_thread(retrieve, req.message)
        rag_context = format_context(rag_chunks)
    else:
        rag_context = ""

    system_prompt = build_system_prompt(
        campus_knowledge=_campus_knowledge,
        rag_context=rag_context,
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


@app.post("/api/chat")
async def chat(req: ChatRequest):
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
    except Exception as e:
        logger.error("LLM chat failed: %s", e)
        content = "抱歉，AI 暫時忙碌中，請稍後再試。"

    suggestions = _extract_suggestions(content)

    return {
        "content": content,
        "suggestions": suggestions,
        "provider": LLM_PROVIDER,
    }


@app.post("/api/chat/sync")
async def chat_sync(req: ChatRequest):
    req.stream = False
    return await chat(req)


def _extract_suggestions(text: str) -> list[str]:
    import re
    match = re.search(r"(?:建議選項|建議)[：:]\s*([^\n]+)", text)
    if match:
        items = re.split(r"[、,，;；]", match.group(1))
        return [s.strip() for s in items if 1 < len(s.strip()) <= 8][:3]
    return []


# ─── Feedback Endpoint ───────────────────────────────────────────────

@app.post("/api/feedback")
async def submit_feedback_endpoint(req: FeedbackRequest):
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
async def reindex():
    count = await asyncio.to_thread(index_all_app_knowledge)
    return {"status": "ok", "chunks_indexed": count}


@app.post("/api/admin/grow")
async def trigger_growth():
    result = await asyncio.to_thread(run_growth_cycle, True)
    return {"status": "ok", "result": result}


@app.get("/api/admin/feedback")
async def download_feedback():
    """Return all feedback as JSON array – used by offline sync."""
    feedback_file = FEEDBACK_DIR / "feedback_log.jsonl"
    if not feedback_file.exists():
        return {"feedback": []}
    lines = feedback_file.read_text(encoding="utf-8").strip().split("\n")
    data = [json.loads(line) for line in lines if line.strip()]
    return {"feedback": data, "count": len(data)}


@app.get("/api/growth")
async def growth_stats():
    stats = await asyncio.to_thread(get_growth_stats)
    return stats


@app.get("/api/status")
async def status():
    health = await llm_client.health_check()
    growth = await asyncio.to_thread(get_growth_stats)

    return {
        "status": "running",
        "llm": health,
        "growth": growth,
    }


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=False)
