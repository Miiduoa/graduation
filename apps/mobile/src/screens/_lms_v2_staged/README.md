# LMS v2 Staged Screens

這個資料夾放從 `/Users/miiduoa/畢業專題2` 整批複製過來的 LMS v2 Mobile 課程子頁
(原本是 Expo Router 結構)。所有檔案以 `.staged` 後綴結尾,
TypeScript / Metro 都不會編譯/打包它們 — 安全暫存。

Phase 2 啟動時的步驟:
1. 把每個 `*.tsx.staged` 改寫為 React Navigation 風格的 Screen
2. 改名為 `apps/mobile/src/screens/Course*V2Screen.tsx`
3. 在 `App.tsx` 的 `LearnStack` 註冊新 Screen
4. 用 `useRoute().params.courseId` 取代 Expo Router 的 `useLocalSearchParams()`
5. 用 `useNavigation().navigate(...)` 取代 `router.push(...)`

對應表參見 /Users/miiduoa/Desktop/畢業專題/docs/LMS_V2_MIGRATION_RUNBOOK.md。
