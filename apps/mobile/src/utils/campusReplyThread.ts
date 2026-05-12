import type { Timestamp } from 'firebase/firestore';
import type { CampusReply } from '../services/threads';

/** 將平面 replies（含 optional parentReplyId）排成深度優先順序並附顯示用縮排。 */
export type CampusReplyNode = CampusReply & { threadDepth: number };

function replyCreatedMs(r: CampusReply): number {
  const t = r.createdAt;
  if (t != null && typeof (t as Timestamp).toMillis === 'function') {
    return (t as Timestamp).toMillis();
  }
  if (t instanceof Date) return t.getTime();
  const s = typeof t === 'string' ? Date.parse(t) : NaN;
  return Number.isFinite(s) ? s : 0;
}

/** 將留言依 parent／createdAt 排成巢狀顯示列；未知父節列為根层。 */
export function flattenCampusRepliesThread(replies: CampusReply[]): CampusReplyNode[] {
  const ids = new Set(replies.map((r) => r.id));
  const byParent = new Map<string | null, CampusReply[]>();
  for (const r of replies) {
    const raw = r.parentReplyId ?? null;
    const pid = raw && ids.has(raw) ? raw : null;
    const list = byParent.get(pid) ?? [];
    list.push(r);
    byParent.set(pid, list);
  }
  for (const [, list] of byParent) {
    list.sort((a, b) => replyCreatedMs(a) - replyCreatedMs(b));
  }
  const out: CampusReplyNode[] = [];
  const depthFromDoc = (r: CampusReply) =>
    typeof r.depth === 'number' && Number.isFinite(r.depth) ? Math.min(12, Math.max(0, r.depth)) : null;

  const walk = (parentId: string | null, fallbackDepth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      const d = depthFromDoc(child) ?? fallbackDepth;
      out.push({ ...child, threadDepth: d });
      walk(child.id, d + 1);
    }
  };
  walk(null, 0);
  return out;
}
