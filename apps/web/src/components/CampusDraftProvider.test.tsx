import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  CampusDraftProvider,
  campusDraftIdentity,
  discardActiveCampusDrafts,
  hasCampusDraftActivity,
  purgeAccountDrafts,
  scopeStorageKey,
  useCampusDraft,
} from './CampusDraftProvider';

let latest: ReturnType<typeof useCampusDraft>;

function Probe() {
  const draft = useCampusDraft('assistant');
  useEffect(() => {
    latest = draft;
  }, [draft]);
  return <output data-testid="draft">{draft.text}</output>;
}

function View(props: {
  uid?: string | null;
  schoolId?: string | null;
  ready?: boolean;
  identityReady?: boolean;
}) {
  return (
    <CampusDraftProvider
      uid={props.uid === undefined ? 'alice' : props.uid}
      identityReady={props.identityReady}
      schoolId={props.schoolId ?? 'school-a'}
      ready={props.ready ?? true}
    >
      <Probe />
    </CampusDraftProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  discardActiveCampusDrafts();
});

afterEach(() => {
  sessionStorage.clear();
});

it('keeps the same-account same-school draft across unmount and remount', () => {
  const view = render(<View />);
  act(() => latest.setText('跨頁要保留的問題'));
  expect(screen.getByTestId('draft').textContent).toBe('跨頁要保留的問題');
  expect(hasCampusDraftActivity()).toBe(true);
  expect(sessionStorage.getItem(scopeStorageKey('alice', 'school-a'))).toContain('跨頁要保留的問題');
  view.unmount();
  render(<View />);
  expect(screen.getByTestId('draft').textContent).toBe('跨頁要保留的問題');
  expect(hasCampusDraftActivity()).toBe(true);
});

it('does not carry school A draft into school B', () => {
  const view = render(<View schoolId="school-a" />);
  act(() => latest.setText('甲校草稿'));
  view.rerender(<View schoolId="school-b" />);
  expect(screen.getByTestId('draft').textContent).toBe('');
  expect(hasCampusDraftActivity()).toBe(false);
  view.rerender(<View schoolId="school-a" />);
  expect(screen.getByTestId('draft').textContent).toBe('甲校草稿');
});

it('clears the previous account drafts on account change and logout', () => {
  const view = render(<View uid="alice" />);
  act(() => latest.setText('Alice 的草稿'));
  expect(sessionStorage.getItem(scopeStorageKey('alice', 'school-a'))).toBeTruthy();
  view.rerender(<View uid="bob" />);
  expect(screen.getByTestId('draft').textContent).toBe('');
  expect(hasCampusDraftActivity()).toBe(false);
  expect(sessionStorage.getItem(scopeStorageKey('alice', 'school-a'))).toBeNull();

  act(() => latest.setText('Bob 的草稿'));
  view.rerender(<View uid={null} />);
  expect(screen.getByTestId('draft').textContent).toBe('');
  expect(sessionStorage.getItem(scopeStorageKey('bob', 'school-a'))).toBeNull();
});

it('discardActiveCampusDrafts clears the current scope and activity flag', () => {
  render(<View />);
  act(() => latest.setText('待捨棄'));
  expect(hasCampusDraftActivity()).toBe(true);
  act(() => discardActiveCampusDrafts());
  expect(screen.getByTestId('draft').textContent).toBe('');
  expect(hasCampusDraftActivity()).toBe(false);
  expect(sessionStorage.getItem(scopeStorageKey('alice', 'school-a'))).toBeNull();
});

it('purgeAccountDrafts only removes that account session keys', () => {
  sessionStorage.setItem(scopeStorageKey('alice', 'school-a'), JSON.stringify({ assistant: 'a' }));
  sessionStorage.setItem(scopeStorageKey('bob', 'school-a'), JSON.stringify({ assistant: 'b' }));
  purgeAccountDrafts('alice');
  expect(sessionStorage.getItem(scopeStorageKey('alice', 'school-a'))).toBeNull();
  expect(sessionStorage.getItem(scopeStorageKey('bob', 'school-a'))).toContain('b');
});

it('keeps the last resolved school draft while ready flips false with a null schoolId', () => {
  const view = render(<View schoolId="school-a" ready />);
  act(() => latest.setText('loading 期間要留住'));
  expect(hasCampusDraftActivity()).toBe(true);
  view.rerender(<View schoolId={null} ready={false} />);
  expect(screen.getByTestId('draft').textContent).toBe('loading 期間要留住');
  expect(hasCampusDraftActivity()).toBe(true);
  view.rerender(<View schoolId="school-a" ready />);
  expect(screen.getByTestId('draft').textContent).toBe('loading 期間要留住');
  expect(hasCampusDraftActivity()).toBe(true);
});

