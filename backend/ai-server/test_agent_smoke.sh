#!/usr/bin/env bash
# backend/ai-server/test_agent_smoke.sh
# 用法：
#   chmod +x test_agent_smoke.sh
#   FIREBASE_ID_TOKEN=xxx ./test_agent_smoke.sh
# 若沒有 token 可先用 AUTH_BYPASS=1（需在 server 開啟 DEV_BYPASS_AUTH）

set -euo pipefail

BASE_URL="${AGENT_BASE_URL:-http://localhost:8100}"
TOKEN="${FIREBASE_ID_TOKEN:-dev_bypass}"
SCHOOL_ID="${SCHOOL_ID:-pu}"

PASS=0
FAIL=0

run_case() {
  local label="$1"
  local message="$2"
  local expect_card_kind="$3"
  local expect_tool="$4"

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

  echo "  ✅ PASS：content OK$([ -n "$expect_card_kind" ] && echo "，card '$expect_card_kind' 存在")$([ -n "$expect_tool" ] && echo "，tool '$expect_tool' 有呼叫")"
  echo "  回覆摘要：${CONTENT:0:80}…"
  PASS=$((PASS + 1))
}

run_case "導航-圖書館" "帶我去圖書館" "navigate" "navigateToScreen"
run_case "導航-餐廳" "我要去看餐廳" "navigate" "navigateToScreen"
run_case "導航-成績" "打開成績頁面" "navigate" "navigateToScreen"

run_case "查詢-作業" "我有什麼作業" "assignment_list" "getPendingAssignments"
run_case "查詢-課表" "我今天有什麼課" "schedule_today" "getTodaySchedule"
run_case "查詢-成績" "我這學期的成績怎樣" "grades_list" "getMyGrades"
run_case "查詢-公告" "有什麼最新公告" "announcements_list" "getLatestAnnouncements"

run_case "報修-冷氣" "我宿舍靜園311的冷氣壞了幫我報修" "" "createDormRepairRequest"
run_case "報修-口語" "房間好熱冷氣怪怪的" "" "createDormRepairRequest"
run_case "報修-狀態查詢" "查看我的報修狀態" "" "listMyDormRepairs"

run_case "訂餐-指定" "幫我訂學生餐廳的雞排飯" "" "createFoodOrder"
run_case "訂餐-午餐" "幫我訂午餐" "" "createFoodOrder"

run_case "防呆-報修被當查詢" "查看報修狀態" "" "listMyDormRepairs"

echo ""
echo "══════════════════════════════════"
echo "結果：✅ $PASS 通過 / ❌ $FAIL 失敗"
echo "══════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
