import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MapClient from './MapClient';
import { loadMapFavorites, loadMapLocations, setMapFavorite } from './mapService';
import * as deviceFavorites from './deviceMapFavorites';

const ACCOUNT_A = 'pa_11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = 'pa_22222222-2222-4222-8222-222222222222';
const state = vi.hoisted(() => ({
  school: { user: null as { uid: string } | null, loading: false, error: null as string | null },
  platform: {
    session: null as { platformAccountId: string; context: string } | null,
    loading: false,
    error: '',
    pendingLogout: false,
  },
}));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => state.school }));
vi.mock('@/features/nuni/Session', () => ({ useOptionalNuniSession: () => state.platform }));
vi.mock('./mapService', async (original) => ({
  ...(await original<typeof import('./mapService')>()),
  loadMapLocations: vi.fn(),
  loadMapFavorites: vi.fn(),
  setMapFavorite: vi.fn(),
}));
vi.mock('./MapCanvas', () => ({ default: () => <div aria-label="校園地圖" /> }));

const places = [
  { id: 'library', name: '蓋夏圖書館', description: '館藏查詢', category: '圖書館', lat: 24.2275, lng: 120.5635 },
  { id: 'gate', name: '正門', description: '', category: '交通', lat: 24.22495, lng: 120.56535 },
];

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Object.assign(state.school, { user: null, loading: false, error: null });
  Object.assign(state.platform, {
    session: { platformAccountId: ACCOUNT_A, context: 'context-a' },
    loading: false,
    error: '',
    pendingLogout: false,
  });
  vi.mocked(loadMapLocations).mockResolvedValue(places);
  vi.mocked(loadMapFavorites).mockResolvedValue([]);
  vi.mocked(setMapFavorite).mockResolvedValue(undefined);
  window.history.replaceState({}, '', '/map?schoolId=pu');
});

afterEach(() => vi.restoreAllMocks());

async function favoriteButton(saved = false) {
  await waitFor(() => expect(screen.queryByText(/正在同步校方地點資料/)).toBeNull());
  const button = await screen.findByRole('button', { name: `${saved ? '取消收藏' : '收藏'}蓋夏圖書館` });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  return button;
}

it.each(['unavailable', 'loading'])('saves and removes Google-only device favorites when school auth is %s', async (schoolState) => {
  state.school.loading = schoolState === 'loading';
  state.school.error = schoolState === 'unavailable' ? 'school unavailable' : null;
  render(<MapClient school="pu" />);
  expect(screen.getByText(/換裝置不會自動同步/)).toBeTruthy();
  fireEvent.click(await favoriteButton());
  await favoriteButton(true);
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_A, 'pu')).toEqual(['library']);
  fireEvent.click(screen.getByRole('button', { name: '只看收藏' }));
  expect(screen.queryByRole('button', { name: '查看正門' })).toBeNull();
  fireEvent.click(await favoriteButton(true));
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看蓋夏圖書館' })).toBeNull());
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_A, 'pu')).toEqual([]);
  expect(loadMapFavorites).not.toHaveBeenCalled();
  expect(setMapFavorite).not.toHaveBeenCalled();
});

it('restores device favorites after reopening and separates Google accounts and campuses', async () => {
  await deviceFavorites.setDeviceMapFavorite(ACCOUNT_A, 'pu', 'library', true, () => true);
  const first = render(<MapClient school="pu" />);
  await favoriteButton(true);
  first.unmount();
  const view = render(<MapClient school="pu" />);
  await favoriteButton(true);
  state.platform.session = { platformAccountId: ACCOUNT_B, context: 'context-b' };
  view.rerender(<MapClient school="pu" />);
  expect(screen.queryByRole('button', { name: '取消收藏蓋夏圖書館' })).toBeNull();
  await favoriteButton();
  state.platform.session = { platformAccountId: ACCOUNT_A, context: 'context-a-again' };
  view.rerender(<MapClient school="nthu" />);
  await favoriteButton();
  view.rerender(<MapClient school="pu" />);
  await favoriteButton(true);
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_B, 'pu')).toEqual([]);
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_A, 'nthu')).toEqual([]);
});

it.each(['logout', 'pendingLogout', 'error', 'loading'])('immediately hides Google favorites on %s', async (change) => {
  await deviceFavorites.setDeviceMapFavorite(ACCOUNT_A, 'pu', 'library', true, () => true);
  const view = render(<MapClient school="pu" />);
  await favoriteButton(true);
  if (change === 'logout') state.platform.session = null;
  if (change === 'pendingLogout') state.platform.pendingLogout = true;
  if (change === 'error') state.platform.error = 'session unavailable';
  if (change === 'loading') state.platform.loading = true;
  view.rerender(<MapClient school="pu" />);
  expect(screen.queryByRole('button', { name: '取消收藏蓋夏圖書館' })).toBeNull();
  expect(screen.queryByRole('button', { name: '清除此裝置的本校收藏' })).toBeNull();
  expect(screen.queryByRole('button', { name: '只看收藏' })).toBeNull();
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_A, 'pu')).toEqual(['library']);
});

