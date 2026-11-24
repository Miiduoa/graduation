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

export function consumeSearchResultNavigation() {
  const token = navigating;
  navigating = null;
  return token;
}
