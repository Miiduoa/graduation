import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import {
  NuniDraftProvider,
  NuniDraftScopeStore,
  useNuniDraftState,
} from '../state/nuniDrafts';

it('retains a route draft and its exact retry intent without accepting callbacks from a closed editor', () => {
  const store = new NuniDraftScopeStore();
  const cache = store.forAccount('account-a').cache;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NuniDraftProvider cache={cache}>{children}</NuniDraftProvider>
  );
  const useEditor = () => ({
    body: useNuniDraftState('course:assignment:body', ''),
    intent: useNuniDraftState<{ key: string; body: string } | null>('course:assignment:intent', null),
  });
  const first = renderHook(useEditor, { wrapper });
  const staleBody = first.result.current.body[1];
  const staleIntent = first.result.current.intent[1];
  act(() => {
    staleBody('尚未完成的內容');
    staleIntent({ key: 'same-request', body: '原本送出的內容' });
  });
  first.unmount();
  const reopened = renderHook(useEditor, { wrapper });
  expect(reopened.result.current.body[0]).toBe('尚未完成的內容');
  expect(reopened.result.current.intent[0]).toEqual({ key: 'same-request', body: '原本送出的內容' });
  act(() => {
    reopened.result.current.body[1]('重新開啟後繼續編輯');
    staleBody('舊畫面晚到的內容');
    staleIntent(null);
  });
  expect(cache.get('course:assignment:body')).toBe('重新開啟後繼續編輯');
  expect(cache.get('course:assignment:intent')).toEqual({ key: 'same-request', body: '原本送出的內容' });
});

it('revokes old account caches and never revives them after returning to that account', () => {
  const store = new NuniDraftScopeStore();
  const first = store.forAccount('account-a');
  first.cache.set('body', '帳號 A 的內容');
  const other = store.forAccount('account-b');
  expect(other.cache.has('body')).toBe(false);
  first.cache.set('body', '前帳號延遲回覆');
  expect(first.cache.size).toBe(0);
  expect([...first.cache]).toEqual([]);
  const returned = store.forAccount('account-a');
  expect(returned.revision).toBeGreaterThan(first.revision);
  expect(returned.cache).not.toBe(first.cache);
  expect(returned.cache.has('body')).toBe(false);
});

it('blocks expired reads and writes without a React render, and rejects a revoked setter immediately', () => {
  let now = 1;
  let expiresAt = 10;
  const store = new NuniDraftScopeStore(() => now < expiresAt);
  const first = store.forAccount('account-a');
  const view = renderHook(() => useNuniDraftState('body', ''), {
    wrapper: ({ children }) => <NuniDraftProvider cache={first.cache}>{children}</NuniDraftProvider>,
  });
  const setter = view.result.current[1];
  act(() => setter('期限內的草稿'));
  now = 10;
  expect(first.cache.get('body')).toBeUndefined();
  act(() => setter('登入逾時後的輸入'));
  expect(first.cache.size).toBe(0);
  expiresAt = 20;
  const renewed = store.forAccount('account-a');
  expect(renewed.cache).not.toBe(first.cache);
  expect(renewed.cache.has('body')).toBe(false);
  first.cache.set('body', '舊範圍不能復活');
  expect(first.cache.size).toBe(0);
  renewed.cache.set('body', '重新登入的內容');
  store.clear();
  // No render/unmount has occurred since the scope was revoked.
  act(() => setter('清除後的晚到輸入'));
  expect(renewed.cache.get('body')).toBeUndefined();
  expect(first.cache.size).toBe(0);
});

it('rebinds the rendered value when an activity key changes and rejects its captured old setter', () => {
  const cache = new Map<string, unknown>([['assignment-b', '另一份作業的草稿']]);
  const view = renderHook(({ draftKey }) => useNuniDraftState(draftKey, ''), {
    initialProps: { draftKey: 'assignment-a' },
    wrapper: ({ children }) => <NuniDraftProvider cache={cache}>{children}</NuniDraftProvider>,
  });
  const oldSetter = view.result.current[1];
  act(() => oldSetter('第一份作業的草稿'));
  view.rerender({ draftKey: 'assignment-b' });
  expect(view.result.current[0]).toBe('另一份作業的草稿');
  act(() => {
    view.result.current[1]((body) => body + '，已續寫');
    oldSetter('第一份作業晚到的內容');
  });
  expect(view.result.current[0]).toBe('另一份作業的草稿，已續寫');
  expect(cache.get('assignment-a')).toBe('第一份作業的草稿');
  expect(cache.get('assignment-b')).toBe('另一份作業的草稿，已續寫');
});
