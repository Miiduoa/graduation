// The pinned Next HistoryUpdater patch marks its own push before invoking History.
export const APP_ROUTER_HISTORY_PUSH = Symbol.for('nuni.app-router.history-push');

// Link.onNavigate and Next's transition-start hook run in the same call stack.
// Only that dispatch can claim the intent. Every later dispatch supersedes it.
let intent: string | null = null;
let navigating: string | null = null;

export function markSearchResultNavigation(token: string) {
  intent = token;
  queueMicrotask(() => {
    if (intent === token) intent = null;
  });
}

export function startSearchResultNavigation(type: 'push' | 'replace' | 'traverse') {
  navigating = type === 'push' ? intent : null;
  intent = null;
}

export function isSearchResultNavigationPending(token: string) {
  return navigating === token;
}

export function consumeSearchResultNavigation() {
  const token = navigating;
  navigating = null;
  return token;
}
