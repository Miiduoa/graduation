# 站內連結盤點

掃描 apps/web/src 的正式程式碼，共 339 筆導航路徑、124 個頁面／端點；未列例外的不存在路由 0 筆。

按來源及目標推定主要角色，共用入口歸學生；這不是權限驗證。包含共用課務設定 webPath、next.config redirects、啟用時的 legacy rewrites 與 public 靜態檔。legacy 端點僅代表既有路由契約，不保證未啟用 legacy 時可用。

本次沒有能確認的錯字或改名斷鏈，因此沒有修改產品入口。僅因變數名稱含 path／url 的非導航常數不再納入；目前沒有需要保留的外部端點例外。

靜態分析從 href、明確設定欄位及導航呼叫的完整表達式遞迴解析條件式、邏輯式、模板、拼接與同作用域變數；動態值獨佔路徑段時以佔位值比對。未知計算、循環引用與無法判定的動態後綴另列未知，不判斷斷鏈。執行期 API／使用者資料提供的完整網址、任意跨檔函式計算結果不在靜態證明範圍，亦未驗證每筆動態資源存在或角色授權。

重建：`EXPO_NO_DOTENV=1 DOTENV_CONFIG_PATH=/dev/null LINK_INTEGRITY_REPORT=1 pnpm --filter web exec vitest run src/lib/link-integrity/internal-links.test.ts`

588 筆目標無法靜態推導，列為未知、不判斷斷鏈。

