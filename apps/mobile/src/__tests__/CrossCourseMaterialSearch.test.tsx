import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NuniError, type NuniMaterial, type NuniWorkspace } from '@campus/shared/src/nuni';
import { CrossCourseMaterialSearch } from '../screens/nuni/CrossCourseMaterialSearch';
import { readSearchRound, startMaterialSearch } from '../screens/nuni/crossCourseMaterials';

jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
const courses: NuniWorkspace[] = ['甲', '乙', '丙'].map((id) => ({
  id,
  title: `${id}課`,
  state: 'active',
  memberRole: 'student',
}));
const material = (id: string, workspaceId = '甲'): NuniMaterial => ({
  id,
  workspaceId,
  title: `複習 ${id}`,
  body: '',
  unitId: 'unit',
  unitTitle: '第一單元',
  createdByPlatformAccountId: 'teacher',
  createdAt: '2026-01-01T00:00:00Z',
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
it('reads three courses one page per explicit round with at most two concurrent reads', async () => {
  let active = 0;
  let peak = 0;
  const api = {
    list: jest.fn(async () => courses),
    materialsPage: jest.fn(async (id: string, token?: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return {
        materials: [material(`${id}-${token ?? 'first'}`, id)],
        nextCursor: token ? null : 'older',
      };
    }),
  };
  const first = await startMaterialSearch(api, () => false);
  expect(api.materialsPage).toHaveBeenCalledTimes(3);
  expect(first.every((course) => !course.complete)).toBe(true);
  expect(peak).toBe(2);
  const second = await readSearchRound(api, first, () => false);
  expect(second.every((course) => course.complete && course.items.length === 2)).toBe(true);
  expect(first.every((course) => course.items.length === 1)).toBe(true);
});
it('keeps successful courses, names failures, clears denied rows and retries', async () => {
  let fail = true;
  const api = {
    list: jest.fn(async () => courses),
    materialsPage: jest.fn(async (id: string) => {
      if (fail && id === '乙') throw new NuniError(403, 'FORBIDDEN');
      if (fail && id === '丙') throw new Error('synthetic');
      return { materials: [material(id, id)], nextCursor: null };
    }),
  };
  const view = render(<CrossCourseMaterialSearch classes={api} open={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('跨課教材關鍵字'), '複習');
  fireEvent.press(view.getByText('搜尋教材'));
  await waitFor(() => expect(view.getByText(/乙課：尚未搜完/)).toBeTruthy());
  expect(view.getByText(/丙課：尚未搜完/)).toBeTruthy();
  expect(view.getByText('目前找到 1 筆，還有課程尚未搜完。')).toBeTruthy();
  expect(view.queryByText(/這次搜尋沒有相符教材/)).toBeNull();
  fail = false;
  fireEvent.press(view.getByText('繼續搜尋／重試未完成課程'));
  await waitFor(() => expect(view.getByText('找到 3 筆教材。')).toBeTruthy());
  expect(api.materialsPage.mock.calls.filter(([id]) => id === '甲')).toHaveLength(1);
});
it('stops repeated page tokens and restarts only after another explicit round', async () => {
  const api = {
    list: async () => [courses[0]],
    materialsPage: jest.fn(async () => ({ materials: [material('one')], nextCursor: 'repeat' })),
  };
  const first = await startMaterialSearch(api, () => false);
  const second = await readSearchRound(api, first, () => false);
  expect(second[0].cycleDetected).toBe(true);
  expect(second[0].complete).toBe(false);
  expect(second[0].items).toHaveLength(1);
  expect(api.materialsPage).toHaveBeenCalledTimes(2);
  await readSearchRound(api, second, () => false);
  expect(api.materialsPage).toHaveBeenLastCalledWith('甲', undefined);
});
it('evicts previous hits when a later page denies access', async () => {
  const api = {
    list: async () => [courses[0]],
    materialsPage: jest
      .fn()
      .mockResolvedValueOnce({ materials: [material('one')], nextCursor: 'older' })
      .mockRejectedValueOnce(new NuniError(403, 'FORBIDDEN')),
  };
  const first = await startMaterialSearch(api, () => false);
  const next = await readSearchRound(api, first, () => false);
  expect(next[0].items).toEqual([]);
  expect(next[0].complete).toBe(false);
  expect(next[0].error).toContain('權限');
});
it('does not read on typing, distinguishes unfinished zero hits and opens the exact material', async () => {
  const api = {
    list: jest.fn(async () => [courses[0]]),
    materialsPage: jest
      .fn()
      .mockResolvedValueOnce({ materials: [], nextCursor: 'older' })
      .mockResolvedValueOnce({ materials: [material('target')], nextCursor: null }),
  };
  const open = jest.fn();
  const view = render(<CrossCourseMaterialSearch classes={api} open={open} />);
  fireEvent.changeText(view.getByLabelText('跨課教材關鍵字'), '複習');
  expect(api.list).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('搜尋教材'));
  await waitFor(() => expect(view.getByText('目前找到 0 筆，還有課程尚未搜完。')).toBeTruthy());
  fireEvent.press(view.getByText('繼續搜尋／重試未完成課程'));
  await waitFor(() => expect(view.getByText('複習 target')).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '複習 target，甲課，第一單元' }));
  expect(open).toHaveBeenCalledWith('甲', 'target');
});
it('discards previous account results and cancels queued courses on account replacement', async () => {
  const pending = deferred<{ materials: NuniMaterial[]; nextCursor: null }>();
  const oldApi = { list: async () => courses, materialsPage: jest.fn(() => pending.promise) };
  const newApi = { list: jest.fn(async () => []), materialsPage: jest.fn() };
  const view = render(
    <View>
      <CrossCourseMaterialSearch key="old-account" classes={oldApi} open={jest.fn()} />
    </View>,
  );
  fireEvent.changeText(view.getByLabelText('跨課教材關鍵字'), '複習');
  fireEvent.press(view.getByText('搜尋教材'));
  await waitFor(() => expect(oldApi.materialsPage).toHaveBeenCalledTimes(2));
  view.rerender(
    <View>
      <CrossCourseMaterialSearch key="new-account" classes={newApi} open={jest.fn()} />
    </View>,
  );
  await act(async () => {
    pending.resolve({ materials: [material('old-hit')], nextCursor: null });
  });
  expect(oldApi.materialsPage).toHaveBeenCalledTimes(2);
  expect(newApi.list).not.toHaveBeenCalled();
  expect(view.queryByText('複習 old-hit')).toBeNull();
  expect(view.getByLabelText('跨課教材關鍵字').props.value).toBe('');
});

