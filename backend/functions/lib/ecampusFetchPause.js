/**
 * E 校園（alcat.pu.edu.tw、mypu.pu.edu.tw）資料抓取暫停開關。
 *
 * PU_ECAMPUS_FETCH_PAUSED 設為 1 或 true（不分大小寫）才生效；未設或其他值時行為完全不變。
 * 生效時課表、成績（含 mypu SSO 轉接）、公告、缺曠、學生資料、學分整理都不發出任何請求，
 * 直接回暫停狀態。學號登入（puLogin）不受影響。
 */

const ECAMPUS_FETCH_PAUSED_ENV = 'PU_ECAMPUS_FETCH_PAUSED';
const ECAMPUS_PAUSED_CODE = 'ecampus-paused';
const ECAMPUS_PAUSED_MESSAGE = 'E 校園資料暫停更新中';

function isEcampusFetchPaused(env = process.env) {
  const raw = String((env && env[ECAMPUS_FETCH_PAUSED_ENV]) ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true';
}

const EMPTY_BY_KIND = {
  courses: () => ({ courses: [] }),
  grades: () => ({ grades: [] }),
  announcements: () => ({ announcements: [] }),
  absence: () => ({ absences: [] }),
  creditSummary: () => ({ creditSummary: null }),
  studentInfo: () => ({ studentInfo: {} }),
};

/** 暫停時的回傳：形狀與既有失敗結果相同，另加 paused 與 code 讓呼叫端辨識。 */
function ecampusPausedResult(kind) {
  const empty = EMPTY_BY_KIND[kind] ? EMPTY_BY_KIND[kind]() : {};
  return {
    success: false,
    paused: true,
    code: ECAMPUS_PAUSED_CODE,
    error: ECAMPUS_PAUSED_MESSAGE,
    ...empty,
  };
}

function isEcampusPausedResult(result) {
  return Boolean(result && result.paused === true && result.code === ECAMPUS_PAUSED_CODE);
}

module.exports = {
  ECAMPUS_FETCH_PAUSED_ENV,
  ECAMPUS_PAUSED_CODE,
  ECAMPUS_PAUSED_MESSAGE,
  isEcampusFetchPaused,
  ecampusPausedResult,
  isEcampusPausedResult,
};
