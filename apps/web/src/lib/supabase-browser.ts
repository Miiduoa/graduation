/**
 * supabase-browser alias — 給 lms-admin 各頁 import 用
 * ──────────────────────────────────────────────────
 * 畢業專題2 的 admin 頁原本用 `getBrowserSupabase()`,
 * 這裡轉成走我們現有的 supabaseClient (惰性初始化、flag-aware)。
 */
import { getSupabaseClient } from './supabaseClient';

export function getBrowserSupabase() {
  const sb = getSupabaseClient();
  if (!sb) {
    // Throw 比 return null 安全 — page 用 try/catch 即可顯示「未連線」
    throw new Error('Supabase client 未就緒 (LMS v2 未啟用或 env 變數缺失)');
  }
  return sb;
}
