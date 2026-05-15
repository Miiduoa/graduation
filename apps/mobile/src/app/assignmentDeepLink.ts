import * as ExpoLinking from 'expo-linking';

const ASSIGNMENT_PATH_RE = /group\/([^/]+)\/assignment\/([^/?#]+)/i;

export type GroupAssignmentDeepLink = {
  groupId: string;
  assignmentId: string;
  /** 来自 query，例如 `?kind=quiz`、`isQuiz=1`（推播／後端可帶） */
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
  const m = candidate.match(ASSIGNMENT_PATH_RE);
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
