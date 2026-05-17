#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║  Demo Server 啟動腳本 — 給 AI 自動截圖用                       ║
# ║                                                                  ║
# ║  跑法：                                                          ║
# ║    cd ~/Desktop/畢業專題                                          ║
# ║    bash start-demo-for-screenshots.sh                            ║
# ║                                                                  ║
# ║  跑完會起 2 個 dev server：                                      ║
# ║    1. http://localhost:3000   (Web demo · Next.js)               ║
# ║    2. http://localhost:8081   (Mobile · Expo web mode)           ║
# ║                                                                  ║
# ║  起好之後回 Claude 說「好了」，                                   ║
# ║  我會用 Chrome MCP 自動切 8 角色 + 5 cockpit 連續截圖，          ║
# ║  存進 demo-media/ 並重 build PPT。                              ║
# ╚══════════════════════════════════════════════════════════════════╝
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "═══════════════════════════════════════════════════════════════"
echo "  Demo Server 啟動中（兩個 dev server 同時起）"
echo "═══════════════════════════════════════════════════════════════"

# ── 1. 啟 Web demo (Next.js) ──
echo ""
echo "[1/2] 啟 Web demo (apps/web · http://localhost:3000)..."
(cd "$ROOT/apps/web" && pnpm dev > /tmp/web-dev.log 2>&1) &
WEB_PID=$!
echo "       PID=$WEB_PID, log → /tmp/web-dev.log"

# ── 2. 啟 Mobile Expo web mode ──
echo ""
echo "[2/2] 啟 Mobile Expo web mode (apps/mobile · http://localhost:8081)..."
(cd "$ROOT/apps/mobile" && EXPO_PUBLIC_AI_PROVIDER=offline EXPO_PUBLIC_TRONCLASS_DATA_ENABLED=false npx expo start --web --port 8081 > /tmp/mobile-dev.log 2>&1) &
MOB_PID=$!
echo "       PID=$MOB_PID, log → /tmp/mobile-dev.log"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ⏳ 等 30 秒讓兩個 server 起來..."
echo "═══════════════════════════════════════════════════════════════"
for i in {1..30}; do
  sleep 1
  printf "."
done
echo ""

# ── 健檢 ──
echo ""
echo "── 健檢 ──"
WEB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000 || echo "000")
MOB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:8081 || echo "000")
echo "  Web (localhost:3000) → HTTP $WEB_STATUS"
echo "  Mobile (localhost:8081) → HTTP $MOB_STATUS"

if [ "$WEB_STATUS" != "200" ] && [ "$WEB_STATUS" != "307" ] && [ "$WEB_STATUS" != "302" ]; then
  echo "  ⚠️ Web 起不來，看 /tmp/web-dev.log"
  tail -20 /tmp/web-dev.log
fi
if [ "$MOB_STATUS" != "200" ] && [ "$MOB_STATUS" != "307" ] && [ "$MOB_STATUS" != "302" ]; then
  echo "  ⚠️ Mobile expo web 起不來（可能要 1-2 分鐘 metro bundler），看 /tmp/mobile-dev.log"
  tail -20 /tmp/mobile-dev.log
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ 服務跑著了。回 Claude 說「好了」開始自動截圖"
echo ""
echo "  關掉服務：kill $WEB_PID $MOB_PID"
echo "  或 Ctrl+C"
echo "═══════════════════════════════════════════════════════════════"

# 等到 user Ctrl+C
wait