it.each([401, 403, 404])('removes denied hits immediately while another course is pending and retains successful hits (%s)', async (status) => {
  const pending = deferred<{ materials: NuniMaterial[]; nextCursor: null }>();
  let round = 0;
  const api = {
    list: async () => courses,
    materialsPage: jest.fn(async (id: string) => {
      if (round && id === '甲') throw new NuniError(status, 'FORBIDDEN');
      if (round && id === '乙') return pending.promise;
      return { materials: [material(id, id)], nextCursor: id === '丙' ? null : 'older' };
    }),
  };
  const view = render(<CrossCourseMaterialSearch classes={api} open={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('跨課教材關鍵字'), '複習');
  fireEvent.press(view.getByText('搜尋教材'));
  await waitFor(() => expect(view.getByText('複習 丙')).toBeTruthy());
  round = 1;
  fireEvent.press(view.getByText('繼續搜尋／重試未完成課程'));
  await waitFor(() => expect(view.getByText(/甲課：尚未搜完/)).toBeTruthy());
  expect(view.queryByRole('button', { name: '複習 甲，甲課，第一單元' })).toBeNull();
  expect(view.getByText('複習 丙')).toBeTruthy();
  expect(view.getByText('完成課數：1／3')).toBeTruthy();
  await act(async () => pending.resolve({ materials: [], nextCursor: null }));
});

it('stops queued courses when switching to the food tab during the first batch', async () => {
  const pending = deferred<{ materials: NuniMaterial[]; nextCursor: null }>();
  const api = { list: async () => courses, materialsPage: jest.fn(() => pending.promise) };
  const view = render(<CrossCourseMaterialSearch classes={api} open={jest.fn()} active />);
  fireEvent.changeText(view.getByLabelText('跨課教材關鍵字'), '複習');
  fireEvent.press(view.getByText('搜尋教材'));
  await waitFor(() => expect(api.materialsPage).toHaveBeenCalledTimes(2));
  view.rerender(<CrossCourseMaterialSearch classes={api} open={jest.fn()} active={false} />);
  await act(async () => pending.resolve({ materials: [], nextCursor: null }));
  expect(api.materialsPage).toHaveBeenCalledTimes(2);
});

it('restores the session search after detail return and revalidates access', async () => {
  const { useCourseSearchState } = require('../screens/nuni/CrossCourseMaterialSearch');
  const api = {
    list: jest.fn(async () => [courses[0]]),
    materialsPage: jest.fn(async () => ({ materials: [material('saved')], nextCursor: null })),
  };
  function Scope() {
    const state = useCourseSearchState();
    const [detail, setDetail] = React.useState(false);
    return detail ? <View><View accessibilityRole="button" accessibilityLabel="返回" onTouchEnd={() => setDetail(false)} /></View>
      : <CrossCourseMaterialSearch state={state} classes={api} open={() => setDetail(true)} />;
  }
  const view = render(<Scope />);
  fireEvent.changeText(view.getByLabelText('跨課教材關鍵字'), '複習');
  fireEvent.press(view.getByText('搜尋教材'));
  await waitFor(() => expect(view.getByText('複習 saved')).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '複習 saved，甲課，第一單元' }));
  fireEvent(view.getByLabelText('返回'), 'touchEnd');
  await waitFor(() => expect(api.materialsPage).toHaveBeenCalledTimes(2));
  expect(view.getByLabelText('跨課教材關鍵字').props.value).toBe('複習');
  expect(view.getByText('目前搜尋：複習')).toBeTruthy();
  expect(view.getByText('複習 saved')).toBeTruthy();
  expect(api.list).toHaveBeenCalledTimes(1);
});

