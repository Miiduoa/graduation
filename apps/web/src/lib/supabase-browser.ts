/**
 * supabase-browser alias — 給 lms-admin 各頁 import 用
 * ──────────────────────────────────────────────────
 * 畢業專題2 的 admin 頁原本用 `getBrowserSupabase()`,
 * 這裡轉成走我們現有的 supabaseClient (惰性初始化、flag-aware)。
 */
import { getSupabaseClient } from './supabaseClient';

/**
 * 取得 Supabase client。
 *
 * - 瀏覽器 / 已連線：回傳真實 client
 * - SSR / Prerender / env 缺失：回傳會在實際呼叫時丟錯的 Proxy，
 *   避免「component 一 render 就 throw」害靜態頁面 prerender 失敗。
 *   實際操作（.from / .auth / ...）才會 throw，呼叫端原本就有 try/catch。
 */
export function getBrowserSupabase() {
  const sb = getSupabaseClient();
  if (sb) return sb;
  const err = new Error('Supabase client 未就緒 (LMS v2 未啟用或 env 變數缺失)');
  return new Proxy(
    {},
    {
      get() {
        throw err;
      },
    },
  ) as ReturnType<typeof getSupabaseClient> & object;
}
