import React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import {
  createDefaultCampusPreferences,
  CAMPUS_FOCUS_OPTIONS,
  CAMPUS_GOAL_OPTIONS,
  CAMPUS_PHASE_OPTIONS,
  CAMPUS_STAGE_OPTIONS,
} from '@campus/shared/src/campusPersonalization';
import { CampusPersonalization } from '../components/CampusPersonalization';
import { useCampusPersonalization } from '../state/campusPersonalization';
import {
  campusPreferencesStorageKey,
  loadCampusPreferences,
  saveCampusPreferences,
} from '../services/campusPersonalization';
import { loadPersonalImports, type PersonalImportScope } from '../services/personalImports';

let mockScope: PersonalImportScope | null = { owner: 'nuni:alice', schoolId: 'pu' };
const mockNavigate = jest.fn();
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => mockScope }));
jest.mock('../services/personalImports', () => ({
  loadPersonalImports: jest.fn(async () => ({ version: 1, records: [], batches: [] })),
  subscribePersonalImports: jest.fn(() => () => {}),
}));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: require('react').createContext({
    navigate: (...args: unknown[]) => mockNavigate(...args),
    getState: () => ({
      routeNames: ['NuniWorkspace', 'PersonalTimetable', 'PersonalCalendar', 'Map', 'BusSchedule'],
    }),
  }),
}));

const now = new Date('2026-11-13T08:00:00+08:00');
const first = { owner: 'nuni:alice', schoolId: 'pu' };
const originalGetItem = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const originalSetItem = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.mocked(AsyncStorage.getItem).mockImplementation(originalGetItem);
  jest.mocked(AsyncStorage.setItem).mockImplementation(originalSetItem);
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockScope = first;
  jest.mocked(loadPersonalImports).mockResolvedValue({ version: 1, records: [], batches: [] });
});

test('preferences persist separately for Google, school, guest and campus namespaces without role fields', async () => {
  await saveCampusPreferences(first, {
    ...createDefaultCampusPreferences(),
    stage: 'year-4',
    focus: 'life',
    configured: true,
  });
  expect((await loadCampusPreferences(first)).stage).toBe('year-4');
  for (const scope of [
    { owner: 'nuni:bob', schoolId: 'pu' },
    { owner: 'firebase:alice', schoolId: 'pu' },
    { owner: 'guest:device', schoolId: 'pu' },
    { owner: 'nuni:alice', schoolId: 'ntu' },
  ])
    expect((await loadCampusPreferences(scope)).configured).toBe(false);
  const stored = JSON.parse((await AsyncStorage.getItem(campusPreferencesStorageKey(first)))!);
  for (const key of ['role', 'isAdmin', 'permissions']) expect(stored).not.toHaveProperty(key);
  expect(campusPreferencesStorageKey({ owner: 'a:b', schoolId: 'c' })).not.toBe(
    campusPreferencesStorageKey({ owner: 'a', schoolId: 'b:c' }),
  );
});

test('unreadable and future-version preferences stay intact and are not exposed as completed setup', async () => {
  for (const raw of ['{broken', '{"version":99,"stage":"year-4"}']) {
    await AsyncStorage.setItem(campusPreferencesStorageKey(first), raw);
    await expect(loadCampusPreferences(first)).rejects.toThrow('原本的選擇仍保留');
    const hook = renderHook(() => useCampusPersonalization(first));
    await waitFor(() => expect(hook.result.current.error).toContain('無法讀取'));
    expect(hook.result.current.ready).toBe(false);
    await act(async () =>
      expect(await hook.result.current.save(createDefaultCampusPreferences())).toBe(false),
    );
    expect(await AsyncStorage.getItem(campusPreferencesStorageKey(first))).toBe(raw);
    hook.unmount();
  }
});

test('broken preferences can be explicitly reset without removing another account or other app data', async () => {
  const other = { ...first, owner: 'nuni:bob' };
  await AsyncStorage.setItem(campusPreferencesStorageKey(first), '{broken');
  await AsyncStorage.setItem('campus.other-data', 'keep-this');
  await saveCampusPreferences(other, {
    ...createDefaultCampusPreferences(),
    stage: 'year-4',
    configured: true,
  });
  const view = render(<CampusPersonalization now={now} />);
  const reset = await view.findByText('重新設定首頁偏好');
  expect(await AsyncStorage.getItem(campusPreferencesStorageKey(first))).toBe('{broken');
  fireEvent.press(reset);
  await view.findByText('讓今天更適合你');
  expect(await loadCampusPreferences(first)).toEqual(createDefaultCampusPreferences());
  expect(await AsyncStorage.getItem('campus.other-data')).toBe('keep-this');
  expect((await loadCampusPreferences(other)).stage).toBe('year-4');
  const stage = CAMPUS_STAGE_OPTIONS.find((option) => option.value === 'year-2')!;
  fireEvent.press(view.getByLabelText(`目前就讀階段：${stage.label}`));
  expect(view.getByLabelText(`目前就讀階段：${stage.label}`).props.accessibilityState.checked).toBe(
    true,
  );
  expect(view.queryByText('重新設定首頁偏好')).toBeNull();
});

