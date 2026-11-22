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

it.each(['other-account', 'other-campus'])(
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

  backToOrigin({}, '/map?campus=pu#other');
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

it.each(['current URL', 'storage quota'])(
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
    const mock = failure === 'storage quota'
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

it.each([false, true])(
  'restores the new sessionStorage draft after a rejected marker update (previous marker: %s)',
  async (hasPreviousMarker) => {
    const menu = await loadDocument();
    menu.setMenuReturnScope(draft.scope);
    if (hasPreviousMarker) {
      menu.rememberMenuReturn(destination, { ...draft, expanded: [...draft.expanded] });
    }
    const originState = window.history.state;
    const history = vi.spyOn(window.history, 'replaceState').mockImplementationOnce(() => {
      throw new DOMException('History unavailable', 'SecurityError');
    });
    const latest = { ...draft, query: '本次輸入', category: 'campus', expanded: [] } as const;
    menu.rememberMenuReturn(destination, { ...latest, expanded: [] });
    expect(window.history.state).toEqual(originState);
    expect(JSON.parse(sessionStorage.getItem('campus.menu.return.v1')!)).toEqual([
      expect.objectContaining(latest),
    ]);
    history.mockRestore();

    window.history.pushState({}, '', destination);
    const reloaded = await loadDocument();
    reloaded.setMenuReturnScope(draft.scope);
    backToOrigin(originState);
    const pending = reloaded.getMenuReturn()!;
    expect(pending).toMatchObject(latest);
    const acknowledgement = vi.spyOn(window.history, 'replaceState').mockImplementationOnce(() => {
      throw new DOMException('History unavailable', 'SecurityError');
    });
    expect(reloaded.consumeMenuReturn(pending, draft.scope)).toBe(true);
    acknowledgement.mockRestore();
    backToOrigin(originState);
    expect(reloaded.getMenuReturn()).toMatchObject(latest);

    reloaded.discardMenuReturn();
    backToOrigin(originState);
    expect(reloaded.getMenuReturn()).toBeNull();
  },
);

it('prefers the committed draft when legacy cleanup and History marking both fail', async () => {
  const menu = await loadDocument();
  menu.setMenuReturnScope(draft.scope);
  const legacyKey = 'campus.directory.search.v1';
  const legacy = JSON.stringify({
    menu: { ...draft, path: '/map', destination, open: true },
  });
  sessionStorage.setItem(legacyKey, legacy);
  const cleanup = vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
    throw new DOMException('Storage unavailable', 'SecurityError');
  });
  const history = vi.spyOn(window.history, 'replaceState').mockImplementationOnce(() => {
    throw new DOMException('History unavailable', 'SecurityError');
  });
  menu.rememberMenuReturn(destination, { ...draft, query: '本次輸入', expanded: [] });
  expect(sessionStorage.getItem(legacyKey)).toBe(legacy);
  cleanup.mockRestore();
  history.mockRestore();

  const originState = window.history.state;
  const reloaded = await loadDocument();
  reloaded.setMenuReturnScope(draft.scope);
  expect(reloaded.getMenuReturn()).toBeNull();
  expect(reloaded.restoreLegacyMenuReturn('/map')).toBeNull();

  window.history.pushState({}, '', destination);
  const returned = await loadDocument();
  vi.spyOn(window.performance, 'getEntriesByType').mockReturnValue([
    { type: 'back_forward' } as PerformanceNavigationTiming,
  ]);
  window.history.replaceState(originState, '', originUrl);
  returned.setMenuReturnScope(draft.scope);
  const pending = returned.getMenuReturn()!;
  expect(pending.query).toBe('本次輸入');
  expect(returned.consumeMenuReturn(pending, draft.scope)).toBe(true);
});

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