it('offers joining for no searchable courses and retries only the failed course', async () => {
  const join = jest.fn();
  const empty = render(<CrossCourseMaterialSearch classes={{ list: async () => [], materialsPage: jest.fn() }} open={jest.fn()} join={join} />);
  fireEvent.changeText(empty.getByLabelText('跨課教材關鍵字'), '複習');
  fireEvent.press(empty.getByText('搜尋教材'));
  await waitFor(() => expect(empty.getByText('目前沒有可搜尋的課程，請加入未封存的課程。')).toBeTruthy());
  fireEvent.press(empty.getByText('加入課程'));
  expect(join).toHaveBeenCalled();
  empty.unmount();
  let failed = true;
  const api = {
    list: async () => courses,
    materialsPage: jest.fn(async (id: string) => {
      if (failed && id !== '甲') throw new Error('temporary');
      return { materials: [material(id, id)], nextCursor: null };
    }),
  };
  const view = render(<CrossCourseMaterialSearch classes={api} open={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('跨課教材關鍵字'), '複習');
  fireEvent.press(view.getByText('搜尋教材'));
  await waitFor(() => expect(view.getByText('重試丙課')).toBeTruthy());
  failed = false;
  fireEvent.press(view.getByText('重試乙課'));
  await waitFor(() => expect(view.getByText('複習 乙')).toBeTruthy());
  expect(api.materialsPage.mock.calls.map(([id]) => id)).toEqual(['甲', '乙', '丙', '乙']);
});