test('a reset callback from the previous account is rejected after switching accounts', async () => {
  await AsyncStorage.setItem(campusPreferencesStorageKey(first), '{broken');
  const hook = renderHook(({ scope }) => useCampusPersonalization(scope), {
    initialProps: { scope: first },
  });
  await waitFor(() => expect(hook.result.current.error).toContain('無法讀取'));
  const oldReset = hook.result.current.reset;
  const other = { ...first, owner: 'nuni:bob' };
  hook.rerender({ scope: other });
  await act(async () => expect(await oldReset()).toBe(false));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  expect(await AsyncStorage.getItem(campusPreferencesStorageKey(first))).toBe('{broken');
  expect(await AsyncStorage.getItem(campusPreferencesStorageKey(other))).toBeNull();
  await act(async () => expect(await hook.result.current.reset()).toBe(false));
});

test('expired manual phases show their dates after Taipei midnight and do not remain active', async () => {
  await saveCampusPreferences(first, {
    ...createDefaultCampusPreferences(),
    configured: true,
    phaseOverride: { kind: 'finals', startDate: '2026-11-01', endDate: '2026-11-12' },
  });
  const view = render(<CampusPersonalization now={new Date('2026-11-12T16:00:00Z')} />);
  await view.findByText(
    '你設定的期末準備期間為 2026-11-01 至 2026-11-12，已結束；目前依個人行程與偏好推薦。',
  );
  expect(view.getByText('日常安排')).toBeTruthy();
});

test.each(['account', 'school', 'unresolved'] as const)(
  'a %s change hides old preferences immediately and rejects stale save callbacks',
  async (change) => {
    await saveCampusPreferences(first, {
      ...createDefaultCampusPreferences(),
      stage: 'year-4',
      configured: true,
    });
    const hook = renderHook(
      ({ scope }: { scope: PersonalImportScope | null }) => useCampusPersonalization(scope),
      { initialProps: { scope: first as PersonalImportScope | null } },
    );
    await waitFor(() => expect(hook.result.current.preferences?.stage).toBe('year-4'));
    const staleSave = hook.result.current.save;
    const next =
      change === 'account'
        ? { ...first, owner: 'nuni:bob' }
        : change === 'school'
          ? { ...first, schoolId: 'ntu' }
          : null;
    hook.rerender({ scope: next });
    expect(hook.result.current.preferences).toBeNull();
    expect(hook.result.current.events).toEqual([]);
    await act(async () =>
      expect(await staleSave({ ...createDefaultCampusPreferences(), stage: 'year-2' })).toBe(false),
    );
    if (next)
      await waitFor(() => expect(hook.result.current.preferences?.stage).toBe('unspecified'));
    expect((await loadCampusPreferences(first)).stage).toBe('year-4');
  },
);

test('a late read from the previous account cannot replace the new account preferences', async () => {
  const old = deferred<string | null>();
  jest
    .spyOn(AsyncStorage, 'getItem')
    .mockImplementation((key) =>
      key === campusPreferencesStorageKey(first) ? old.promise : originalGetItem(key),
    );
  const second = { ...first, owner: 'nuni:bob' };
  const hook = renderHook(({ scope }) => useCampusPersonalization(scope), {
    initialProps: { scope: first },
  });
  hook.rerender({ scope: second });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () =>
    old.resolve(
      JSON.stringify({ ...createDefaultCampusPreferences(), stage: 'year-4', configured: true }),
    ),
  );
  expect(hook.result.current.preferences?.stage).toBe('unspecified');
});

test('a pending save cannot claim success or change the new account after a switch', async () => {
  const hook = renderHook(({ scope }) => useCampusPersonalization(scope), {
    initialProps: { scope: first },
  });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  const write = deferred<void>();
  jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    if (key === campusPreferencesStorageKey(first)) await write.promise;
    await originalSetItem(key, value);
  });
  let saving!: Promise<boolean>;
  act(() => {
    saving = hook.result.current.save({
      ...createDefaultCampusPreferences(),
      stage: 'year-4',
      configured: true,
    });
  });
  const second = { ...first, owner: 'nuni:bob' };
  hook.rerender({ scope: second });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await act(async () => {
    write.resolve();
    expect(await saving).toBe(false);
  });
  expect(hook.result.current.preferences?.stage).toBe('unspecified');
  expect(await AsyncStorage.getItem(campusPreferencesStorageKey(second))).toBeNull();
});