// Merge-base kept a single unscoped menu draft in sessionStorage. In this tab,
// the first complete identity (A or B) can take an unconfirmed draft. Once
// bound, it survives rechecks of that identity and is cleared on an account or campus switch.
it.each([
  ['campus', 'a'],
  ['schoolOwner', 'a'],
  ['platformOwner', 'a'],
  ['platformOwner', 'b'],
] as const)('binds a draft missing %s to its first confirmed account %s', async (field, account) => {
  const menu = await loadDocument();
  const partial = { campus: 'pu', schoolOwner: 'school-a', platformOwner: 'platform-a', [field]: undefined };
  menu.setMenuReturnScope(undefined, partial);
  menu.rememberMenuReturn(destination, { ...draft, expanded: [...draft.expanded] });
  const originState = window.history.state;
  window.history.pushState({}, '', destination);

  const reloaded = await loadDocument();
  reloaded.setMenuReturnScope(undefined, partial);
  backToOrigin(originState);
  const pending = reloaded.getMenuReturn()!;
  expect(pending.provisionalBoundary).toEqual({});
  expect(reloaded.consumeMenuReturn(pending, draft.scope)).toBe(false);

  const scope = `confirmed-${account}`;
  reloaded.setMenuReturnScope(scope, {
    campus: 'pu',
    schoolOwner: `school-${account}`,
    platformOwner: `platform-${account}`,
  });
  expect(reloaded.consumeMenuReturn(pending, scope)).toBe(true);
  expect(pending.scope).toBe(scope);
  expect(pending.provisionalBoundary).toBeUndefined();
  reloaded.setMenuReturnScope('next-account');
  backToOrigin(originState);
  expect(reloaded.getMenuReturn()).toBeNull();
});

it.each(['campus', 'schoolOwner', 'platformOwner'] as const)(
  'protects a bound draft against an overwrite with %s missing after reload',
  async (field) => {
    const { originState } = await startJourney();
    const menu = await loadDocument();
    const complete = { campus: 'pu', schoolOwner: 'school-a', platformOwner: 'platform-a' };
    menu.setMenuReturnScope(undefined, { ...complete, [field]: undefined });
    backToOrigin(originState);
    menu.rememberMenuReturn(destination, { ...draft, query: 'new text', expanded: [] });
    expect(window.history.state).toEqual(originState);
    menu.setMenuReturnScope(draft.scope, complete);
    const pending = menu.getMenuReturn()!;
    expect(pending).toMatchObject(draft);
    expect(menu.consumeMenuReturn(pending, draft.scope)).toBe(true);
  },
);

it('protects a bound legacy draft before it has a history marker', async () => {
  const menu = await loadDocument();
  const key = 'campus.directory.search.v1';
  const legacy = JSON.stringify({
    menu: { ...draft, path: '/map', destination, open: true },
  });
  sessionStorage.setItem(key, legacy);
  menu.setMenuReturnScope(undefined, { campus: 'pu' });
  menu.rememberMenuReturn(destination, { ...draft, query: 'new text', expanded: [] });
  expect(window.history.state).not.toHaveProperty(menu.MENU_RETURN_STATE_KEY);
  expect(sessionStorage.getItem(key)).toBe(legacy);
});