| 來源 | 結果 |
| --- | --- |
| app/.well-known/assetlinks.json/route.ts:11 | 未知：無法靜態推導完整站內目標 |
| app/.well-known/assetlinks.json/route.ts:14 | 未知：無法靜態推導完整站內目標 |
| app/.well-known/assetlinks.json/route.ts:27 | 未知：無法靜態推導完整站內目標 |
| app/admin/announcements/AnnouncementAdminForm.tsx:153 | 未知：無法靜態推導完整站內目標 |
| app/admin/announcements/SchoolAnnouncementsAdmin.tsx:97 | 未知：無法靜態推導完整站內目標 |
| app/admin/announcements/SchoolAnnouncementsAdmin.tsx:179 | 未知：無法靜態推導完整站內目標 |
| app/ai-assistant/AgentCards.tsx:109 | 未知：無法靜態推導完整站內目標 |
| app/ai-assistant/AgentCards.tsx:273 | 未知：無法靜態推導完整站內目標 |
| app/ai-assistant/AgentCards.tsx:781 | 未知：無法靜態推導完整站內目標 |
| app/ai-assistant/AgentWritePanel.tsx:145 | 未知：無法靜態推導完整站內目標 |
| app/ai-assistant/AgentWritePanel.tsx:151 | 未知：無法靜態推導完整站內目標 |
| app/ai-assistant/AgentWritePanel.tsx:157 | 未知：無法靜態推導完整站內目標 |
| app/ai-assistant/page.tsx:271 | 未知：無法靜態推導完整站內目標 |
| app/ai-assistant/page.tsx:393 | 未知：無法靜態推導完整站內目標 |
| app/announcements/[id]/page.tsx:184 | 未知：無法靜態推導完整站內目標 |
| app/announcements/[id]/page.tsx:228 | 未知：無法靜態推導完整站內目標 |
| app/announcements/page.tsx:84 | 未知：無法靜態推導完整站內目標 |
| app/announcements/page.tsx:106 | 未知：無法靜態推導完整站內目標 |
| app/announcements/page.tsx:464 | 未知：無法靜態推導完整站內目標 |
| app/announcements/page.tsx:475 | 未知：無法靜態推導完整站內目標 |
| app/auth/account/AccountEntry.tsx:85 | 未知：無法靜態推導完整站內目標 |
| app/auth/account/AccountEntry.tsx:92 | 未知：無法靜態推導完整站內目標 |
| app/auth/account/AccountEntry.tsx:247 | 未知：無法靜態推導完整站內目標 |
| app/auth/account/legacyLogin.ts:313 | 未知：無法靜態推導完整站內目標 |
| app/auth/account/legacyLogin.ts:417 | 未知：無法靜態推導完整站內目標 |
| app/auth/account/legacyLogin.ts:586 | 未知：無法靜態推導完整站內目標 |
| app/auth/account/legacyLogin.ts:678 | 未知：無法靜態推導完整站內目標 |
| app/auth/platform/class-workspace/[workspaceId]/page.tsx:12 | 未知：無法靜態推導完整站內目標 |
| app/bus/BusContext.tsx:48 | 未知：無法靜態推導完整站內目標 |
| app/bus/registered/page.tsx:102 | 未知：無法靜態推導完整站內目標 |
| app/bus/registered/page.tsx:102 | 未知：無法靜態推導完整站內目標 |
| app/bus/registered/page.tsx:106 | 未知：無法靜態推導完整站內目標 |
| app/bus/registered/page.tsx:207 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/[id]/edit/page.tsx:177 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/[id]/order/page.tsx:87 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/[id]/order/page.tsx:131 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/[id]/order/page.tsx:150 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/[id]/page.tsx:111 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/[id]/page.tsx:154 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/[id]/page.tsx:518 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/page.tsx:169 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/page.tsx:371 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/page.tsx:444 | 未知：無法靜態推導完整站內目標 |
| app/cafeteria/page.tsx:450 | 未知：無法靜態推導完整站內目標 |
| app/calendar/page.tsx:32 | 未知：無法靜態推導完整站內目標 |
| app/calendar/page.tsx:32 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:17 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:18 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:19 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:34 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:38 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:56 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:70 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:80 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:83 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:85 | 未知：無法靜態推導完整站內目標 |
| app/classroom/classroomDeepLink.ts:87 | 未知：無法靜態推導完整站內目標 |
| app/classroom/course/[workspaceId]/ClassroomDeepLinkFocus.tsx:81 | 未知：無法靜態推導完整站內目標 |
| app/classroom/course/[workspaceId]/ClassroomDeepLinkFocus.tsx:88 | 未知：無法靜態推導完整站內目標 |
| app/classroom/course/[workspaceId]/ClassroomDeepLinkFocus.tsx:90 | 未知：無法靜態推導完整站內目標 |
| app/classroom/course/[workspaceId]/ClassroomDeepLinkFocus.tsx:96 | 未知：無法靜態推導完整站內目標 |
| app/classroom/grades/page.tsx:10 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/BoardsTab.tsx:282 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/BoardsTab.tsx:336 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/CommunityAccess.tsx:27 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/FeedTab.tsx:467 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/FeedTab.tsx:619 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/FeedTab.tsx:717 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/FeedTab.tsx:782 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/FeedTab.tsx:813 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/FeedTab.tsx:884 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/FeedTab.tsx:931 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/FeedTab.tsx:956 | 未知：無法靜態推導完整站內目標 |
| app/community/_components/RealtimeTab.tsx:329 | 未知：無法靜態推導完整站內目標 |
| app/community/board/[boardId]/page.tsx:188 | 未知：無法靜態推導完整站內目標 |
| app/community/board/[boardId]/page.tsx:232 | 未知：無法靜態推導完整站內目標 |
| app/community/page.tsx:60 | 未知：無法靜態推導完整站內目標 |
| app/community/page.tsx:72 | 未知：無法靜態推導完整站內目標 |
| app/community/page.tsx:75 | 未知：無法靜態推導完整站內目標 |
| app/community/post/[postId]/page.tsx:251 | 未知：無法靜態推導完整站內目標 |
| app/community/post/new/page.tsx:196 | 未知：無法靜態推導完整站內目標 |
| app/community/post/new/page.tsx:232 | 未知：無法靜態推導完整站內目標 |
| app/community/post/new/page.tsx:234 | 未知：無法靜態推導完整站內目標 |
| app/community/post/new/page.tsx:279 | 未知：無法靜態推導完整站內目標 |
| app/community/story/new/page.tsx:120 | 未知：無法靜態推導完整站內目標 |
| app/course/[courseId]/page.tsx:375 | 未知：無法靜態推導完整站內目標 |
| app/course/[courseId]/page.tsx:415 | 未知：無法靜態推導完整站內目標 |
| app/course/[courseId]/page.tsx:467 | 未知：無法靜態推導完整站內目標 |
| app/credit-planner/page.tsx:131 | 未知：無法靜態推導完整站內目標 |
| app/dormitory/page.tsx:433 | 未知：無法靜態推導完整站內目標 |
| app/dormitory/page.tsx:448 | 未知：無法靜態推導完整站內目標 |
| app/dormitory/page.tsx:454 | 未知：無法靜態推導完整站內目標 |
| app/dormitory/page.tsx:456 | 未知：無法靜態推導完整站內目標 |
| app/dormitory/page.tsx:473 | 未知：無法靜態推導完整站內目標 |
| app/dormitory/page.tsx:479 | 未知：無法靜態推導完整站內目標 |
| app/dormitory/page.tsx:745 | 未知：無法靜態推導完整站內目標 |
| app/friends/page.tsx:70 | 未知：無法靜態推導完整站內目標 |
| app/friends/page.tsx:559 | 未知：無法靜態推導完整站內目標 |
| app/groups/GroupDirectory.tsx:235 | 未知：無法靜態推導完整站內目標 |
| app/groups/GroupDirectory.tsx:245 | 未知：無法靜態推導完整站內目標 |
| app/groups/GroupDirectory.tsx:249 | 未知：無法靜態推導完整站內目標 |
| app/groups/GroupDirectory.tsx:256 | 未知：無法靜態推導完整站內目標 |
| app/groups/GroupDirectory.tsx:347 | 未知：無法靜態推導完整站內目標 |
| app/groups/GroupDirectory.tsx:353 | 未知：無法靜態推導完整站內目標 |
| app/groups/GroupDirectory.tsx:374 | 未知：無法靜態推導完整站內目標 |
| app/groups/GroupDiscussion.tsx:634 | 未知：無法靜態推導完整站內目標 |
| app/groups/GroupDiscussion.tsx:635 | 未知：無法靜態推導完整站內目標 |
| app/groups/GroupDiscussion.tsx:647 | 未知：無法靜態推導完整站內目標 |
| app/join/page.tsx:10 | 未知：無法靜態推導完整站內目標 |
| app/leave/LeaveStatusPanel.tsx:51 | 未知：無法靜態推導完整站內目標 |
| app/library/page.tsx:89 | 未知：無法靜態推導完整站內目標 |
| app/library/page.tsx:178 | 未知：無法靜態推導完整站內目標 |
| app/library/page.tsx:200 | 未知：無法靜態推導完整站內目標 |
| app/library/page.tsx:204 | 未知：無法靜態推導完整站內目標 |
| app/library/page.tsx:214 | 未知：無法靜態推導完整站內目標 |
| app/library/page.tsx:219 | 未知：無法靜態推導完整站內目標 |
| app/library/page.tsx:224 | 未知：無法靜態推導完整站內目標 |
| app/library/page.tsx:228 | 未知：無法靜態推導完整站內目標 |
| app/library/page.tsx:253 | 未知：無法靜態推導完整站內目標 |
| app/library/page.tsx:253 | 未知：無法靜態推導完整站內目標 |
| app/life/page.tsx:176 | 未知：無法靜態推導完整站內目標 |
| app/life/page.tsx:309 | 未知：無法靜態推導完整站內目標 |
| app/life/page.tsx:309 | 未知：無法靜態推導完整站內目標 |
| app/life/page.tsx:333 | 未知：無法靜態推導完整站內目標 |
| app/life/page.tsx:333 | 未知：無法靜態推導完整站內目標 |
| app/life/page.tsx:350 | 未知：無法靜態推導完整站內目標 |
| app/life/page.tsx:350 | 未知：無法靜態推導完整站內目標 |
| app/life/page.tsx:365 | 未知：無法靜態推導完整站內目標 |
| app/life/page.tsx:365 | 未知：無法靜態推導完整站內目標 |
| app/lms-admin/wave6/page.tsx:246 | 未知：無法靜態推導完整站內目標 |
| app/login/page.tsx:49 | 未知：無法靜態推導完整站內目標 |
| app/login/page.tsx:320 | 未知：無法靜態推導完整站內目標 |
| app/login/page.tsx:341 | 未知：無法靜態推導完整站內目標 |
| app/login/page.tsx:358 | 未知：無法靜態推導完整站內目標 |
| app/login/page.tsx:358 | 未知：無法靜態推導完整站內目標 |
| app/login/page.tsx:363 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/[id]/page.tsx:437 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/[id]/page.tsx:463 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/[id]/page.tsx:683 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/page.tsx:160 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/page.tsx:178 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/page.tsx:275 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/page.tsx:305 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/post/page.tsx:367 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/post/page.tsx:694 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/post/page.tsx:751 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/post/page.tsx:905 | 未知：無法靜態推導完整站內目標 |
| app/lost-found/post/page.tsx:913 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:287 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:302 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:307 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:343 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:349 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:420 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:424 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:429 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:441 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:512 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:519 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:526 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:536 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:546 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:556 | 未知：無法靜態推導完整站內目標 |
| app/map/MapClient.tsx:579 | 未知：無法靜態推導完整站內目標 |
| app/map/page.tsx:70 | 未知：無法靜態推導完整站內目標 |
| app/orders/orderDeepLink.ts:9 | 未知：無法靜態推導完整站內目標 |
| app/orders/orderDeepLink.ts:11 | 未知：無法靜態推導完整站內目標 |
| app/orders/orderDeepLink.ts:12 | 未知：無法靜態推導完整站內目標 |
| app/orders/orderDeepLink.ts:16 | 未知：無法靜態推導完整站內目標 |
| app/orders/orderDeepLink.ts:23 | 未知：無法靜態推導完整站內目標 |
| app/orders/orderDeepLink.ts:24 | 未知：無法靜態推導完整站內目標 |
| app/orders/orderDeepLink.ts:30 | 未知：無法靜態推導完整站內目標 |
| app/orders/orderDeepLink.ts:32 | 未知：無法靜態推導完整站內目標 |
| app/orders/orderDeepLink.ts:36 | 未知：無法靜態推導完整站內目標 |
| app/orders/page.tsx:164 | 未知：無法靜態推導完整站內目標 |
| app/orders/page.tsx:231 | 未知：無法靜態推導完整站內目標 |
| app/orders/page.tsx:268 | 未知：無法靜態推導完整站內目標 |
| app/page.tsx:343 | 未知：無法靜態推導完整站內目標 |
| app/page.tsx:366 | 未知：無法靜態推導完整站內目標 |
| app/privacy/page.tsx:43 | 未知：無法靜態推導完整站內目標 |
| app/profile/page.tsx:184 | 未知：無法靜態推導完整站內目標 |
| app/school-courses/page.tsx:138 | 未知：無法靜態推導完整站內目標 |
| app/school-courses/page.tsx:147 | 未知：無法靜態推導完整站內目標 |
| app/school-courses/page.tsx:168 | 未知：無法靜態推導完整站內目標 |
| app/school-courses/page.tsx:185 | 未知：無法靜態推導完整站內目標 |
| app/school-courses/page.tsx:197 | 未知：無法靜態推導完整站內目標 |
| app/school-courses/page.tsx:226 | 未知：無法靜態推導完整站內目標 |
| app/school-courses/page.tsx:227 | 未知：無法靜態推導完整站內目標 |
| app/school-info/page.tsx:111 | 未知：無法靜態推導完整站內目標 |
| app/school-info/page.tsx:119 | 未知：無法靜態推導完整站內目標 |
| app/school-info/page.tsx:144 | 未知：無法靜態推導完整站內目標 |
| app/school-info/page.tsx:167 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/LmsPageClient.tsx:57 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/LmsPageClient.tsx:157 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/LmsPageClient.tsx:166 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/LmsPageClient.tsx:270 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/LmsPageClient.tsx:287 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/LmsPageClient.tsx:294 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/LmsPageClient.tsx:330 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/LmsPageClient.tsx:331 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/homework/[courseId]/[homeworkId]/LmsPageClient.tsx:86 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/homework/[courseId]/[homeworkId]/LmsPageClient.tsx:115 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/homework/[courseId]/[homeworkId]/LmsPageClient.tsx:126 | 未知：無法靜態推導完整站內目標 |
| app/school-lms/homework/[courseId]/[homeworkId]/LmsPageClient.tsx:135 | 未知：無法靜態推導完整站內目標 |
| app/search/page.tsx:206 | 未知：無法靜態推導完整站內目標 |
| app/search/page.tsx:206 | 未知：無法靜態推導完整站內目標 |
| app/search/page.tsx:269 | 未知：無法靜態推導完整站內目標 |
| app/search/page.tsx:269 | 未知：無法靜態推導完整站內目標 |
| app/search/page.tsx:284 | 未知：無法靜態推導完整站內目標 |
| app/search/page.tsx:284 | 未知：無法靜態推導完整站內目標 |
| app/settings/page.tsx:630 | 未知：無法靜態推導完整站內目標 |
| app/settings/page.tsx:637 | 未知：無法靜態推導完整站內目標 |
| app/settings/page.tsx:705 | 未知：無法靜態推導完整站內目標 |
| app/settings/page.tsx:829 | 未知：無法靜態推導完整站內目標 |
| app/settings/page.tsx:1057 | 未知：無法靜態推導完整站內目標 |
| app/settings/page.tsx:1151 | 未知：無法靜態推導完整站內目標 |
| app/settings/settingsNavigation.ts:20 | 未知：無法靜態推導完整站內目標 |
| app/settings/settingsNavigation.ts:24 | 未知：無法靜態推導完整站內目標 |
| app/settings/settingsNavigation.ts:30 | 未知：無法靜態推導完整站內目標 |
| app/sso-callback/page.tsx:97 | 未知：無法靜態推導完整站內目標 |
| app/sso-callback/page.tsx:101 | 未知：無法靜態推導完整站內目標 |
| app/sso-callback/page.tsx:143 | 未知：無法靜態推導完整站內目標 |
| app/teacher/course/[courseId]/gradebook/page.tsx:38 | 未知：無法靜態推導完整站內目標 |
| app/teacher/course/[courseId]/gradebook/page.tsx:46 | 未知：無法靜態推導完整站內目標 |
| app/teacher/course/[courseId]/page.tsx:38 | 未知：無法靜態推導完整站內目標 |
| app/teacher/course/[courseId]/page.tsx:53 | 未知：無法靜態推導完整站內目標 |
| app/teacher/course/[courseId]/page.tsx:56 | 未知：無法靜態推導完整站內目標 |
| app/teacher/course/[courseId]/page.tsx:59 | 未知：無法靜態推導完整站內目標 |
| app/teacher/course/[courseId]/page.tsx:87 | 未知：無法靜態推導完整站內目標 |
| app/teacher/course/[courseId]/page.tsx:122 | 未知：無法靜態推導完整站內目標 |
| app/terms/page.tsx:47 | 未知：無法靜態推導完整站內目標 |
| app/timetable/page.tsx:15 | 未知：無法靜態推導完整站內目標 |
| components/AccountIdentity.tsx:89 | 未知：無法靜態推導完整站內目標 |
| components/AppHeader.tsx:41 | 未知：無法靜態推導完整站內目標 |
| components/AppHeader.tsx:48 | 未知：無法靜態推導完整站內目標 |
| components/AppHeader.tsx:74 | 未知：無法靜態推導完整站內目標 |
| components/AppHeader.tsx:133 | 未知：無法靜態推導完整站內目標 |
| components/AppHeader.tsx:138 | 未知：無法靜態推導完整站內目標 |
| components/AppHeader.tsx:145 | 未知：無法靜態推導完整站內目標 |
| components/AuthGuard.tsx:193 | 未知：無法靜態推導完整站內目標 |
| components/AuthGuard.tsx:329 | 未知：無法靜態推導完整站內目標 |
| components/CampusServiceMenu.tsx:53 | 未知：無法靜態推導完整站內目標 |
| components/CampusServiceMenu.tsx:125 | 未知：無法靜態推導完整站內目標 |
| components/CampusServiceMenu.tsx:283 | 未知：無法靜態推導完整站內目標 |
| components/CampusServiceMenu.tsx:304 | 未知：無法靜態推導完整站內目標 |
| components/CampusServiceMenu.tsx:304 | 未知：無法靜態推導完整站內目標 |
| components/CampusServiceMenu.tsx:314 | 未知：無法靜態推導完整站內目標 |
| components/CampusServiceMenu.tsx:314 | 未知：無法靜態推導完整站內目標 |
| components/CourseAttendance.tsx:769 | 未知：無法靜態推導完整站內目標 |
| components/CourseAttendance.tsx:788 | 未知：無法靜態推導完整站內目標 |
| components/DirectBusSearch.tsx:176 | 未知：無法靜態推導完整站內目標 |
| components/DirectBusSearch.tsx:260 | 未知：無法靜態推導完整站內目標 |
| components/LoginLink.tsx:17 | 未知：無法靜態推導完整站內目標 |
| components/LoginLink.tsx:20 | 未知：無法靜態推導完整站內目標 |
| components/LoginLink.tsx:20 | 未知：無法靜態推導完整站內目標 |
| components/LoginRequiredLostFoundComments.tsx:20 | 未知：無法靜態推導完整站內目標 |
| components/NuniSignIn.tsx:93 | 未知：無法靜態推導完整站內目標 |
| components/NuniSignIn.tsx:102 | 未知：無法靜態推導完整站內目標 |
| components/PublicSourceNotice.tsx:83 | 未知：無法靜態推導完整站內目標 |
| components/QuickCampusEntry.tsx:55 | 未知：無法靜態推導完整站內目標 |
| components/QuickCampusEntry.tsx:56 | 未知：無法靜態推導完整站內目標 |
| components/QuickCampusEntry.tsx:57 | 未知：無法靜態推導完整站內目標 |
| components/QuickCampusEntry.tsx:100 | 未知：無法靜態推導完整站內目標 |
| components/QuickCampusEntry.tsx:166 | 未知：無法靜態推導完整站內目標 |
| components/QuickCampusEntry.tsx:166 | 未知：無法靜態推導完整站內目標 |
| components/QuickCampusEntry.tsx:190 | 未知：無法靜態推導完整站內目標 |
| components/QuickCampusEntry.tsx:191 | 未知：無法靜態推導完整站內目標 |
| components/SchoolAccountRequired.tsx:58 | 未知：無法靜態推導完整站內目標 |
| components/SchoolDataScope.tsx:17 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:27 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:27 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:40 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:41 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:44 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:45 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:48 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:51 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:53 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:55 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:59 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:118 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:127 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:131 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:137 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:151 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:161 | 未知：無法靜態推導完整站內目標 |
| components/SchoolPublicServiceLinks.tsx:167 | 未知：無法靜態推導完整站內目標 |
| components/SelectedSchoolProvider.tsx:278 | 未知：無法靜態推導完整站內目標 |
| components/TransitExplorer.tsx:152 | 未知：無法靜態推導完整站內目標 |
| components/TransitExplorer.tsx:195 | 未知：無法靜態推導完整站內目標 |
| components/TransitExplorer.tsx:199 | 未知：無法靜態推導完整站內目標 |
| components/TransitExplorer.tsx:206 | 未知：無法靜態推導完整站內目標 |
| components/TransitExplorer.tsx:381 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicNavigation.tsx:45 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicNavigation.tsx:51 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicNavigation.tsx:51 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicNavigation.tsx:51 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicNavigation.tsx:61 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicNavigation.tsx:61 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicNavigation.tsx:76 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicNavigation.tsx:77 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicPage.tsx:92 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicPage.tsx:122 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicPage.tsx:134 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicPage.tsx:141 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicPage.tsx:279 | 未知：無法靜態推導完整站內目標 |
| components/academic/AcademicPage.tsx:286 | 未知：無法靜態推導完整站內目標 |
| components/academic/CreditTranscriptReview.tsx:110 | 未知：無法靜態推導完整站內目標 |
| components/academic/CreditTranscriptReview.tsx:117 | 未知：無法靜態推導完整站內目標 |
| components/academic/GradesTabs.tsx:25 | 未知：無法靜態推導完整站內目標 |
| components/academic/GradesTabs.tsx:31 | 未知：無法靜態推導完整站內目標 |
| components/academic/SchoolCourseReconciliation.tsx:124 | 未知：無法靜態推導完整站內目標 |
| components/academic/SchoolCourseReconciliation.tsx:160 | 未知：無法靜態推導完整站內目標 |
| components/academic/SchoolCourseReconciliation.tsx:171 | 未知：無法靜態推導完整站內目標 |
| components/calendar/PersonalCalendar.tsx:815 | 未知：無法靜態推導完整站內目標 |
| components/classroom/sessionDeepLink.ts:9 | 未知：無法靜態推導完整站內目標 |
| components/classroom/sessionDeepLink.ts:11 | 未知：無法靜態推導完整站內目標 |
| components/classroom/sessionDeepLink.ts:12 | 未知：無法靜態推導完整站內目標 |
| components/classroom/sessionDeepLink.ts:16 | 未知：無法靜態推導完整站內目標 |
| components/classroom/sessionDeepLink.ts:23 | 未知：無法靜態推導完整站內目標 |
| components/classroom/sessionDeepLink.ts:24 | 未知：無法靜態推導完整站內目標 |
| components/classroom/sessionDeepLink.ts:30 | 未知：無法靜態推導完整站內目標 |
| components/classroom/sessionDeepLink.ts:32 | 未知：無法靜態推導完整站內目標 |
| components/classroom/sessionDeepLink.ts:36 | 未知：無法靜態推導完整站內目標 |
| components/events/EventDetail.tsx:167 | 未知：無法靜態推導完整站內目標 |
| components/events/EventDetail.tsx:190 | 未知：無法靜態推導完整站內目標 |
| components/events/EventDetail.tsx:202 | 未知：無法靜態推導完整站內目標 |
| components/events/EventDetail.tsx:229 | 未知：無法靜態推導完整站內目標 |
| components/events/EventList.tsx:320 | 未知：無法靜態推導完整站內目標 |
| components/events/EventRegistrationPanel.tsx:89 | 未知：無法靜態推導完整站內目標 |
| components/events/EventRegistrationPanel.tsx:104 | 未知：無法靜態推導完整站內目標 |
| components/events/EventRegistrationPanel.tsx:116 | 未知：無法靜態推導完整站內目標 |
| components/events/EventRegistrationPanel.tsx:130 | 未知：無法靜態推導完整站內目標 |
| components/events/EventRegistrationPanel.tsx:141 | 未知：無法靜態推導完整站內目標 |
| components/events/EventRegistrationPanel.tsx:172 | 未知：無法靜態推導完整站內目標 |
| components/events/EventRegistrationPanel.tsx:183 | 未知：無法靜態推導完整站內目標 |
| components/events/ScopedEventDetail.tsx:45 | 未知：無法靜態推導完整站內目標 |
| components/home/FeedbackList.tsx:35 | 未知：無法靜態推導完整站內目標 |
| components/home/FeedbackList.tsx:84 | 未知：無法靜態推導完整站內目標 |
| components/imports/PersonalImportCenter.tsx:2240 | 未知：無法靜態推導完整站內目標 |
| components/imports/PersonalImportCenter.tsx:2583 | 未知：無法靜態推導完整站內目標 |
| components/imports/PersonalImportSummary.tsx:39 | 未知：無法靜態推導完整站內目標 |
| components/messaging/Messaging.tsx:284 | 未知：無法靜態推導完整站內目標 |
| components/messaging/Messaging.tsx:768 | 未知：無法靜態推導完整站內目標 |
| components/teaching/TeacherAssignments.tsx:385 | 未知：無法靜態推導完整站內目標 |
| components/teaching/UnavailableCourseTool.tsx:27 | 未知：無法靜態推導完整站內目標 |
| components/teaching/assignmentDeepLink.ts:9 | 未知：無法靜態推導完整站內目標 |
| components/teaching/assignmentDeepLink.ts:12 | 未知：無法靜態推導完整站內目標 |
| components/teaching/assignmentDeepLink.ts:14 | 未知：無法靜態推導完整站內目標 |
| components/teaching/assignmentDeepLink.ts:28 | 未知：無法靜態推導完整站內目標 |
| components/teaching/assignmentDeepLink.ts:43 | 未知：無法靜態推導完整站內目標 |
| components/teaching/assignmentDeepLink.ts:51 | 未知：無法靜態推導完整站內目標 |
| components/teaching/assignmentDeepLink.ts:53 | 未知：無法靜態推導完整站內目標 |
| components/teaching/assignmentDeepLink.ts:54 | 未知：無法靜態推導完整站內目標 |
| components/timetable/CourseEditor.tsx:109 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:98 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:98 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:137 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:137 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:149 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:389 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:618 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:943 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:1082 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:1101 | 未知：無法靜態推導完整站內目標 |
| components/timetable/PersonalTimetable.tsx:1132 | 未知：無法靜態推導完整站內目標 |
| components/timetable/TodayTimetable.tsx:92 | 未知：無法靜態推導完整站內目標 |
| components/timetable/TodayTimetable.tsx:116 | 未知：無法靜態推導完整站內目標 |
| components/timetable/TodayTimetable.tsx:119 | 未知：無法靜態推導完整站內目標 |
| components/timetable/TodayTimetable.tsx:141 | 未知：無法靜態推導完整站內目標 |
| components/timetable/TodayTimetable.tsx:191 | 未知：無法靜態推導完整站內目標 |
| components/timetable/TodayTimetable.tsx:192 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:135 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:252 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:338 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:352 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:357 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:369 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:369 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:374 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:374 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:386 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:401 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:467 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:474 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:489 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:489 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:504 | 未知：無法靜態推導完整站內目標 |
| components/today/StudentToday.tsx:572 | 未知：無法靜態推導完整站內目標 |
| components/today/TeacherToday.tsx:78 | 未知：無法靜態推導完整站內目標 |
| components/today/TeacherToday.tsx:80 | 未知：無法靜態推導完整站內目標 |
| components/today/TeacherToday.tsx:88 | 未知：無法靜態推導完整站內目標 |
| components/today/TeacherToday.tsx:117 | 未知：無法靜態推導完整站內目標 |
| components/today/TeacherToday.tsx:117 | 未知：無法靜態推導完整站內目標 |
| components/today/TeacherToday.tsx:140 | 未知：無法靜態推導完整站內目標 |
| components/today/TodayUnreadNotifications.tsx:121 | 未知：無法靜態推導完整站內目標 |
| components/today/TodayWelcome.tsx:45 | 未知：無法靜態推導完整站內目標 |
| components/today/TodayWelcome.tsx:49 | 未知：無法靜態推導完整站內目標 |
| components/today/TodayWelcome.tsx:55 | 未知：無法靜態推導完整站內目標 |
| components/today/TodayWelcome.tsx:55 | 未知：無法靜態推導完整站內目標 |
| components/today/TodayWelcome.tsx:67 | 未知：無法靜態推導完整站內目標 |
| components/today/TodayWelcome.tsx:67 | 未知：無法靜態推導完整站內目標 |
| components/ui/EmptyState.tsx:133 | 未知：無法靜態推導完整站內目標 |
| components/ui/EmptyState.tsx:133 | 未知：無法靜態推導完整站內目標 |
| components/ui/EmptyState.tsx:157 | 未知：無法靜態推導完整站內目標 |
| components/ui/EmptyState.tsx:157 | 未知：無法靜態推導完整站內目標 |
| components/ui/EmptyState.tsx:173 | 未知：無法靜態推導完整站內目標 |
| components/ui/EmptyState.tsx:173 | 未知：無法靜態推導完整站內目標 |
| features/admin/AdminAnnouncements.tsx:33 | 未知：無法靜態推導完整站內目標 |
| features/admin/AdminAnnouncements.tsx:33 | 未知：無法靜態推導完整站內目標 |
| features/admin/AdminLogin.tsx:35 | 未知：無法靜態推導完整站內目標 |
| features/admin/AdminLogin.tsx:52 | 未知：無法靜態推導完整站內目標 |
| features/admin/AdminLogin.tsx:172 | 未知：無法靜態推導完整站內目標 |
| features/admin/AdminPeople.tsx:153 | 未知：無法靜態推導完整站內目標 |
| features/admin/AdminSchools.tsx:553 | 未知：無法靜態推導完整站內目標 |
| features/admin/AdminWorkspace.tsx:270 | 未知：無法靜態推導完整站內目標 |
| features/admin/AdminWorkspace.tsx:294 | 未知：無法靜態推導完整站內目標 |
| features/food/FoodMenu.tsx:261 | 未知：無法靜態推導完整站內目標 |
| features/food/FoodMenu.tsx:272 | 未知：無法靜態推導完整站內目標 |
| features/food/FoodOrders.tsx:394 | 未知：無法靜態推導完整站內目標 |
| features/food/FoodWorkspace.tsx:89 | 未知：無法靜態推導完整站內目標 |
| features/food/FoodWorkspace.tsx:318 | 未知：無法靜態推導完整站內目標 |
| features/nuni/AssignmentFileFields.tsx:263 | 未知：無法靜態推導完整站內目標 |
| features/nuni/AssignmentFileFields.tsx:264 | 未知：無法靜態推導完整站內目標 |
| features/nuni/CourseMaterialSearch.tsx:266 | 未知：無法靜態推導完整站內目標 |
| features/nuni/CourseMaterials.tsx:66 | 未知：無法靜態推導完整站內目標 |
| features/nuni/CourseMaterials.tsx:308 | 未知：無法靜態推導完整站內目標 |
| features/nuni/CourseMaterials.tsx:309 | 未知：無法靜態推導完整站內目標 |
| features/nuni/CourseMaterials.tsx:407 | 未知：無法靜態推導完整站內目標 |
| features/nuni/CourseMaterials.tsx:416 | 未知：無法靜態推導完整站內目標 |
| features/nuni/MaterialBookmarks.tsx:135 | 未知：無法靜態推導完整站內目標 |
| features/nuni/MaterialBookmarks.tsx:147 | 未知：無法靜態推導完整站內目標 |
| features/nuni/MaterialBookmarks.tsx:207 | 未知：無法靜態推導完整站內目標 |
| features/nuni/NuniApp.tsx:90 | 未知：無法靜態推導完整站內目標 |
| features/nuni/NuniApp.tsx:286 | 未知：無法靜態推導完整站內目標 |
| features/nuni/NuniApp.tsx:372 | 未知：無法靜態推導完整站內目標 |
| features/nuni/PhotoPdfEditor.tsx:191 | 未知：無法靜態推導完整站內目標 |
| features/nuni/StudentGrades.tsx:224 | 未知：無法靜態推導完整站內目標 |
| features/nuni/StudentGrades.tsx:286 | 未知：無法靜態推導完整站內目標 |
| features/nuni/StudentGrades.tsx:466 | 未知：無法靜態推導完整站內目標 |
| features/nuni/StudyAgenda.tsx:88 | 未知：無法靜態推導完整站內目標 |
| features/nuni/StudyAgenda.tsx:112 | 未知：無法靜態推導完整站內目標 |
| features/nuni/StudyAgenda.tsx:284 | 未知：無法靜態推導完整站內目標 |
| features/nuni/WorkspaceList.tsx:140 | 未知：無法靜態推導完整站內目標 |
| features/nuni/WorkspaceList.tsx:360 | 未知：無法靜態推導完整站內目標 |
| features/nuni/WorkspaceList.tsx:406 | 未知：無法靜態推導完整站內目標 |
| features/nuni/studyNavigation.ts:24 | 未知：無法靜態推導完整站內目標 |
| features/nuni/studyNavigation.ts:28 | 未知：無法靜態推導完整站內目標 |
| features/nuni/studyNavigation.ts:44 | 未知：無法靜態推導完整站內目標 |
| features/nuni/studyNavigation.ts:53 | 未知：無法靜態推導完整站內目標 |
| features/nuni/studyNavigation.ts:72 | 未知：無法靜態推導完整站內目標 |
| features/nuni/studyNavigation.ts:96 | 未知：無法靜態推導完整站內目標 |
| features/nuni/studyNavigation.ts:111 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassCreate.tsx:48 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassCreate.tsx:60 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassCreate.tsx:65 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassCreate.tsx:86 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassCreate.tsx:95 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassJoin.tsx:47 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassJoin.tsx:62 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassJoin.tsx:67 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassJoin.tsx:94 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassJoin.tsx:102 | 未知：無法靜態推導完整站內目標 |
| features/platform/ClassroomSessions.tsx:123 | 未知：無法靜態推導完整站內目標 |
| features/platform/OpsConsole.tsx:111 | 未知：無法靜態推導完整站內目標 |
| features/platform/OpsConsole.tsx:112 | 未知：無法靜態推導完整站內目標 |
| features/platform/OpsConsole.tsx:218 | 未知：無法靜態推導完整站內目標 |
| features/platform/OpsConsole.tsx:399 | 未知：無法靜態推導完整站內目標 |
| features/platform/OpsConsole.tsx:535 | 未知：無法靜態推導完整站內目標 |
| features/platform/OpsConsole.tsx:708 | 未知：無法靜態推導完整站內目標 |
| features/platform/OpsConsole.tsx:753 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:92 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:98 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:147 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:163 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:214 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:248 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:286 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:306 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:339 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:342 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:343 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:356 | 未知：無法靜態推導完整站內目標 |
| features/platform/SchoolReview.tsx:465 | 未知：無法靜態推導完整站內目標 |
| features/platform/WorkspaceExtras.tsx:146 | 未知：無法靜態推導完整站內目標 |
| features/social/SocialWorkspace.tsx:73 | 未知：無法靜態推導完整站內目標 |
| features/social/SocialWorkspace.tsx:112 | 未知：無法靜態推導完整站內目標 |
| lib/academicChanges.ts:113 | 未知：無法靜態推導完整站內目標 |
| lib/academicSections.ts:5 | 未知：無法靜態推導完整站內目標 |
| lib/accountDestination.ts:30 | 未知：無法靜態推導完整站內目標 |
| lib/accountIdentity.ts:85 | 未知：無法靜態推導完整站內目標 |
| lib/assistantPresentation.ts:37 | 未知：無法靜態推導完整站內目標 |
| lib/calendarCourseDeadlines.ts:66 | 未知：無法靜態推導完整站內目標 |
| lib/campusNavigation.ts:27 | 未知：無法靜態推導完整站內目標 |
| lib/campusNavigation.ts:34 | 未知：無法靜態推導完整站內目標 |
| lib/campusNavigation.ts:38 | 未知：無法靜態推導完整站內目標 |
| lib/campusNavigation.ts:50 | 未知：無法靜態推導完整站內目標 |
| lib/campusNavigation.ts:50 | 未知：無法靜態推導完整站內目標 |
| lib/campusNavigation.ts:58 | 未知：無法靜態推導完整站內目標 |
| lib/campusNavigation.ts:61 | 未知：無法靜態推導完整站內目標 |
| lib/campusNavigation.ts:62 | 未知：無法靜態推導完整站內目標 |
| lib/homeOverview.ts:126 | 未知：無法靜態推導完整站內目標 |
| lib/lmsStudentGrades.ts:292 | 未知：無法靜態推導完整站內目標 |
| lib/lmsStudentGrades.ts:320 | 未知：無法靜態推導完整站內目標 |
| lib/lmsStudentGrades.ts:372 | 未知：無法靜態推導完整站內目標 |
| lib/lostFoundListNavigation.ts:16 | 未知：無法靜態推導完整站內目標 |
| lib/lostFoundListNavigation.ts:36 | 未知：無法靜態推導完整站內目標 |
| lib/lostFoundListNavigation.ts:40 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:10 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:14 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:20 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:22 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:22 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:26 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:38 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:51 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:56 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:56 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:67 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:71 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:96 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:116 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:125 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:135 | 未知：無法靜態推導完整站內目標 |
| lib/navigation.ts:160 | 未知：無法靜態推導完整站內目標 |
| lib/nuni/oauth.ts:122 | 未知：無法靜態推導完整站內目標 |
| lib/nuni/oauth.ts:197 | 未知：無法靜態推導完整站內目標 |
| lib/nuni/oauth.ts:205 | 未知：無法靜態推導完整站內目標 |
| lib/nuniHomeOverview.ts:97 | 未知：無法靜態推導完整站內目標 |
| lib/nuniHomeOverview.ts:170 | 未知：無法靜態推導完整站內目標 |
| lib/nuniStudentGrades.ts:29 | 未知：無法靜態推導完整站內目標 |
| lib/nuniStudentGrades.ts:80 | 未知：無法靜態推導完整站內目標 |
| lib/primaryNavigation.ts:8 | 未知：無法靜態推導完整站內目標 |
| lib/primaryNavigation.ts:14 | 未知：無法靜態推導完整站內目標 |
| lib/primaryNavigation.ts:24 | 未知：無法靜態推導完整站內目標 |
| lib/primaryNavigation.ts:31 | 未知：無法靜態推導完整站內目標 |
| lib/privateMessages.ts:635 | 未知：無法靜態推導完整站內目標 |
| lib/privateMessages.ts:651 | 未知：無法靜態推導完整站內目標 |
| lib/privateMessages.ts:661 | 未知：無法靜態推導完整站內目標 |
| lib/privateMessages.ts:679 | 未知：無法靜態推導完整站內目標 |
| lib/privateMessages.ts:681 | 未知：無法靜態推導完整站內目標 |
| lib/privateMessages.ts:691 | 未知：無法靜態推導完整站內目標 |
| lib/quickCampusActions.ts:16 | 未知：無法靜態推導完整站內目標 |
| lib/schoolCourseReconciliation.ts:158 | 未知：無法靜態推導完整站內目標 |
| lib/schoolStudentGrades.ts:94 | 未知：無法靜態推導完整站內目標 |
| lib/schoolStudentGrades.ts:109 | 未知：無法靜態推導完整站內目標 |
| lib/server/campusIpv4Fetch.ts:62 | 未知：無法靜態推導完整站內目標 |
| lib/server/puCampusClient.ts:465 | 未知：無法靜態推導完整站內目標 |
| lib/server/puEdgeRelay.ts:117 | 未知：無法靜態推導完整站內目標 |
| lib/server/puEdgeRelay.ts:120 | 未知：無法靜態推導完整站內目標 |
| lib/server/puEdgeRelay.ts:123 | 未知：無法靜態推導完整站內目標 |
| lib/server/puEdgeRelay.ts:125 | 未知：無法靜態推導完整站內目標 |
| lib/server/puEdgeRelay.ts:156 | 未知：無法靜態推導完整站內目標 |
| lib/server/puEdgeRelay.ts:233 | 未知：無法靜態推導完整站內目標 |
| lib/server/signInPuStudentId.ts:153 | 未知：無法靜態推導完整站內目標 |
| lib/server/signInPuStudentId.ts:156 | 未知：無法靜態推導完整站內目標 |
| lib/server/signInPuStudentId.ts:194 | 未知：無法靜態推導完整站內目標 |
| lib/server/signInPuStudentId.ts:268 | 未知：無法靜態推導完整站內目標 |
| lib/server/timetableShareHandlers.ts:248 | 未知：無法靜態推導完整站內目標 |
| lib/server/tronClassCoursesHandler.ts:59 | 未知：無法靜態推導完整站內目標 |
| lib/server/tronClassLmsHandler.ts:128 | 未知：無法靜態推導完整站內目標 |
| lib/server/tronClassLmsHandler.ts:153 | 未知：無法靜態推導完整站內目標 |
| lib/server/tronClassLmsHandler.ts:173 | 未知：無法靜態推導完整站內目標 |
| lib/server/tronClassLmsHandler.ts:182 | 未知：無法靜態推導完整站內目標 |
| lib/serviceListNavigation.ts:13 | 未知：無法靜態推導完整站內目標 |
| lib/serviceListNavigation.ts:21 | 未知：無法靜態推導完整站內目標 |
| lib/serviceListNavigation.ts:21 | 未知：無法靜態推導完整站內目標 |
| lib/serviceListNavigation.ts:25 | 未知：無法靜態推導完整站內目標 |
| lib/serviceListNavigation.ts:29 | 未知：無法靜態推導完整站內目標 |
| lib/serviceListNavigation.ts:44 | 未知：無法靜態推導完整站內目標 |
| lib/serviceListNavigation.ts:48 | 未知：無法靜態推導完整站內目標 |
| lib/serviceListNavigation.ts:51 | 未知：無法靜態推導完整站內目標 |
| lib/serviceListNavigation.ts:53 | 未知：無法靜態推導完整站內目標 |
| lib/serviceListNavigation.ts:55 | 未知：無法靜態推導完整站內目標 |
| lib/todayCourseWork.ts:120 | 未知：無法靜態推導完整站內目標 |
| lib/todayScreen.ts:48 | 未知：無法靜態推導完整站內目標 |
| lib/transit-direct.ts:285 | 未知：無法靜態推導完整站內目標 |
| lib/transit-direct.ts:321 | 未知：無法靜態推導完整站內目標 |
| lib/transit-direct.ts:336 | 未知：無法靜態推導完整站內目標 |
| lib/transit-server.ts:573 | 未知：無法靜態推導完整站內目標 |
| lib/transit-transfer.ts:319 | 未知：無法靜態推導完整站內目標 |
| lib/transit-transfer.ts:544 | 未知：無法靜態推導完整站內目標 |
| lib/transit.ts:885 | 未知：無法靜態推導完整站內目標 |
| lib/transit.ts:1087 | 未知：無法靜態推導完整站內目標 |
| lib/tronClassLms.ts:46 | 未知：無法靜態推導完整站內目標 |
| lib/tronClassLms.ts:67 | 未知：無法靜態推導完整站內目標 |
| lib/tronClassLms.ts:82 | 未知：無法靜態推導完整站內目標 |
| lib/tronClassLms.ts:91 | 未知：無法靜態推導完整站內目標 |