test('save failure keeps the editor and chosen stage, then succeeds on retry', async () => {
  const view = render(<CampusPersonalization now={now} />);
  await view.findByText('讓今天更適合你');
  const stage = CAMPUS_STAGE_OPTIONS.find((option) => option.value === 'year-4')!;
  fireEvent.press(view.getByLabelText(`目前就讀階段：${stage.label}`));
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  fireEvent.press(view.getByText('儲存偏好'));
  await view.findByText(/這次沒有存成/);
  expect(view.getByLabelText(`目前就讀階段：${stage.label}`).props.accessibilityState.checked).toBe(
    true,
  );
  expect(view.queryByText('調整偏好')).toBeNull();
  fireEvent.press(view.getByText('儲存偏好'));
  await view.findByText('調整偏好');
  expect((await loadCampusPreferences(first)).stage).toBe('year-4');
});

test.each([true, false])(
  'a refresh started before a save cannot overwrite its result or clear its error (success=%s)',
  async (success) => {
    let foreground!: (state: string) => void;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      foreground = listener as (state: string) => void;
      return { remove: jest.fn() };
    });
    const hook = renderHook(() => useCampusPersonalization(first));
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    const late = deferred<Awaited<ReturnType<typeof loadPersonalImports>>>();
    jest.mocked(loadPersonalImports).mockReturnValueOnce(late.promise);
    await act(async () => foreground('active'));
    if (!success) jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await act(async () =>
      expect(
        await hook.result.current.save({
          ...createDefaultCampusPreferences(),
          stage: 'year-4',
          configured: true,
        }),
      ).toBe(success),
    );
    await act(async () => late.resolve({ version: 1, records: [], batches: [] }));
    if (success) {
      expect(hook.result.current.preferences?.stage).toBe('year-4');
      expect(hook.result.current.error).toBe('');
    } else {
      expect(hook.result.current.preferences?.stage).toBe('unspecified');
      expect(hook.result.current.error).toContain('這次沒有存成');
    }
  },
);

test('setup can be skipped and reopened without changing account permissions', async () => {
  const view = render(<CampusPersonalization now={now} />);
  fireEvent.press(await view.findByText('先略過'));
  await view.findByText('接下來可以做');
  expect((await loadCampusPreferences(first)).configured).toBe(true);
  fireEvent.press(view.getByText('調整偏好'));
  const focus = CAMPUS_FOCUS_OPTIONS.find((option) => option.value === 'life')!;
  fireEvent.press(view.getByLabelText(`最近想優先安排：${focus.label}`));
  fireEvent.press(view.getByText('儲存偏好'));
  await view.findByText('接下來可以做');
  expect((await loadCampusPreferences(first)).focus).toBe('life');
});

test('three goals are allowed and impossible phase dates do not become a successful save', async () => {
  const view = render(<CampusPersonalization now={now} />);
  fireEvent.press(await view.findByText('住宿、通勤與近期目標（選填）'));
  for (const option of CAMPUS_GOAL_OPTIONS.slice(0, 3))
    fireEvent.press(view.getByLabelText(option.label));
  expect(view.getByLabelText(CAMPUS_GOAL_OPTIONS[3].label).props.accessibilityState.disabled).toBe(
    true,
  );
  const phase = CAMPUS_PHASE_OPTIONS.find((option) => option.value === 'finals')!;
  fireEvent.press(view.getByLabelText(`這段時間：${phase.label}`));
  fireEvent.changeText(view.getByLabelText('階段開始日期'), '2026-02-30');
  fireEvent.changeText(view.getByLabelText('階段結束日期'), '2026-03-03');
  fireEvent.press(view.getByText('儲存偏好'));
  await view.findByText(/請填入有效的開始與結束日期/);
  expect(await AsyncStorage.getItem(campusPreferencesStorageKey(first))).toBeNull();
});

test('an events failure is visible without suppressing editable preferences', async () => {
  jest.mocked(loadPersonalImports).mockRejectedValue(new Error('corrupt calendar'));
  const view = render(<CampusPersonalization now={now} />);
  await view.findByText('讓今天更適合你');
  expect(view.getByText(/個人行程暫時讀不到/)).toBeTruthy();
  expect(view.getByText('重試讀取行程')).toBeTruthy();
});