it('keeps existing school favorites separate when both identities are signed in', async () => {
  state.school.user = { uid: 'school-account' };
  vi.mocked(loadMapFavorites).mockResolvedValue(['gate']);
  await deviceFavorites.setDeviceMapFavorite(ACCOUNT_A, 'pu', 'library', true, () => true);
  render(<MapClient school="pu" />);
  await favoriteButton();
  expect(screen.getByRole('button', { name: '取消收藏正門' })).toBeTruthy();
  expect(screen.getByText('目前使用學校帳號的雲端收藏。')).toBeTruthy();
  expect(screen.queryByText(/換裝置不會自動同步/)).toBeNull();
  fireEvent.click(await favoriteButton());
  await waitFor(() => expect(setMapFavorite).toHaveBeenCalledWith('school-account', 'pu', places[0], true, expect.any(Function)));
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_A, 'pu')).toEqual(['library']);
});

it('does not report a blocked browser write as saved and can retry after storage recovers', async () => {
  render(<MapClient school="pu" />);
  const button = await favoriteButton();
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('storage blocked', 'QuotaExceededError');
  });
  fireEvent.click(button);
  expect(await screen.findByText('無法確認收藏結果，請重新讀取收藏後再試。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '取消收藏蓋夏圖書館' })).toBeNull();
  expect(button.hasAttribute('disabled')).toBe(true);
  write.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取收藏' }));
  fireEvent.click(await favoriteButton());
  await favoriteButton(true);
});

it('confirms a scoped clear and leaves other accounts and campuses intact', async () => {
  await deviceFavorites.setDeviceMapFavorite(ACCOUNT_A, 'pu', 'library', true, () => true);
  await deviceFavorites.setDeviceMapFavorite(ACCOUNT_A, 'nthu', 'gate', true, () => true);
  await deviceFavorites.setDeviceMapFavorite(ACCOUNT_B, 'pu', 'gate', true, () => true);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<MapClient school="pu" />);
  await favoriteButton(true);
  fireEvent.click(screen.getByRole('button', { name: '清除此裝置的本校收藏' }));
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_A, 'pu')).toEqual(['library']);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '清除此裝置的本校收藏' }));
  expect(await screen.findByText('已清除此裝置的本校地點收藏。')).toBeTruthy();
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_A, 'pu')).toEqual([]);
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_A, 'nthu')).toEqual(['gate']);
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_B, 'pu')).toEqual(['gate']);
  expect(setMapFavorite).not.toHaveBeenCalled();
});

it('reloads only its own scope after another tab changes device favorites', async () => {
  render(<MapClient school="pu" />);
  await favoriteButton();
  await deviceFavorites.setDeviceMapFavorite(ACCOUNT_A, 'pu', 'library', true, () => true);
  const prefix = deviceFavorites.deviceMapFavoritesKey(ACCOUNT_A, 'pu');
  const key = Object.keys(window.localStorage).find((value) => value.startsWith(prefix))!;
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key })));
  await favoriteButton(true);
  fireEvent.click(screen.getByRole('button', { name: '只看收藏' }));
  await deviceFavorites.clearDeviceMapFavorites(ACCOUNT_A, 'pu', () => true);
  await act(async () => window.dispatchEvent(new StorageEvent('storage', { key })));
  expect(screen.queryByRole('button', { name: '查看蓋夏圖書館' })).toBeNull();
  expect(screen.queryByRole('button', { name: '查看正門' })).toBeNull();
});

it('invalidates an in-flight write when Google accounts change without applying its result', async () => {
  let resolve!: (ids: string[]) => void;
  const operation = new Promise<string[]>((done) => { resolve = done; });
  const write = vi.spyOn(deviceFavorites, 'setDeviceMapFavorite').mockReturnValueOnce(operation);
  const view = render(<MapClient school="pu" />);
  fireEvent.click(await favoriteButton());
  const current = write.mock.calls[0][4];
  expect(current()).toBe(true);
  state.platform.session = { platformAccountId: ACCOUNT_B, context: 'context-b' };
  view.rerender(<MapClient school="pu" />);
  expect(current()).toBe(false);
  await act(async () => resolve(['library']));
  await favoriteButton();
  expect(screen.queryByText('已收藏「蓋夏圖書館」')).toBeNull();
  expect(deviceFavorites.readDeviceMapFavorites(ACCOUNT_B, 'pu')).toEqual([]);
});

it('requires an explicit clear to recover corrupt local data', async () => {
  const key = `${deviceFavorites.deviceMapFavoritesKey(ACCOUNT_A, 'pu')}corrupt`;
  window.localStorage.setItem(key, '{');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<MapClient school="pu" />);
  expect(await screen.findByText('收藏狀態目前無法確認。')).toBeTruthy();
  expect(window.localStorage.getItem(key)).toBe('{');
  fireEvent.click(screen.getByRole('button', { name: '清除此裝置的本校收藏' }));
  expect(await screen.findByText('已清除此裝置的本校地點收藏。')).toBeTruthy();
  await favoriteButton();
});