it('waits for confirmation before restoring text entered after a public legacy restore', async () => {
  const menu = await loadDocument();
  menu.setMenuReturnScope(undefined, { campus: 'pu', schoolOwner: 'school-a' });
  menu.rememberMenuReturn(destination, { ...draft, expanded: [...draft.expanded] }, true);
  menu.rememberMenuReturn(destination, { ...draft, query: 'new text', expanded: [] });
  const originState = window.history.state;
  window.history.pushState({}, '', destination);
  backToOrigin(originState);
  const pending = menu.getMenuReturn()!;
  expect(menu.consumeMenuReturn(pending, draft.scope)).toBe(false);
  menu.setMenuReturnScope('first-account', {
    campus: 'pu',
    schoolOwner: 'school-a',
    platformOwner: 'platform-b',
  });
  expect(pending.query).toBe('new text');
  expect(menu.consumeMenuReturn(pending, 'first-account')).toBe(true);
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

it.each(['same account', 'guest'] as const)(
  'keeps a return across a reload during logout until confirming %s',
  async (outcome) => {
    const { originState } = await startJourney();
    const storageKey = 'campus.menu.return.v1';
    const stored = sessionStorage.getItem(storageKey);
    const menu = await loadDocument();
    menu.setMenuReturnScope(null, { campus: 'pu' });
    backToOrigin(originState);
    const pending = menu.getMenuReturn()!;
    expect(pending).toMatchObject(draft);
    expect(menu.consumeMenuReturn(pending, draft.scope)).toBe(false);
    expect(sessionStorage.getItem(storageKey)).toBe(stored);

    if (outcome === 'same account') {
      menu.setMenuReturnScope(draft.scope, { campus: 'pu' });
      expect(menu.consumeMenuReturn(pending, draft.scope)).toBe(true);
    } else {
      menu.setMenuReturnScope('guest', { campus: 'pu' }, true);
      expect(menu.getMenuReturn()).toBeNull();
      expect(sessionStorage.getItem(storageKey)).toBeNull();

      const guestDraft = { ...draft, scope: 'guest', expanded: [...draft.expanded] };
      menu.rememberMenuReturn(destination, guestDraft);
      const guestOrigin = window.history.state;
      window.history.pushState({}, '', destination);
      const reloaded = await loadDocument();
      reloaded.setMenuReturnScope('guest', { campus: 'pu' }, true);
      backToOrigin(guestOrigin);
      const restored = reloaded.getMenuReturn()!;
      expect(restored).toMatchObject(guestDraft);
      expect(reloaded.consumeMenuReturn(restored, 'guest')).toBe(true);
    }
  },
);

it.each(['unconfirmed', 'known account'] as const)(
  'checks a provisional draft from a %s when a reloaded document confirms a guest',
  async (owner) => {
    const menu = await loadDocument();
    const campus = { campus: 'pu' };
    if (owner === 'known account') {
      menu.setMenuReturnScope(draft.scope, { ...campus, platformOwner: 'platform-a' });
    }
    menu.setMenuReturnScope(undefined, campus);
    menu.rememberMenuReturn(destination, { ...draft, expanded: [...draft.expanded] });
    const originState = window.history.state;
    expect(originState).toHaveProperty(menu.MENU_RETURN_STATE_KEY);
    window.history.pushState({}, '', destination);
    const reloaded = await loadDocument();
    backToOrigin(originState);
    reloaded.setMenuReturnScope('guest', campus, true);
    const pending = reloaded.getMenuReturn();
    if (owner === 'unconfirmed') {
      expect(pending).toMatchObject({ ...draft, scope: 'guest' });
      expect(reloaded.consumeMenuReturn(pending!, 'guest')).toBe(true);
    } else {
      expect(pending).toBeNull();
      expect(sessionStorage.getItem('campus.menu.return.v1')).toBeNull();
    }
  },
);

it('replaces a legacy draft at a different origin when saving in a new confirmed scope', async () => {
  const menu = await loadDocument();
  const legacyKey = 'campus.directory.search.v1';
  sessionStorage.setItem(legacyKey, JSON.stringify({
    menu: { ...draft, path: '/events', destination, open: true },
  }));
  const next = { ...draft, scope: 'new-account-and-campus', query: '圖書館', expanded: [] };
  menu.setMenuReturnScope(next.scope);
  menu.rememberMenuReturn(destination, next);
  expect(sessionStorage.getItem(legacyKey)).toBeNull();
  const originState = window.history.state;
  window.history.pushState({}, '', destination);
  backToOrigin(originState);
  const returned = menu.getMenuReturn()!;
  expect(returned).toMatchObject(next);
  expect(menu.consumeMenuReturn(returned, next.scope)).toBe(true);
});
