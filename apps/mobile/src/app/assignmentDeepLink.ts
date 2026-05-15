import * as ExpoLinking from 'expo-linking';

const ASSIGNMENT_PATH_RE = /group\/([^/]+)\/assignment\/([^/?#]+)/i;

/**
 * 解析 `…/group/:groupId/assignment/:assignmentId`（含 campus://、https:、expo dev URL）
 */
export function parseGroupAssignmentDeepLink(url: string | null | undefined): {
  groupId: string;
  assignmentId: string;
} | null {
  if (!url || typeof url !== 'string') return null;
  let candidate = url;
  try {
    const parsed = ExpoLinking.parse(url);
    if (parsed.path) candidate = parsed.path;
  } catch {
    /* use raw url */
  }
  const m = candidate.match(ASSIGNMENT_PATH_RE);
  if (!m) return null;
  try {
    return { groupId: decodeURIComponent(m[1]), assignmentId: decodeURIComponent(m[2]) };
  } catch {
    return { groupId: m[1], assignmentId: m[2] };
  }
}
