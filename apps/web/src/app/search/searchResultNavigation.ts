// The pinned Next HistoryUpdater patch marks its own writes before invoking History.
export const APP_ROUTER_HISTORY_PUSH = Symbol.for('nuni.app-router.history-push');
export const APP_ROUTER_HISTORY_REPLACE = Symbol.for('nuni.app-router.history-replace');
export const APP_ROUTER_SYNC_HISTORY_QUERY = Symbol.for('nuni.app-router.sync-history-query');

// Link.onNavigate and Next's transition-start hook run in the same call stack.
// Only that dispatch can claim the intent. Every later dispatch supersedes it.
let intent: string | null = null;
let navigating: { token: string; sourceHash: string } | null = null;

export function markSearchResultNavigation(token: string) {
  intent = token;
  queueMicrotask(() => {
    if (intent === token) intent = null;
  });
}

export function startSearchResultNavigation(type: 'push' | 'replace' | 'traverse') {
  // Capture the fragment before application history writes can move the source entry.
  navigating = type === 'push' && intent !== null
    ? { token: intent, sourceHash: window.location.hash }
    : null;
  intent = null;
}

export function isSearchResultNavigationPending(token: string) {
  return navigating?.token === token;
}

export function consumeSearchResultNavigation() {
  const navigation = navigating;
  navigating = null;
  return navigation;
}
