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
  const unconfirmed = { campus: undefined, schoolOwner: 'school-a', platformOwner: '' };
  const confirmed = { ...unconfirmed, campus: 'pu' };
  reloaded.setMenuReturnScope(undefined, unconfirmed);
  expect(reloaded.getMenuReturn()).toBeNull();
  backToOrigin(originState);
  const pending = reloaded.getMenuReturn()!;
  expect(pending).toMatchObject(draft);
  expect(reloaded.consumeMenuReturn(pending, draft.scope)).toBe(false);
  reloaded.setMenuReturnScope(undefined, unconfirmed);
  reloaded.setMenuReturnScope(draft.scope, confirmed);
  expect(reloaded.consumeMenuReturn(pending, draft.scope)).toBe(true);
  expect(reloaded.getMenuReturn()).toBeNull();
  expect(window.history.state).toMatchObject(originState);
  const acknowledged = window.history.state;
  const originReload = await loadDocument();
  originReload.setMenuReturnScope(draft.scope);
  expect(originReload.getMenuReturn()).toBeNull();

  window.history.pushState({}, '', destination);
  const nextReload = await loadDocument();
  nextReload.setMenuReturnScope(draft.scope);
  backToOrigin(acknowledged);
  expect(nextReload.getMenuReturn()).toMatchObject(draft);

  // A cross-document Back can reach the origin before its first listener mounts.
  vi.spyOn(window.performance, 'getEntriesByType').mockReturnValue([
    { type: 'back_forward' } as PerformanceNavigationTiming,
  ]);
  const historyDocument = await loadDocument();
  historyDocument.setMenuReturnScope(draft.scope);
  expect(historyDocument.getMenuReturn()).toMatchObject(draft);
});

it.each(['same', 'different'] as const)(
  'keeps a migrated public draft through a reload and checks its known boundary (%s)',
  async (account) => {
    const menu = await loadDocument();
    menu.setMenuReturnScope(undefined, { campus: 'pu' });
    menu.rememberMenuReturn(destination, { ...draft, expanded: [...draft.expanded] }, true);
    menu.setMenuReturnScope(undefined, { campus: 'pu', schoolOwner: 'school-a' });
    const originState = window.history.state;
    const reloaded = await loadDocument();
    reloaded.setMenuReturnScope(undefined, {
      campus: 'pu',
      schoolOwner: account === 'same' ? 'school-a' : 'school-b',
    });
    expect(reloaded.getMenuReturn()).toBeNull();
    window.history.pushState({}, '', destination);
    backToOrigin(originState);
    if (account === 'same') {
      const pending = reloaded.getMenuReturn()!;
      expect(pending).toMatchObject(draft);
      expect(reloaded.consumeMenuReturn(pending, draft.scope)).toBe(true);
    } else {
      expect(reloaded.getMenuReturn()).toBeNull();
      expect(sessionStorage.length).toBe(0);
    }
  },
);

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

it('matches each history marker to its own path, query and fragment', async () => {
  const { originState } = await startJourney();
  const otherUrl = '/map?campus=ntnu#services';
  window.history.pushState({}, '', otherUrl);
  const reloaded = await loadDocument();
  reloaded.setMenuReturnScope(draft.scope);
  const expanded = [...draft.expanded];
  reloaded.rememberMenuReturn(destination, { ...draft, expanded, query: '公車' });
  const otherState = window.history.state;
  expect(otherState).not.toEqual(originState);

  backToOrigin({}, originUrl);
  expect(reloaded.getMenuReturn()).toBeNull();
  for (const mismatchedUrl of [otherUrl, '/map?campus=pu#other', '/bus?campus=pu#services']) {
    backToOrigin(originState, mismatchedUrl);
    expect(reloaded.getMenuReturn()).toBeNull();
  }
  backToOrigin(originState);
  expect(reloaded.getMenuReturn()).toMatchObject(draft);
  backToOrigin(otherState, originUrl);
  expect(reloaded.getMenuReturn()).toBeNull();
  backToOrigin(otherState, otherUrl);
  expect(reloaded.getMenuReturn()).toMatchObject({ query: '公車' });
});

