#!/bin/bash
# Git push script - double-click to run
cd "$(dirname "$0")"

echo "🔧 清除 git lock..."
rm -f .git/index.lock .git/index.backup

echo "📦 Staging all changes (excluding .bak files)..."
git add -A
git reset HEAD -- $(find . -name "*.bak" -o -name "*.bak2" 2>/dev/null | sed 's|^\./||') 2>/dev/null || true

echo "📝 Staged files:"
git diff --cached --stat

echo ""
echo "💾 Committing..."
git commit -m "feat(all): Agent控制台×風險引擎×室內圖×TDX×商家後台×Web inbox/公告詳情；README 對齊 2026-05-17 push（1128/151/81/32）

Mobile:
- AIAgentConsoleScreen + AgentSummaryBanner + aiAgentRuntime + personaContext
- AIAgentObservatoryScreen / AIChatScreen SemReasoner 對齊
- studentRiskEngine + StudentRiskScreen (Jest: studentRiskEngine.test)
- indoorMaps + IndoorFloorMapScreen（室內樓層導覽）
- tdxLive（公車 TDX 即時層）+ offlineCache
- routeRegistry + safeNavigate 擴充 + roleEventBus + savedPlaces
- VendorLoyaltyPushScreen / VendorMenuManageScreen / VendorRevenueReportScreen
- DemoStoryScreen / LifeRequestsScreen / TeachingEvaluationScreen
- demoRole.tsx（CombinedProviders 離線 context 收斂）
- LoginLandingScreen / SettingsScreen / 多畫面小調

Web:
- demoStore.ts（localStorage + CustomEvent 跨分頁同步）
- useRoleScopedState + roleNotifications
- /messages page.tsx（訊息中心）
- /announcements/[id] dynamic route（公告詳情）
- /admin/students/[id]（管理端學生卡）
- SiteShell / DemoRolePill / 多頁角色對齊

Jest: orderFlow, debug_quantity, safeNavigate, studentRiskEngine

Docs/工具:
- AUDIT_REPORT.md（TypeScript 0-error, ESLint 0-warn 驗證）
- docs/REMAINING_BUGS_AUDIT / CROSS_ROLE_DATA_FLOW / ROLE_FEATURE_MATRIX
- docs/CONSOLIDATION_PLAN / DEMO_NARRATIVE
- start-demo-for-screenshots.sh/.command
- demo_預覽/persona_switch_demo.html
- 口試資產 _v2/_v3（簡報/腳本/README/矩陣）

README: 快照數字對齊 1128/151/15/81/32；QA 摘要新增 05-17 批次說明"

echo ""
echo "🚀 Pushing to GitHub main..."
git push origin main

echo ""
echo "✅ Done! Press any key to close."
read -n 1
