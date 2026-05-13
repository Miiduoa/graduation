/**
 * 靜宜蓋夏圖書館 WebPac（HyLib）— URL 建構與連線檢查
 *
 * 官方 OPAC：https://webpacx.lib.pu.edu.tw/
 *
 * 館藏查詢主流程見 `libraryOpacSearchClient.ts`（對齊課綱：Session / csrf / GraphQL）；
 * 此檔僅保留首頁、搜尋 URL、HEAD 檢查等共用函式。
 */

const LIBRARY_OPAC_BASE = 'https://webpacx.lib.pu.edu.tw/';

/** 與 puLibraryData.GAESIA_LIBRARY_INFO.opac 一致 */
export function getLibraryOpacBaseUrl(): string {
  return LIBRARY_OPAC_BASE.endsWith('/') ? LIBRARY_OPAC_BASE : `${LIBRARY_OPAC_BASE}/`;
}

/** OPAC 首頁（尾隨 slash） */
export function buildLibraryOpacHomeUrl(): string {
  return getLibraryOpacBaseUrl();
}

/**
 * 建構關鍵字檢索 URL。
 * 空字串時回傳首頁。
 */
export function buildLibrarySearchUrl(query: string): string {
  const q = query.trim();
  if (!q) return buildLibraryOpacHomeUrl();
  const origin = getLibraryOpacBaseUrl().replace(/\/+$/, '');
  return `${origin}/search?q=${encodeURIComponent(q)}`;
}

export type LibraryOpacHeadResult = {
  ok: boolean;
  status?: number;
};

/**
 * 以 HEAD 粗驗證站台是否回應（不做 HTML 解析）。
 * React Native 原生環境通常可直接請求；若在網頁版無法附帶 Cookie（與課綱查詢類似），由呼叫端略過直連。
 */
export async function validateLibraryOpacReachable(
  signal?: AbortSignal,
): Promise<LibraryOpacHeadResult> {
  try {
    const res = await fetch(getLibraryOpacBaseUrl(), {
      method: 'HEAD',
      signal,
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  }
}