it('scrubs raw URLs from existing drafts and still restores the matching entry', async () => {
  const historyKey = 'campus.menu.return.v1';
  const legacyUrl = '/login?returnUrl=%2Ftimetable%2Fshare%3Ftoken%3Dfake-legacy#fake-fragment';
  const token = 'existing-marker';
  sessionStorage.setItem(
    historyKey,
    JSON.stringify([{ url: '/map?token=fake-invalid' }, { ...draft, token, url: legacyUrl }]),
  );
  const menu = await loadDocument();
  menu.setMenuReturnScope(draft.scope);
  const stored = sessionStorage.getItem(historyKey)!;
  expect(stored).not.toMatch(/fake-|\/login|returnUrl/u);
  expect(JSON.parse(stored)).toEqual([
    { ...draft, token, urlDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) },
  ]);
  backToOrigin({ [menu.MENU_RETURN_STATE_KEY]: token }, legacyUrl);
  const pending = menu.getMenuReturn()!;
  expect(pending).toMatchObject(draft);
  expect(menu.consumeMenuReturn(pending, draft.scope)).toBe(true);
});

it.each(['current URL', 'history failure', 'storage quota'])(
  'keeps the legacy and current drafts when replacement encounters %s',
  async (failure) => {
    const { menu, originState } = await startJourney();
    backToOrigin(originState);
    const original = menu.getMenuReturn();
    const historyKey = 'campus.menu.return.v1';
    const legacyKey = 'campus.directory.search.v1';
    const legacy = JSON.stringify({
      menu: { path: '/map', destination, query: '教材', category: 'study', open: true },
    });
    sessionStorage.setItem(legacyKey, legacy);
    const saved = sessionStorage.getItem(historyKey);
    const mock =
      failure === 'history failure'
        ? vi.spyOn(window.history, 'replaceState').mockImplementationOnce(() => {
            throw new DOMException('History unavailable', 'SecurityError');
          })
        : failure === 'storage quota'
          ? vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
              throw new DOMException('Storage full', 'QuotaExceededError');
            })
          : undefined;

    menu.rememberMenuReturn(failure === 'current URL' ? originUrl : destination, {
      ...draft,
      query: 'new draft',
      expanded: [],
    });

    mock?.mockRestore();
    expect(window.history.state).toEqual(originState);
    expect(sessionStorage.getItem(historyKey)).toBe(saved);
    expect(sessionStorage.getItem(legacyKey)).toBe(legacy);
    expect(menu.getMenuReturn()).toBe(original);
    backToOrigin(originState);
    expect(menu.consumeMenuReturn(original!, draft.scope)).toBe(true);
  },
);

it.each(['same', 'schoolOwner', 'platformOwner', 'campus'] as const)(
  'checks the known provisional boundary after a reload (%s)',
  async (changed) => {
    const menu = await loadDocument();
    const known = { campus: 'pu', schoolOwner: 'school-a', platformOwner: 'platform-a' };
    menu.setMenuReturnScope(draft.scope, known);
    menu.setMenuReturnScope(undefined, {});
    menu.rememberMenuReturn(destination, { ...draft, expanded: [...draft.expanded] });
    const originState = window.history.state;
    window.history.pushState({}, '', destination);

    const reloaded = await loadDocument();
    reloaded.setMenuReturnScope(undefined, {});
    backToOrigin(originState);
    const pending = reloaded.getMenuReturn()!;
    expect(pending).toBeTruthy();
    expect(reloaded.consumeMenuReturn(pending, draft.scope)).toBe(false);
    const confirmed = changed === 'same' ? known : { ...known, [changed]: 'different' };
    const scope = changed === 'same' ? draft.scope : 'different-scope';
    reloaded.setMenuReturnScope(scope, confirmed);
    expect(reloaded.consumeMenuReturn(pending, scope)).toBe(changed === 'same');
  },
);

