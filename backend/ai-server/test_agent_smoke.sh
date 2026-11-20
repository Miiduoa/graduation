#!/usr/bin/env bash
# backend/ai-server/test_agent_smoke.sh
# 用法：
#   chmod +x test_agent_smoke.sh
#   FIREBASE_ID_TOKEN=xxx ./test_agent_smoke.sh
#   AUTH_BYPASS=1 ./test_agent_smoke.sh
# 說明：
#   - FIREBASE_ID_TOKEN：正式驗證模式（建議）
#   - AUTH_BYPASS=1：本地快速回歸（需 server 已關閉 Firebase 驗證）

set -euo pipefail

BASE_URL="${AGENT_BASE_URL:-http://localhost:8100}"
TOKEN="${FIREBASE_ID_TOKEN:-dev_bypass}"
SCHOOL_ID="${SCHOOL_ID:-pu}"
AUTH_BYPASS="${AUTH_BYPASS:-0}"

PASS=0
FAIL=0

ensure_auth_mode() {
  if [ -n "${FIREBASE_ID_TOKEN:-}" ]; then
    echo "🔐 Auth 模式：Firebase ID Token"
    return
  fi
  if [ "$AUTH_BYPASS" = "1" ]; then
    echo "⚠️  Auth 模式：BYPASS（僅本地開發）"
    return
  fi
  echo "❌ FAIL：缺少 FIREBASE_ID_TOKEN。"
  echo "   若要本地 bypass，請改用 AUTH_BYPASS=1。"
  exit 1
}

check_server_status() {
  local status_resp
  status_resp=$(curl -s "${BASE_URL}/api/status")
  if [ -z "$status_resp" ]; then
    echo "❌ FAIL：無法連到 ${BASE_URL}/api/status，請先啟動 server。"
    exit 1
  fi
  local running
  running=$(echo "$status_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || true)
  if [ "$running" != "running" ]; then
    echo "❌ FAIL：/api/status 回傳異常：$status_resp"
    exit 1
  fi
  echo "🟢 Server 狀態正常：$BASE_URL"
}

run_case() {
  local label="$1"
  local message="$2"
  local expect_card_kind="$3"
  local expect_tool="$4"
  local verify_firestore="${5:-0}"

  echo ""
  echo "▶ [$label]"
  echo "  訊息：$message"

  RESP=$(curl -s -X POST "${BASE_URL}/api/agent/chat" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"message\": \"${message}\",
      \"history\": [],
      \"stream\": false,
      \"context\": { \"schoolId\": \"${SCHOOL_ID}\", \"userName\": \"SmokeTest\", \"role\": \"student\" }
    }")

  if [ -z "$RESP" ]; then
    echo "  ❌ FAIL：回傳為空"
    FAIL=$((FAIL + 1))
    return
  fi

  CONTENT=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('content',''))" 2>/dev/null || true)
  if [ -z "$CONTENT" ]; then
    echo "  ❌ FAIL：content 欄位缺失"
    echo "  原始回傳：$(echo "$RESP" | python3 -c "import sys; print(sys.stdin.read()[:400])" 2>/dev/null || echo "")"
    FAIL=$((FAIL + 1))
    return
  fi

  if [ -n "$expect_card_kind" ]; then
    HAS_CARD=$(echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
cards = d.get('cards') or []
kinds = [c.get('kind','') for c in cards]
print('yes' if '${expect_card_kind}' in kinds else 'no')
" 2>/dev/null || echo "no")
    if [ "$HAS_CARD" != "yes" ]; then
      echo "  ❌ FAIL：預期 card kind='${expect_card_kind}' 但沒找到"
      echo "  cards: $(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cards','[]'))" 2>/dev/null)"
      FAIL=$((FAIL + 1))
      return
    fi
  fi

  if [ -n "$expect_tool" ]; then
    HAS_TOOL=$(echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
calls = d.get('toolCalls') or []
names = [c.get('name','') for c in calls]
print('yes' if '${expect_tool}' in names else 'no')
" 2>/dev/null || echo "no")
    if [ "$HAS_TOOL" != "yes" ]; then
      echo "  ❌ FAIL：預期 tool='${expect_tool}' 但 toolCalls 裡沒有"
      echo "  toolCalls: $(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print([c.get('name') for c in (d.get('toolCalls') or [])])" 2>/dev/null)"
      FAIL=$((FAIL + 1))
      return
    fi
  fi

  if [ "$verify_firestore" = "1" ]; then
    TOOL_OK=$(echo "$RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
tool = '${expect_tool}'
calls = d.get('toolCalls') or []
target = None
for c in calls:
    if c.get('name') == tool:
        target = c
        break
if not target:
    print('no_tool')
    raise SystemExit(0)
out = target.get('output') or {}
if out.get('success') is True and out.get('errorCode') != 'firestore_error':
    print('ok')
else:
    print('bad')
" 2>/dev/null || echo "bad")
    if [ "$TOOL_OK" != "ok" ]; then
      echo "  ❌ FAIL：工具 '${expect_tool}' 未命中有效 Firestore 查詢（可能是 firestore_error）"
      echo "  toolCalls: $(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('toolCalls') or [])" 2>/dev/null)"
      FAIL=$((FAIL + 1))
      return
    fi
  fi

  echo "  ✅ PASS：content OK$([ -n "$expect_card_kind" ] && echo "，card '$expect_card_kind' 存在")$([ -n "$expect_tool" ] && echo "，tool '$expect_tool' 有呼叫")"
  echo "  回覆摘要：${CONTENT:0:80}…"
  PASS=$((PASS + 1))
}

ensure_auth_mode
check_server_status

run_case "導航-圖書館" "帶我去圖書館" "navigate" "navigateToScreen"
run_case "導航-餐廳" "我要去看餐廳" "navigate" "navigateToScreen"
run_case "導航-成績" "打開成績頁面" "navigate" "navigateToScreen"

run_case "查詢-作業" "我有什麼作業" "assignment_list" "getPendingAssignments" "1"
run_case "查詢-課表" "我今天有什麼課" "schedule_today" "getTodaySchedule" "1"
run_case "查詢-成績" "我這學期的成績怎樣" "grades_list" "getMyGrades" "1"
run_case "查詢-公告" "有什麼最新公告" "announcements_list" "getLatestAnnouncements" "1"

run_case "報修-冷氣" "我宿舍靜園311的冷氣壞了幫我報修" "" "createDormRepairRequest"
run_case "報修-口語" "房間好熱冷氣怪怪的" "" "createDormRepairRequest"
run_case "報修-狀態查詢" "查看我的報修狀態" "" "listMyDormRepairs"

run_case "訂餐-指定" "幫我訂學生餐廳的雞排飯" "" "createFoodOrder"
run_case "訂餐-午餐" "幫我訂午餐" "" "createFoodOrder"
run_case "提醒-建立" "明天早上8點提醒我交作業" "reminder_created" "createReminder"

run_case "防呆-報修被當查詢" "查看報修狀態" "" "listMyDormRepairs"

echo ""
echo "══════════════════════════════════"
echo "結果：✅ $PASS 通過 / ❌ $FAIL 失敗"
echo "══════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