it('starts empty on account change even if the destination has stale drafts', () => {
  sessionStorage.setItem(
    scopeStorageKey('bob', 'school-a'),
    JSON.stringify({ assistant: 'Bob 既有草稿' }),
  );
  const view = render(<View uid="alice" schoolId="school-a" />);
  act(() => latest.setText('Alice 的草稿'));
  expect(sessionStorage.getItem(scopeStorageKey('alice', 'school-a'))).toBeTruthy();
  view.rerender(<View uid="bob" schoolId="school-a" ready />);
  expect(screen.getByTestId('draft').textContent).toBe('');
  expect(hasCampusDraftActivity()).toBe(false);
  expect(sessionStorage.getItem(scopeStorageKey('alice', 'school-a'))).toBeNull();
  expect(sessionStorage.getItem(scopeStorageKey('bob', 'school-a'))).toBeNull();
});

for (const kind of ['platform', 'firebase'] as const) {
  it(`${kind} A → logout → B clears all old schools and guest drafts`, () => {
    const identity = (id: string) => kind === 'platform'
      ? campusDraftIdentity(null, id) : campusDraftIdentity(id, null);
    const a = identity('a');
    const b = identity('b');
    const view = render(<View uid={a} />);
    act(() => latest.setText('舊帳草稿'));
    sessionStorage.setItem(scopeStorageKey(a, 'school-b'), JSON.stringify({ assistant: '其他校草稿' }));
    sessionStorage.setItem(scopeStorageKey(null, 'school-b'), JSON.stringify({ assistant: '訪客草稿' }));
    view.rerender(<View uid={null} />);
    expect(screen.getByTestId('draft').textContent).toBe('');
    expect(sessionStorage.getItem(scopeStorageKey(a, 'school-a'))).toBeNull();
    expect(sessionStorage.getItem(scopeStorageKey(a, 'school-b'))).toBeNull();
    expect(sessionStorage.getItem(scopeStorageKey(null, 'school-b'))).toBeNull();
    view.rerender(<View uid={b} />);
    expect(screen.getByTestId('draft').textContent).toBe('');
    expect(hasCampusDraftActivity()).toBe(false);
    view.rerender(<View uid={a} />);
    expect(screen.getByTestId('draft').textContent).toBe('');
  });
}

it('includes both identities without delimiter collisions', () => {
  expect(campusDraftIdentity('a', 'b')).not.toBe(campusDraftIdentity('a', 'c'));
  expect(campusDraftIdentity('a', 'b')).not.toBe(campusDraftIdentity('c', 'b'));
  expect(campusDraftIdentity('a|b', 'c')).not.toBe(campusDraftIdentity('a', 'b|c'));
});

it('does not read, display, or edit drafts until identity is confirmed', () => {
  sessionStorage.setItem(scopeStorageKey('alice', 'school-a'), JSON.stringify({ assistant: '原草稿' }));
  const view = render(<View identityReady={false} />);
  expect(screen.getByTestId('draft').textContent).toBe('');
  expect(hasCampusDraftActivity()).toBe(false);
  act(() => latest.setText('不可寫入'));
  view.rerender(<View identityReady />);
  expect(screen.getByTestId('draft').textContent).toBe('原草稿');
  view.rerender(<View identityReady={false} />);
  expect(screen.getByTestId('draft').textContent).toBe('');
  expect(hasCampusDraftActivity()).toBe(false);
  view.rerender(<View uid="bob" identityReady={false} />);
  view.rerender(<View uid="bob" identityReady />);
  expect(screen.getByTestId('draft').textContent).toBe('');
});

it('restores the confirmed same account after initial identity loading on a new page', () => {
  const uid = campusDraftIdentity(null, 'platform-a');
  sessionStorage.setItem(scopeStorageKey(uid, 'school-a'), JSON.stringify({ assistant: '跨頁草稿' }));
  const view = render(<View uid={null} identityReady={false} ready={false} />);
  expect(screen.getByTestId('draft').textContent).toBe('');
  view.rerender(<View uid={uid} identityReady ready />);
  expect(screen.getByTestId('draft').textContent).toBe('跨頁草稿');
});
