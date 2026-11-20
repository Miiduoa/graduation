"""Offline sync – pull feedback from cloud server for local self-training.

Usage (from project root):
    cd backend/ai-server
    python -m self_training.cloud_sync --server-url https://your-app.onrender.com

This downloads user feedback from the production server, merges it with
local data, and prepares it for the next self-training cycle.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import httpx

from config import FEEDBACK_DIR

logger = logging.getLogger(__name__)


def sync_feedback(server_url: str) -> int:
    """Download feedback from the cloud server and merge locally."""
    url = f"{server_url.rstrip('/')}/api/admin/feedback"
    logger.info("Fetching feedback from %s ...", url)

    resp = httpx.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    remote_items: list[dict] = data.get("feedback", [])
    if not remote_items:
        logger.info("No remote feedback to sync.")
        return 0

    local_file = FEEDBACK_DIR / "feedback_log.jsonl"
    existing_ids: set[str] = set()

    if local_file.exists():
        with open(local_file, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    try:
                        existing_ids.add(json.loads(line)["message_id"])
                    except (json.JSONDecodeError, KeyError):
                        pass

    new_count = 0
    with open(local_file, "a", encoding="utf-8") as f:
        for item in remote_items:
            if item.get("message_id") not in existing_ids:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
                new_count += 1

    logger.info("Synced %d new feedback items (skipped %d duplicates)", new_count, len(remote_items) - new_count)
    return new_count


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Sync feedback from cloud server")
    parser.add_argument("--server-url", required=True, help="Production server URL")
    args = parser.parse_args()
    sync_feedback(args.server_url)