## 學生（270 筆）

| 來源 | 目標 | 結果 |
| --- | --- | --- |
| app/account-deletion/page.tsx:18 | /settings | 有路由／已知導向／靜態檔 |
| app/account-deletion/page.tsx:25 | /account-deletion/status | 有路由／已知導向／靜態檔 |
| app/account-deletion/status/DeletionStatusView.tsx:146 | /privacy | 有路由／已知導向／靜態檔 |
| app/account-deletion/status/DeletionStatusView.tsx:148 | /account-deletion | 有路由／已知導向／靜態檔 |
| app/ai-assistant/AgentCards.tsx:273 | /map?route=__dynamic__,__dynamic__ | 有路由／已知導向／靜態檔 |
| app/ai-assistant/AgentCards.tsx:389 | /map?focus=__dynamic__ | 有路由／已知導向／靜態檔 |
| app/ai-assistant/AgentCards.tsx:992 | /map?route=__dynamic__,__dynamic__ | 有路由／已知導向／靜態檔 |
| app/ai-assistant/CampusSensePanel.tsx:88 | /today-v2 | 有路由／已知導向／靜態檔 |
| app/ai-assistant/CampusSensePanel.tsx:114 | /announcements | 有路由／已知導向／靜態檔 |
| app/ai-assistant/CampusSensePanel.tsx:137 | /timetable | 有路由／已知導向／靜態檔 |
| app/ai-assistant/page.tsx:216 | /timetable | 有路由／已知導向／靜態檔 |
| app/ai-assistant/page.tsx:217 | /#courses | 有路由／已知導向／靜態檔 |
| app/ai-assistant/page.tsx:218 | /map | 有路由／已知導向／靜態檔 |
| app/ai-assistant/page.tsx:219 | /cafeteria | 有路由／已知導向／靜態檔 |
| app/ai-assistant/page.tsx:263 | /orders | 有路由／已知導向／靜態檔 |
| app/ai-assistant/page.tsx:393 | /ai-assistant | 有路由／已知導向／靜態檔 |
| app/announcements/[id]/page.tsx:228 | /announcements | 有路由／已知導向／靜態檔 |
| app/announcements/page.tsx:129 | /announcements | 有路由／已知導向／靜態檔 |
| app/announcements/page.tsx:212 | /announcements | 有路由／已知導向／靜態檔 |
| app/announcements/page.tsx:527 | /announcements | 有路由／已知導向／靜態檔 |
| app/appeals/page.tsx:68 | /appeals | 有路由／已知導向／靜態檔 |
| app/appeals/page.tsx:243 | /timetable | 有路由／已知導向／靜態檔 |
| app/auth/account/AccountEntry.tsx:342 | /privacy | 有路由／已知導向／靜態檔 |
| app/auth/account/AccountEntry.tsx:343 | /terms | 有路由／已知導向／靜態檔 |
| app/auth/account/AccountEntry.tsx:344 | /support | 有路由／已知導向／靜態檔 |
| app/auth/account/AccountEntry.tsx:345 | /account-deletion | 有路由／已知導向／靜態檔 |
| app/calendar/page.tsx:11 | /events | 有路由／已知導向／靜態檔 |
| app/calendar/page.tsx:12 | /calendar | 有路由／已知導向／靜態檔 |
| app/calendar/page.tsx:13 | /timetable | 有路由／已知導向／靜態檔 |
| app/calendar/page.tsx:14 | / | 有路由／已知導向／靜態檔 |
| app/career/page.tsx:4 | / | 有路由／已知導向／靜態檔 |
| app/community/page.tsx:82 | /dms | 有路由／已知導向／靜態檔 |
| app/community/page.tsx:86 | /groups | 有路由／已知導向／靜態檔 |
| app/community/page.tsx:90 | /friends | 有路由／已知導向／靜態檔 |
| app/community/page.tsx:94 | /social | 有路由／已知導向／靜態檔 |
| app/community/post/[postId]/page.tsx:338 | /community | 有路由／已知導向／靜態檔 |
| app/community/post/new/page.tsx:215 | /login | 有路由／已知導向／靜態檔 |
| app/community/post/new/page.tsx:428 | /community | 有路由／已知導向／靜態檔 |
| app/community/story/new/page.tsx:139 | /login | 有路由／已知導向／靜態檔 |
| app/community/story/new/page.tsx:383 | /community?tab=realtime | 有路由／已知導向／靜態檔 |
| app/error.tsx:18 | / | 有路由／已知導向／靜態檔 |
| app/groups/ClubAdmin.tsx:300 | /login | 有路由／已知導向／靜態檔 |
| app/hub/page.tsx:5 | / | 有路由／已知導向／靜態檔 |
| app/layout.tsx:67 | /icons/icon-180x180.png | 有路由／已知導向／靜態檔 |
| app/leave/LeavePageClient.tsx:71 | /leave | 有路由／已知導向／靜態檔 |
| app/leave/LeavePageClient.tsx:315 | /timetable | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:25 | /map | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:34 | /bus | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:43 | /food | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:52 | /cafeteria | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:61 | /library | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:70 | /school-info | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:79 | /announcements | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:88 | /events | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:97 | /lost-found | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:106 | /orders | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:115 | /community | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:124 | /friends | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:133 | /dormitory | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:142 | /classroom | 有路由／已知導向／靜態檔 |
| app/life/page.tsx:151 | /timetable | 有路由／已知導向／靜態檔 |
| app/login/page.tsx:94 | /search | 有路由／已知導向／靜態檔 |
| app/login/page.tsx:320 | /import | 有路由／已知導向／靜態檔 |
| app/login/page.tsx:323 | /privacy | 有路由／已知導向／靜態檔 |
| app/login/page.tsx:326 | /terms | 有路由／已知導向／靜態檔 |
| app/login/page.tsx:331 | /login | 有路由／已知導向／靜態檔 |
| app/login/page.tsx:335 | / | 有路由／已知導向／靜態檔 |
| app/lost-found/page.tsx:74 | /lost-found | 有路由／已知導向／靜態檔 |
| app/lost-found/page.tsx:139 | /lost-found | 有路由／已知導向／靜態檔 |
| app/me/page.tsx:5 | /profile | 有路由／已知導向／靜態檔 |
| app/not-found.tsx:13 | / | 有路由／已知導向／靜態檔 |
| app/not-found.tsx:16 | /search | 有路由／已知導向／靜態檔 |
| app/orders/page.tsx:159 | /food | 有路由／已知導向／靜態檔 |
| app/orders/page.tsx:266 | /food | 有路由／已知導向／靜態檔 |
| app/orders/page.tsx:275 | /food | 有路由／已知導向／靜態檔 |
| app/page.tsx:246 | /classroom | 有路由／已知導向／靜態檔 |
| app/profile/page.tsx:92 | /settings | 有路由／已知導向／靜態檔 |
| app/profile/page.tsx:123 | /timetable | 有路由／已知導向／靜態檔 |
| app/profile/page.tsx:124 | /grades?tab=semester | 有路由／已知導向／靜態檔 |
| app/profile/page.tsx:125 | /credit-planner | 有路由／已知導向／靜態檔 |
| app/profile/page.tsx:126 | /library | 有路由／已知導向／靜態檔 |
| app/profile/page.tsx:166 | /login?reconnect=school&returnUrl=%2Fprofile | 有路由／已知導向／靜態檔 |
| app/profile/page.tsx:174 | /classroom/login?returnUrl=%2Fprofile | 有路由／已知導向／靜態檔 |
| app/profile/page.tsx:193 | /settings | 有路由／已知導向／靜態檔 |
| app/school-courses/page.tsx:184 | /school-lms?course=__dynamic__ | 有路由／已知導向／靜態檔 |
| app/school-courses/page.tsx:184 | /classroom | 有路由／已知導向／靜態檔 |
| app/school-lms/LmsPageClient.tsx:56 | /school-lms/homework/__dynamic__/__dynamic__ | 有路由／已知導向／靜態檔 |
| app/school-lms/LmsPageClient.tsx:255 | /school-lms?course=__dynamic__ | 有路由／已知導向／靜態檔 |
| app/school-lms/homework/[courseId]/[homeworkId]/LmsPageClient.tsx:89 | /school-lms | 有路由／已知導向／靜態檔 |
| app/school-lms/homework/[courseId]/[homeworkId]/LmsPageClient.tsx:104 | /school-lms | 有路由／已知導向／靜態檔 |
| app/school-lms/homework/[courseId]/[homeworkId]/LmsPageClient.tsx:117 | /school-lms | 有路由／已知導向／靜態檔 |
| app/school-lms/homework/[courseId]/[homeworkId]/LmsPageClient.tsx:125 | /school-lms | 有路由／已知導向／靜態檔 |
| app/school-lms/homework/[courseId]/[homeworkId]/LmsPageClient.tsx:136 | /school-lms | 有路由／已知導向／靜態檔 |
| app/school-lms/homework/[courseId]/[homeworkId]/page.tsx:6 | /classroom | 有路由／已知導向／靜態檔 |
| app/school-lms/layout.tsx:7 | /classroom | 有路由／已知導向／靜態檔 |
| app/school-lms/page.tsx:6 | /classroom | 有路由／已知導向／靜態檔 |
| app/settings/page.tsx:660 | /classroom | 有路由／已知導向／靜態檔 |
| app/settings/page.tsx:668 | /classroom/login | 有路由／已知導向／靜態檔 |
| app/settings/page.tsx:677 | /login?reconnect=school&returnUrl=%2Fsettings | 有路由／已知導向／靜態檔 |
| app/settings/page.tsx:1101 | /classroom/login | 有路由／已知導向／靜態檔 |
| app/settings/page.tsx:1112 | /login?reconnect=school&returnUrl=%2Fsettings | 有路由／已知導向／靜態檔 |
| app/settings/page.tsx:1311 | /profile | 有路由／已知導向／靜態檔 |
| app/shops/page.tsx:5 | /food | 有路由／已知導向／靜態檔 |
| app/social/page.tsx:4 | /community | 有路由／已知導向／靜態檔 |
| app/sso-callback/page.tsx:143 | /login | 有路由／已知導向／靜態檔 |
| app/timetable/page.tsx:15 | /classroom | 有路由／已知導向／靜態檔 |
| app/today-v2/page.tsx:4 | / | 有路由／已知導向／靜態檔 |
| app/today/page.tsx:5 | / | 有路由／已知導向／靜態檔 |
| components/AppHeader.tsx:48 | / | 有路由／已知導向／靜態檔 |
| components/AppHeader.tsx:74 | /search | 有路由／已知導向／靜態檔 |
| components/AppHeader.tsx:88 | /profile | 有路由／已知導向／靜態檔 |
| components/AppHeader.tsx:133 | / | 有路由／已知導向／靜態檔 |
| components/AppHeader.tsx:138 | /timetable | 有路由／已知導向／靜態檔 |
| components/AppHeader.tsx:145 | /life | 有路由／已知導向／靜態檔 |
| components/AppHeader.tsx:150 | /profile | 有路由／已知導向／靜態檔 |
| components/AppHeader.tsx:150 | /login?returnUrl=%2Fprofile | 有路由／已知導向／靜態檔 |
| components/AppHeader.tsx:198 | / | 有路由／已知導向／靜態檔 |
| components/AuthGuard.tsx:295 | /login | 有路由／已知導向／靜態檔 |
| components/AuthGuard.tsx:414 | / | 有路由／已知導向／靜態檔 |
| components/CampusServiceMenu.tsx:283 | /search | 有路由／已知導向／靜態檔 |
| components/HomeCampusBusCard.tsx:39 | /bus | 有路由／已知導向／靜態檔 |
| components/NuniAccountPanel.tsx:166 | /classroom | 有路由／已知導向／靜態檔 |
| components/NuniAccountPanel.tsx:169 | /classroom/account | 有路由／已知導向／靜態檔 |
| components/NuniSignIn.tsx:140 | /privacy | 有路由／已知導向／靜態檔 |
| components/NuniSignIn.tsx:140 | /terms | 有路由／已知導向／靜態檔 |
| components/QuickCampusEntry.tsx:56 | /search | 有路由／已知導向／靜態檔 |
| components/QuickCampusEntry.tsx:100 | /search | 有路由／已知導向／靜態檔 |
| components/RequireAdmin.tsx:42 | /#courses | 有路由／已知導向／靜態檔 |
| components/RequireAdmin.tsx:57 | /#courses | 有路由／已知導向／靜態檔 |
| components/RequireAdmin.tsx:72 | /login | 有路由／已知導向／靜態檔 |
| components/SiteFooter.tsx:13 | /terms | 有路由／已知導向／靜態檔 |
| components/SiteFooter.tsx:14 | /privacy | 有路由／已知導向／靜態檔 |
| components/SiteFooter.tsx:15 | /support | 有路由／已知導向／靜態檔 |
| components/SiteFooter.tsx:16 | /account-deletion | 有路由／已知導向／靜態檔 |
| components/SiteFooter.tsx:17 | /settings | 有路由／已知導向／靜態檔 |
| components/academic/AcademicNavigation.tsx:51 | /timetable | 有路由／已知導向／靜態檔 |
| components/academic/AcademicNavigation.tsx:61 | /import?kind=events | 有路由／已知導向／靜態檔 |
| components/academic/AcademicNavigation.tsx:61 | /import?kind=grades | 有路由／已知導向／靜態檔 |
| components/academic/AcademicNavigation.tsx:61 | /import?kind=timetable | 有路由／已知導向／靜態檔 |
| components/academic/GradesTabs.tsx:25 | /grades?tab=feedback | 有路由／已知導向／靜態檔 |
| components/academic/GradesTabs.tsx:31 | /grades?tab=semester | 有路由／已知導向／靜態檔 |
| components/calendar/PersonalCalendar.tsx:780 | / | 有路由／已知導向／靜態檔 |
| components/calendar/PersonalCalendar.tsx:786 | / | 有路由／已知導向／靜態檔 |
| components/calendar/PersonalCalendar.tsx:802 | / | 有路由／已知導向／靜態檔 |
| components/events/EventList.tsx:71 | /events | 有路由／已知導向／靜態檔 |
| components/events/EventList.tsx:96 | /events | 有路由／已知導向／靜態檔 |
| components/events/EventList.tsx:154 | /events | 有路由／已知導向／靜態檔 |
| components/imports/PersonalImportCenter.tsx:2110 | /classroom | 有路由／已知導向／靜態檔 |
| components/imports/PersonalImportSummary.tsx:16 | /import?kind=__dynamic__ | 有路由／已知導向／靜態檔 |
| components/imports/PersonalImportSummary.tsx:49 | /import?kind=__dynamic__ | 有路由／已知導向／靜態檔 |
| components/messaging/Messaging.tsx:141 | /dms | 有路由／已知導向／靜態檔 |
| components/messaging/Messaging.tsx:144 | /messages | 有路由／已知導向／靜態檔 |
| components/messaging/Messaging.tsx:156 | /login?returnUrl=%2Fmessages | 有路由／已知導向／靜態檔 |
| components/messaging/Messaging.tsx:156 | /login?returnUrl=%2Fdms | 有路由／已知導向／靜態檔 |
| components/messaging/Messaging.tsx:230 | /friends | 有路由／已知導向／靜態檔 |
| components/messaging/Messaging.tsx:233 | /groups | 有路由／已知導向／靜態檔 |
| components/messaging/Messaging.tsx:331 | /friends | 有路由／已知導向／靜態檔 |
| components/messaging/Messaging.tsx:512 | /dms | 有路由／已知導向／靜態檔 |
| components/timetable/PersonalTimetable.tsx:1271 | /friends | 有路由／已知導向／靜態檔 |
| components/today/StudentToday.tsx:329 | /classroom | 有路由／已知導向／靜態檔 |
| components/today/StudentToday.tsx:543 | /calendar | 有路由／已知導向／靜態檔 |
| components/today/StudentToday.tsx:557 | /classroom | 有路由／已知導向／靜態檔 |
| components/today/StudentToday.tsx:562 | /calendar | 有路由／已知導向／靜態檔 |
| components/today/TodayUnreadNotifications.tsx:79 | /messages | 有路由／已知導向／靜態檔 |
| components/today/TodayUnreadNotifications.tsx:84 | /messages | 有路由／已知導向／靜態檔 |
| components/today/TodayUnreadNotifications.tsx:106 | /messages | 有路由／已知導向／靜態檔 |
| components/today/TodayUnreadNotifications.tsx:112 | /messages | 有路由／已知導向／靜態檔 |
| components/today/TodayUnreadNotifications.tsx:121 | /messages | 有路由／已知導向／靜態檔 |
| components/today/TodayUnreadNotifications.tsx:134 | /messages | 有路由／已知導向／靜態檔 |
| components/today/TodayUnreadNotifications.tsx:140 | /messages | 有路由／已知導向／靜態檔 |
| components/today/TodayWelcome.tsx:13 | /map | 有路由／已知導向／靜態檔 |
| components/today/TodayWelcome.tsx:14 | /bus | 有路由／已知導向／靜態檔 |
| components/today/TodayWelcome.tsx:15 | /cafeteria | 有路由／已知導向／靜態檔 |
| components/today/TodayWelcome.tsx:16 | /library | 有路由／已知導向／靜態檔 |
| components/today/TodayWelcome.tsx:55 | / | 有路由／已知導向／靜態檔 |
| features/food/FoodWorkspace.tsx:60 | /cafeteria | 有路由／已知導向／靜態檔 |
| features/food/FoodWorkspace.tsx:63 | /orders | 有路由／已知導向／靜態檔 |
| features/food/FoodWorkspace.tsx:89 | /food | 有路由／已知導向／靜態檔 |
| features/nuni/NuniApp.tsx:619 | /classroom | 有路由／已知導向／靜態檔 |
| features/nuni/NuniApp.tsx:641 | /classroom | 有路由／已知導向／靜態檔 |
| features/nuni/StudentGrades.tsx:166 | /classroom | 有路由／已知導向／靜態檔 |
| features/nuni/StudentGrades.tsx:425 | /classroom | 有路由／已知導向／靜態檔 |
| features/nuni/StudentGrades.tsx:446 | /classroom | 有路由／已知導向／靜態檔 |
| features/nuni/WorkspaceList.tsx:194 | /grades?tab=feedback | 有路由／已知導向／靜態檔 |
| features/nuni/studyNavigation.ts:53 | /classroom/material-bookmarks | 有路由／已知導向／靜態檔 |
| features/nuni/studyNavigation.ts:53 | /classroom | 有路由／已知導向／靜態檔 |
| features/social/SocialWorkspace.tsx:76 | /community | 有路由／已知導向／靜態檔 |
| features/social/SocialWorkspace.tsx:139 | /community | 有路由／已知導向／靜態檔 |
| lib/academicSections.ts:14 | /school-courses | 有路由／已知導向／靜態檔 |
| lib/academicSections.ts:15 | /school-lms | 有路由／已知導向／靜態檔 |
| lib/accountDestination.ts:31 | /classroom | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:30 | /calendar | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:32 | /calendar | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:40 | /import | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:46 | /timetable | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:48 | /timetable | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:56 | /leave | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:72 | /appeals | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:86 | /grades | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:88 | /grades?tab=semester | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:96 | /grades?tab=feedback | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:100 | /grades?tab=semester | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:103 | /classroom | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:105 | /classroom | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:111 | /school-courses | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:113 | /school-courses | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:117 | /classroom | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:120 | /school-lms | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:122 | /school-lms | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:126 | /classroom | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:129 | /credit-planner | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:131 | /credit-planner | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:139 | /groups | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:143 | /classroom | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:148 | /announcements | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:156 | /events | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:164 | /clubs | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:172 | /messages | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:180 | /dms | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:188 | /community | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:196 | /friends | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:204 | /map | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:212 | /bus | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:220 | /food | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:228 | /cafeteria | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:232 | /food | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:237 | /dormitory | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:245 | /lost-found | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:261 | /library | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:269 | /school-info | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:277 | /ai-assistant | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:285 | /support | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:293 | /account-deletion | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:301 | /profile | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:309 | /settings | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:317 | /classroom/account | 有路由／已知導向／靜態檔 |
| lib/demoRole.ts:47 | /timetable | 有路由／已知導向／靜態檔 |
| lib/demoRole.ts:80 | /clubs | 有路由／已知導向／靜態檔 |
| lib/demoRole.ts:113 | / | 有路由／已知導向／靜態檔 |
| lib/demoRole.ts:124 | / | 有路由／已知導向／靜態檔 |
| lib/nuni/oauth.ts:100 | /classroom/login | 有路由／已知導向／靜態檔 |
| lib/nuni/oauth.ts:122 | /classroom/login?issue=unavailable | 有路由／已知導向／靜態檔 |
| lib/nuni/oauth.ts:205 | /classroom/login?issue=expired | 有路由／已知導向／靜態檔 |
| lib/nuni/server.ts:115 | / | 有路由／已知導向／靜態檔 |
| lib/privateMessages.ts:638 | /announcements | 有路由／已知導向／靜態檔 |
| lib/privateMessages.ts:651 | /orders | 有路由／已知導向／靜態檔 |
| lib/privateMessages.ts:657 | /messages | 有路由／已知導向／靜態檔 |
| lib/privateMessages.ts:667 | /messages | 有路由／已知導向／靜態檔 |
| lib/privateMessages.ts:682 | /grades?tab=feedback | 有路由／已知導向／靜態檔 |
| lib/privateMessages.ts:700 | /messages | 有路由／已知導向／靜態檔 |
| lib/publicCampusServices.ts:2 | /map | 有路由／已知導向／靜態檔 |
| lib/publicCampusServices.ts:3 | /bus | 有路由／已知導向／靜態檔 |
| lib/publicCampusServices.ts:4 | /announcements | 有路由／已知導向／靜態檔 |
| lib/publicCampusServices.ts:5 | /events | 有路由／已知導向／靜態檔 |
| lib/publicCampusServices.ts:6 | /cafeteria | 有路由／已知導向／靜態檔 |
| lib/publicCampusServices.ts:7 | /library | 有路由／已知導向／靜態檔 |
| lib/publicCampusServices.ts:8 | /school-info | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:31 | /announcements/ann-4 | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:62 | /announcements/ann-1 | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:71 | /course/c3 | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:80 | /clubs | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:110 | /announcements | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:142 | /clubs | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:151 | /clubs | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:214 | /announcements | 有路由／已知導向／靜態檔 |
| lib/academicSections.ts:4 | /timetable | 有路由／已知導向／靜態檔 |
| lib/academicSections.ts:4 | /classroom | 有路由／已知導向／靜態檔 |
| lib/academicSections.ts:4 | /grades | 有路由／已知導向／靜態檔 |
| lib/academicSections.ts:4 | /credit-planner | 有路由／已知導向／靜態檔 |
| lib/academicSections.ts:4 | /calendar | 有路由／已知導向／靜態檔 |

