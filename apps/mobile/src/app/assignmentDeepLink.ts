import * as ExpoLinking from 'expo-linking';

const ASSIGNMENT_PATH_RE = /group\/([^/]+)\/assignment\/([^/?#]+)/i;
/** `…/group/:groupId/assignments`（與 MessagesStack 路徑一致，導向學習 CourseHub） */
const ASSIGNMENTS_LIST_PATH_RE = /group\/([^/]+)\/assignments(?:\?|$|#|\/)/i;

/** `…/group/:groupId/hub` → 學習 CourseHub（與社團 GroupDetail 預設連結分流） */
const GROUP_HUB_SUFFIX_RE = /group\/([^/]+)\/hub(?:\?|$|#|\/)/i;

export type GroupAssignmentDeepLink = {
  groupId: string;
  assignmentId: string;
  /** 來自 query，例如 `?kind=quiz`、`isQuiz=1`（推播／後端可帶） */
  isQuiz?: boolean;
};

function queryStringFromUrl(url: string): string | null {
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  if (q === -1) return null;
  const end = h === -1 ? url.length : h;
  return url.slice(q + 1, end);
}

function parseQueryRecord(url: string): Record<string, string> {
  const qs = queryStringFromUrl(url);
  if (!qs) return {};
  const out: Record<string, string> = {};
  for (const part of qs.split('&')) {
    const [k, v = ''] = part.split('=');
    if (!k) continue;
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function queryWantsCourseHub(
  query: Record<string, string | string[] | undefined> | null | undefined,
): boolean {
  if (!query) return false;
  const raw = (k: string) => {
    const v = query[k];
    if (Array.isArray(v)) return v[0];
    return v;
  };
  const hub = raw('hub') ?? raw('courseHub') ?? raw('learn');
  return hub === '1' || hub === 'true' || hub === 'yes' || hub === 'course';
}

function queryParamsImplyQuiz(
  query: Record<string, string | string[] | undefined> | null | undefined,
): boolean {
  if (!query) return false;
  const raw = (k: string) => {
    const v = query[k];
    if (Array.isArray(v)) return v[0];
    return v;
  };
  const kind = raw('kind') ?? raw('type');
  if (kind === 'quiz' || kind === 'exam') return true;
  const flag = raw('isQuiz') ?? raw('quiz');
  return flag === '1' || flag === 'true' || flag === 'yes';
}

/**
 * 解析 `…/group/:groupId/assignment/:assignmentId`（含 campus://、https:、expo dev URL）
 */
export function parseGroupAssignmentDeepLink(
  url: string | null | undefined,
): GroupAssignmentDeepLink | null {
  if (!url || typeof url !== 'string') return null;
  let candidate = url;
  let isQuiz = false;
  try {
    const parsed = ExpoLinking.parse(url);
    if (parsed.path) candidate = parsed.path;
    isQuiz = queryParamsImplyQuiz(parsed.queryParams ?? undefined);
  } catch {
    /* use raw url */
  }
  if (!isQuiz) {
    isQuiz = queryParamsImplyQuiz(parseQueryRecord(url));
  }
  let m = candidate.match(ASSIGNMENT_PATH_RE);
  if (!m) m = url.match(ASSIGNMENT_PATH_RE);
  if (!m) return null;
  try {
    return {
      groupId: decodeURIComponent(m[1]),
      assignmentId: decodeURIComponent(m[2]),
      ...(isQuiz ? { isQuiz: true } : {}),
    };
  } catch {
    return {
      groupId: m[1],
      assignmentId: m[2],
      ...(isQuiz ? { isQuiz: true } : {}),
    };
  }
}

/**
 * 解析 `…/group/:groupId/assignments`（不含單筆 assignment，避免與 `…/assignment/:id` 混淆）
 */
export function parseGroupAssignmentsListDeepLink(
  url: string | null | undefined,
): { groupId: string } | null {
  if (!url || typeof url !== 'string') return null;
  let candidate = url;
  try {
    const parsed = ExpoLinking.parse(url);
    if (parsed.path) candidate = parsed.path;
  } catch {
    /* use raw url */
  }
  const looksLikeAssignment =
    ASSIGNMENT_PATH_RE.test(candidate) || ASSIGNMENT_PATH_RE.test(url);
  if (looksLikeAssignment) return null;
  let m = candidate.match(ASSIGNMENTS_LIST_PATH_RE);
  if (!m) m = url.match(ASSIGNMENTS_LIST_PATH_RE);
  if (!m) return null;
  try {
    return { groupId: decodeURIComponent(m[1]) };
  } catch {
    return { groupId: m[1] };
  }
}

/**
 * query 帶 hub 時，只允許「單一 id」路徑（例如 …/group/g1?hub=1），
 * 不可與 /post/、/assignment/、/assignments 並存，避免誤判。
 */
function matchGroupIdForHubQueryParam(url: string): string | null {
  if (/\/post\//i.test(url)) return null;
  if (/\/assignment\//i.test(url)) return null;
  if (/\/assignments(?:\?|$|#|\/)/i.test(url)) return null;
  const m = url.match(/group\/([^/?#]+)\/?(?=\?|#|$)/i);
  if (!m) return null;
  return m[1];
}

/**
 * 可選進入課程工作區：`…/group/:id/hub` 或 `…/group/:id?hub=1`（及 courseHub、learn）。
 * 裸 `group/:id` 仍交給 React Navigation → GroupDetail。
 */
export function parseGroupCourseHubDeepLink(
  url: string | null | undefined,
): { groupId: string } | null {
  if (!url || typeof url !== 'string') return null;

  if (parseGroupAssignmentDeepLink(url)) return null;
  if (parseGroupAssignmentsListDeepLink(url)) return null;

  let candidate = url;
  let expoQuery: Record<string, string | string[] | undefined> | undefined;
  try {
    const parsed = ExpoLinking.parse(url);
    expoQuery = parsed.queryParams ?? undefined;
    if (parsed.path) candidate = parsed.path;

    const host = String(parsed.hostname || '').toLowerCase();
    const pathSeg = String(parsed.path || '').replace(/^\//, '');
    const fromHostHub = host === 'group' && pathSeg.match(/^([^/]+)\/hub(?:\?|$|#|\/)/i);
    if (fromHostHub) {
      const gid = fromHostHub[1];
      try {
        return { groupId: decodeURIComponent(gid) };
      } catch {
        return { groupId: gid };
      }
    }
  } catch {
    /* use raw url */
  }

  const m = candidate.match(GROUP_HUB_SUFFIX_RE) ?? url.match(GROUP_HUB_SUFFIX_RE);
  if (m) {
    try {
      return { groupId: decodeURIComponent(m[1]) };
    } catch {
      return { groupId: m[1] };
    }
  }

  const wantsHub =
    queryWantsCourseHub(expoQuery) ||
    queryWantsCourseHub(parseQueryRecord(url) as Record<string, string | string[] | undefined>);
  if (wantsHub) {
    try {
      const parsed = ExpoLinking.parse(url);
      const host = String(parsed.hostname || '').toLowerCase();
      const pathSeg = String(parsed.path || '').replace(/^\//, '');
      if (host === 'group' && pathSeg && !pathSeg.includes('/')) {
        try {
          return { groupId: decodeURIComponent(pathSeg) };
        } catch {
          return { groupId: pathSeg };
        }
      }
    } catch {
      /* fall through */
    }
    const fromQuery = matchGroupIdForHubQueryParam(url);
    if (fromQuery) {
      try {
        return { groupId: decodeURIComponent(fromQuery) };
      } catch {
        return { groupId: fromQuery };
      }
    }
  }

  return null;
}

/** 訊息分頁相關、需特殊處理的連結（攔截後改走 Learn／InboxTask 動線） */
export function isInterceptedMessagingDeepLink(url: string | null | undefined): boolean {
  return !!(
    parseGroupAssignmentDeepLink(url) ||
    parseGroupAssignmentsListDeepLink(url) ||
    parseGroupCourseHubDeepLink(url)
  );
}
