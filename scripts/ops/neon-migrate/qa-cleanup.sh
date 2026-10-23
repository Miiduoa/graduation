#!/usr/bin/env bash
# QA 清理：先 list 核對 receipt，再停止寫入後 apply。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=lib.sh
source ./lib.sh
need_cmd psql
need_cmd python3
require_pg18
MODE="${MODE:?請設 MODE=list 或 apply}"
DATABASE_URL="$(read_url DATABASE_URL)"
require_sslmode "$DATABASE_URL" DATABASE_URL
RECEIPT_DIR="${RECEIPT_DIR:-$PWD/receipts}"
mkdir_private "$RECEIPT_DIR"
NEON_MIGRATION_DATABASE_URL="$DATABASE_URL" MODE="$MODE" RECEIPT_DIR="$RECEIPT_DIR" python3 ./qa_cleanup.py