## 老師（12 筆）

| 來源 | 目標 | 結果 |
| --- | --- | --- |
| app/leave/review/LeaveReviewPageClient.tsx:43 | /leave/review | 有路由／已知導向／靜態檔 |
| app/leave/review/LeaveReviewPageClient.tsx:154 | /leave | 有路由／已知導向／靜態檔 |
| app/page.tsx:251 | /teacher | 有路由／已知導向／靜態檔 |
| app/teacher/page.tsx:25 | /classroom | 有路由／已知導向／靜態檔 |
| app/teacher/page.tsx:81 | /teacher | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:64 | /leave/review | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:80 | /teacher | 有路由／已知導向／靜態檔 |
| lib/demoRole.ts:58 | /teacher/course/c1 | 有路由／已知導向／靜態檔 |
| lib/demoRole.ts:69 | /teacher/course/c1 | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:92 | /teacher/course/c1/gradebook | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:101 | /teacher/course/c1/attendance | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:122 | /teacher/course/c1/gradebook | 有路由／已知導向／靜態檔 |

## 學校管理者（18 筆）

| 來源 | 目標 | 結果 |
| --- | --- | --- |
| app/lms-admin/page.tsx:16 | /lms-admin/courses | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:19 | /lms-admin/reports | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:22 | /lms-admin/role-matrix | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:25 | /lms-admin/members | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:28 | /lms-admin/notify | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:31 | /lms-admin/push-logs | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:34 | /lms-admin/export-jobs | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:37 | /lms-admin/ai-compliance | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:40 | /lms-admin/audit | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:43 | /lms-admin/bulk-import | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:46 | /lms-admin/wave5 | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:49 | /lms-admin/wave6 | 有路由／已知導向／靜態檔 |
| app/lms-admin/page.tsx:52 | /lms-admin/dashboard | 有路由／已知導向／靜態檔 |
| features/admin/AdminOverview.tsx:38 | /admin/school-review | 有路由／已知導向／靜態檔 |
| features/admin/AdminOverview.tsx:106 | /admin/school-review | 有路由／已知導向／靜態檔 |
| features/admin/AdminSchools.tsx:200 | /admin/school-review | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:237 | /admin/school-review | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:253 | /admin/school-review | 有路由／已知導向／靜態檔 |