it.each([
  ['campus', 'draft'],
  ['schoolOwner', 'draft'],
  ['platformOwner', 'draft'],
  ['campus', 'confirmation'],
  ['schoolOwner', 'confirmation'],
  ['platformOwner', 'confirmation'],
] as const)('does not bind a new draft with %s missing at %s', async (field, missingAt) => {
  const menu = await loadDocument();
  const complete = { campus: 'pu', schoolOwner: 'school-a', platformOwner: 'platform-a' };
  const partial = { ...complete, [field]: undefined };
  menu.setMenuReturnScope(undefined, missingAt === 'draft' ? partial : complete);
  menu.rememberMenuReturn(destination, { ...draft, expanded: [...draft.expanded] });
  const originState = window.history.state;
  window.history.pushState({}, '', destination);
  // Learning the field later during verification cannot change the original binding.
  menu.setMenuReturnScope(undefined, complete);
  menu.setMenuReturnScope(draft.scope, missingAt === 'confirmation' ? partial : complete);
  backToOrigin(originState);
  expect(menu.getMenuReturn()).toBeNull();
  expect(sessionStorage.length).toBe(0);
});

it('does not carry the public legacy exception over to newly entered text', async () => {
  const menu = await loadDocument();
  menu.setMenuReturnScope(undefined, { campus: 'pu', schoolOwner: 'school-a' });
  menu.rememberMenuReturn(destination, { ...draft, expanded: [...draft.expanded] }, true);
  menu.rememberMenuReturn(destination, { ...draft, query: 'new text', expanded: [] });
  const originState = window.history.state;
  window.history.pushState({}, '', destination);
  menu.setMenuReturnScope('different-account', {
    campus: 'pu',
    schoolOwner: 'school-a',
    platformOwner: 'platform-b',
  });
  backToOrigin(originState);
  expect(menu.getMenuReturn()).toBeNull();
  expect(sessionStorage.length).toBe(0);
});

it.each(['same', 'different'] as const)(
  'acknowledges a bound legacy draft before campus confirmation and checks its original scope (%s)',
  async (outcome) => {
    const menu = await loadDocument();
    const unresolved = { schoolOwner: 'school-a' };
    menu.setMenuReturnScope(undefined, unresolved);
    const provisionalScope = 'campus-unresolved';
    menu.rememberMenuReturn(
      destination,
      { ...draft, scope: provisionalScope, expanded: [...draft.expanded] },
      true,
      draft.scope,
    );

    const reloaded = await loadDocument();
    reloaded.setMenuReturnScope(undefined, unresolved);
    expect(reloaded.getMenuReturn()).toBeNull();
    const originState = window.history.state;
    window.history.pushState({}, '', destination);
    backToOrigin(originState);
    const pending = reloaded.getMenuReturn()!;
    expect(reloaded.consumeMenuReturn(pending, provisionalScope)).toBe(true);

    // A second service visit while campus is unresolved must retain the original scope.
    reloaded.rememberMenuReturn(destination, {
      ...draft,
      scope: provisionalScope,
      expanded: [...draft.expanded],
    });
    const nextOriginState = window.history.state;
    window.history.pushState({}, '', destination);
    backToOrigin(nextOriginState);
    expect(reloaded.consumeMenuReturn(reloaded.getMenuReturn()!, provisionalScope)).toBe(true);
    const changed = outcome === 'different';
    expect(reloaded.setMenuReturnScope(changed ? 'different-scope' : draft.scope, {
      ...unresolved,
      campus: changed ? 'nthu' : 'pu',
    })).toBe(changed);
    const acknowledged = window.history.state;
    window.history.pushState({}, '', destination);
    backToOrigin(acknowledged);
    if (changed) expect(reloaded.getMenuReturn()).toBeNull();
    else expect(reloaded.getMenuReturn()).toMatchObject(draft);
  },
);
