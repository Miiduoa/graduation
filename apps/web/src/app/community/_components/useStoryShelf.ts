import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  markStoryViewed,
  type CampusStoryDoc,
  type StoryAuthorGroup,
} from '@/lib/community/firestore';

export function useStoryShelf(source: StoryAuthorGroup[], schoolId: string, uid?: string) {
  const [clock, setClock] = useState(Date.now);
  const [currentId, setCurrentId] = useState<string | null>(null);
  // Both tabs mount inside the account and school boundary in CommunityAccess.
  const storageKey = 'campus:story-reads:v1:' + JSON.stringify([schoolId, uid]);
  // Separate the local unread ring from in-flight or acknowledged server receipts.
  const receipts = useRef(new Set<string>());
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => {
    try {
      const ids = JSON.parse(window.sessionStorage.getItem(storageKey) ?? '[]');
      return new Set<string>(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const groups = useMemo(() => {
    const now = clock;
    return source.flatMap((group) => {
      const stories = group.stories.filter(
        (s) =>
          s.schoolId === schoolId &&
          typeof s.expiresAt === 'number' &&
          Number.isFinite(s.expiresAt) &&
          s.expiresAt > now,
      );
      return stories.length ? [{ ...group, stories }] : [];
    });
  }, [source, schoolId, clock]);
  useEffect(() => {
    if (!groups.length) return;
    const nextExpiry = Math.min(...groups.flatMap((g) => g.stories.map((s) => s.expiresAt!)));
    const tick = () => setClock(Date.now());
    const timer = window.setTimeout(
      tick,
      Math.max(0, Math.min(2_147_483_647, nextExpiry - Date.now())),
    );
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [groups]);

  const show = useCallback(
    (story?: CampusStoryDoc) => {
      if (!uid || !story || story.schoolId !== schoolId || (story.expiresAt ?? 0) <= Date.now()) {
        setCurrentId(null);
        setClock(Date.now());
        return;
      }
      setCurrentId(story.id);
      const receipt = JSON.stringify([schoolId, uid, story.authorUid, story.id]);
      if (story.authorUid !== uid && !receipts.current.has(receipt)) {
        receipts.current.add(receipt);
        void markStoryViewed(story, uid).catch(() => receipts.current.delete(receipt));
      }
      if (seen.has(story.id)) return;
      const next = new Set([...seen, story.id]);
      setSeen(next);
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify([...next].slice(-160)));
      } catch {
        /* Private browsing can disable storage. */
      }
    },
    [uid, schoolId, seen, storageKey],
  );

  const groupIndex = groups.findIndex((g) => g.stories.some((s) => s.id === currentId));
  const group = groups[groupIndex];
  const index = group?.stories.findIndex((s) => s.id === currentId) ?? -1;
  const previous = group?.stories[index - 1] ?? groups[groupIndex - 1]?.stories.at(-1);
  const next = group?.stories[index + 1] ?? groups[groupIndex + 1]?.stories[0];
  const close = () => setCurrentId(null);
  return {
    groups,
    seen,
    open: (g: StoryAuthorGroup) => show(g.stories.find((s) => !seen.has(s.id)) ?? g.stories[0]),
    viewer:
      group && index >= 0
        ? {
            group,
            index,
            viewerUid: uid,
            isOwner: !!uid && group.authorUid === uid && group.stories[index].authorUid === uid,
            hasPrevious: !!previous,
            hasNext: !!next,
            previous: () => {
              if (previous) show(previous);
            },
            next: () => show(next),
            switchAuthor: (delta: number) => {
              const target = groups[groupIndex + delta];
              if (target) show(target.stories.find((s) => !seen.has(s.id)) ?? target.stories[0]);
            },
            close,
          }
        : null,
  };
}