## 店家（7 筆）

| 來源 | 目標 | 結果 |
| --- | --- | --- |
| components/AccountIdentity.tsx:101 | /merchant | 有路由／已知導向／靜態檔 |
| components/AccountIdentity.tsx:108 | /merchant | 有路由／已知導向／靜態檔 |
| components/AccountIdentity.tsx:115 | /merchant | 有路由／已知導向／靜態檔 |
| components/NuniAccountPanel.tsx:172 | /merchant | 有路由／已知導向／靜態檔 |
| features/food/FoodWorkspace.tsx:66 | /merchant | 有路由／已知導向／靜態檔 |
| features/merchant/MerchantWorkspace.tsx:88 | /merchant | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:253 | /merchant | 有路由／已知導向／靜態檔 |

## 營運（32 筆）

| 來源 | 目標 | 結果 |
| --- | --- | --- |
| app/admin/announcements/SchoolAnnouncementsAdmin.tsx:109 | / | 有路由／已知導向／靜態檔 |
| app/admin/announcements/SchoolAnnouncementsAdmin.tsx:115 | / | 有路由／已知導向／靜態檔 |
| app/admin/announcements/SchoolAnnouncementsAdmin.tsx:123 | /announcements | 有路由／已知導向／靜態檔 |
| components/AppHeader.tsx:83 | /admin | 有路由／已知導向／靜態檔 |
| components/NuniAccountPanel.tsx:201 | /admin | 有路由／已知導向／靜態檔 |
| features/admin/AdminAnnouncements.tsx:36 | /announcements | 有路由／已知導向／靜態檔 |
| features/admin/AdminHeader.tsx:25 | / | 有路由／已知導向／靜態檔 |
| features/admin/AdminHeader.tsx:34 | / | 有路由／已知導向／靜態檔 |
| features/admin/AdminMerchants.tsx:94 | /admin/ops | 有路由／已知導向／靜態檔 |
| features/admin/AdminOverview.tsx:149 | /admin/ops?tab=people | 有路由／已知導向／靜態檔 |
| features/admin/AdminOverview.tsx:153 | /admin/ops?tab=merchants | 有路由／已知導向／靜態檔 |
| features/admin/AdminOverview.tsx:157 | /admin/ops?tab=affiliation | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:76 | /admin/login | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:238 | /admin/announcements | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:239 | /admin/ops?tab=people | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:240 | /admin/ops?tab=merchants | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:241 | /admin/ops?tab=affiliation | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:254 | /admin/announcements | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:255 | /admin/ops?tab=people | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:256 | /admin/ops?tab=merchants | 有路由／已知導向／靜態檔 |
| features/admin/AdminWorkspace.tsx:257 | /admin/ops?tab=affiliation | 有路由／已知導向／靜態檔 |
| features/platform/ClassCreate.tsx:87 | /auth/account | 有路由／已知導向／靜態檔 |
| features/platform/ClassJoin.tsx:93 | /auth/account | 有路由／已知導向／靜態檔 |
| features/platform/OpsConsole.tsx:110 | /admin | 有路由／已知導向／靜態檔 |
| lib/campusServices.ts:325 | /admin | 有路由／已知導向／靜態檔 |
| lib/demoRole.ts:91 | /admin | 有路由／已知導向／靜態檔 |
| lib/demoRole.ts:102 | /admin | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:163 | /admin | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:172 | /admin | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:184 | /admin | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:193 | /admin | 有路由／已知導向／靜態檔 |
| lib/roleNotifications.ts:202 | /admin | 有路由／已知導向／靜態檔 |
