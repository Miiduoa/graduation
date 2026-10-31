'use client';

import { useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseCourseWorkHash } from '@/lib/courseWorkLanding';

const PANELS = ['outline', 'materials', 'assignments', 'quizzes', 'attendance', 'members'] as const;
export type CoursePanel = (typeof PANELS)[number];
const LOCATION_EVENT = 'campus-course-location';

function subscribe(changed: () => void) {
  window.addEventListener('hashchange', changed);
  window.addEventListener('popstate', changed);
  window.addEventListener(LOCATION_EVENT, changed);
  return () => {
    window.removeEventListener('hashchange', changed);
    window.removeEventListener('popstate', changed);
    window.removeEventListener(LOCATION_EVENT, changed);
  };
}

function locationSnapshot() {
  return `${window.location.search}${window.location.hash}`;
}

export function resolveCoursePanel(search: string, hash: string): CoursePanel {
  const linked = parseCourseWorkHash(hash);
  if (linked) {
    return linked.kind === 'quiz'
      ? 'quizzes'
      : linked.kind === 'assignment'
        ? 'assignments'
        : 'materials';
  }
  const requested = new URLSearchParams(search).get('view');
  return PANELS.includes(requested as CoursePanel) ? (requested as CoursePanel) : 'outline';
}

export function useCoursePanel() {
  // Keep this subscription as well: Next navigation can update the query without a popstate.
  const params = useSearchParams();
  const location = useSyncExternalStore(subscribe, locationSnapshot, () => '');
  const current = new URL(location || `?${params.toString()}`, 'https://campus.local');
  const panel = resolveCoursePanel(current.search, current.hash);
  const listParams = new URLSearchParams();
  for (const key of ['q', 'courses', 'task', 'taskCourse', 'campus', 'schoolId', 'school']) {
    const value = current.searchParams.get(key);
    if (value) listParams.set(key, value);
  }
  const courseListHref = listParams.size ? `/classroom?${listParams.toString()}` : '/classroom';

  function navigate(next: CoursePanel) {
    const url = new URL(window.location.href);
    const before = `${url.pathname}${url.search}${url.hash}`;
    const previousHash = url.hash;
    url.searchParams.set('view', next);
    // Explicitly choosing another panel clears only a conflicting task target.
    // Unrelated fragments and the current campus stay in the address.
    if (parseCourseWorkHash(url.hash) && resolveCoursePanel('', url.hash) !== next) {
      url.hash = '';
    }
    const destination = `${url.pathname}${url.search}${url.hash}`;
    if (destination !== before) window.history.pushState(null, '', destination);
    window.dispatchEvent(new Event(LOCATION_EVENT));
    if (previousHash !== url.hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  return { panel, navigate, courseListHref };
}
