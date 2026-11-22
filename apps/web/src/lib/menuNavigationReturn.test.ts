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
  expect(pending).toMatchObject({ ...draft, url: originUrl });
  expect(reloaded.consumeMenuReturn(pending, draft.scope)).toBe(false);
  reloaded.setMenuReturnScope(undefined, unconfirmed);
  reloaded.setMenuReturnScope(draft.scope, confirmed);
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
