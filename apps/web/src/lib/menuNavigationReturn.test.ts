import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const originUrl = '/map?campus=pu#services';
const destination = '/classroom/material-bookmarks?campus=pu';
const draft = {
  scope: 'original-account-and-campus',
  query: '教材',
  category: 'study',
  expanded: ['service:/classroom'],
} as const;

async function loadDocument() {
  vi.resetModules();
  return import('./menuNavigationReturn');
}

async function startJourney() {
  const menu = await loadDocument();
  menu.setMenuReturnScope(draft.scope);
  menu.rememberMenuReturn(destination, { ...draft, expanded: [...draft.expanded] });
  const originState = window.history.state;
  window.history.pushState({}, '', destination);
  return { menu, originState };
}

function backToOrigin(state: unknown, url = originUrl) {
  window.history.replaceState(state, '', url);
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({ router: 'keep' }, '', originUrl);
});

afterEach(() => vi.restoreAllMocks());

it('restores all draft fields after reloading the service and waits for scope confirmation', async () => {
  const { originState } = await startJourney();
  const reloaded = await loadDocument();
  reloaded.setMenuReturnScope('unresolved', true);
  expect(reloaded.getMenuReturn()).toBeNull();
  backToOrigin(originState);
  const pending = reloaded.getMenuReturn()!;
  expect(pending).toMatchObject({ ...draft, url: originUrl });
  reloaded.setMenuReturnScope(draft.scope);
  expect(reloaded.consumeMenuReturn(pending, draft.scope)).toBe(true);
  expect(reloaded.getMenuReturn()).toBeNull();
  expect(window.history.state).toEqual(originState);

  window.history.pushState({}, '', destination);
  const nextReload = await loadDocument();
  backToOrigin(originState);
  // The first header can mount after Back has already reached the origin.
  nextReload.setMenuReturnScope(draft.scope);
  expect(nextReload.getMenuReturn()).toMatchObject(draft);
});

it.each(['other-account', 'other-campus', null])(
  'purges a stored draft on confirming a different scope (%s) after reload',
  async (scope) => {
    const { menu: previousDocument, originState } = await startJourney();
    const reloaded = await loadDocument();
    reloaded.setMenuReturnScope(scope);
    backToOrigin(originState);
    expect(reloaded.getMenuReturn()).toBeNull();
    // A previous document kept in the browser cache must see the deletion too.
    expect(previousDocument.getMenuReturn()).toBeNull();
    reloaded.setMenuReturnScope(draft.scope);
    backToOrigin(originState);
    expect(reloaded.getMenuReturn()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  },
);

it('requires both the original URL and the history marker', async () => {
  const { originState } = await startJourney();
  const reloaded = await loadDocument();
  reloaded.setMenuReturnScope(draft.scope);
  backToOrigin({}, originUrl);
  expect(reloaded.getMenuReturn()).toBeNull();
  backToOrigin(originState, '/map?campus=pu#other');
  expect(reloaded.getMenuReturn()).toBeNull();
  backToOrigin(originState);
  expect(reloaded.getMenuReturn()).toMatchObject(draft);
});
