import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { getDocsFromServer, where } from 'firebase/firestore';
import { AccessibleRouteScreen } from '../screens/AccessibleRouteScreen';
import { safeNavigate } from '../utils/safeNavigate';

let mockSchool = { id: 'school-a' };
let mockUser = { uid: 'user-a' };
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../firebase', () => ({ getDb: () => 'db', isFirebaseMockMode: () => false }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...args) => args.slice(1).join('/')),
  query: jest.fn((...args) => args),
  where: jest.fn((...args) => args),
  getDocsFromServer: jest.fn(),
}));
const place = {
  name: '學校發布的圖書館',
  category: 'library',
  lat: 24.2,
  lng: 120.5,
  facilities: ['東側電梯目前停用', '入口坡道', '阅覽室'],
  floor: 8,
};
function snapshot(items: Array<Record<string, unknown>>) {
  return {
    empty: items.length === 0,
    docs: items.map((data, index) => ({ id: `place-${index}`, data: () => data })),
  } as Awaited<ReturnType<typeof getDocsFromServer>>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { id: 'school-a' };
  mockUser = { uid: 'user-a' };
  jest.mocked(getDocsFromServer).mockResolvedValue(snapshot([place]));
});

test('shows only source-provided facility text and never invents a route or facility floor', async () => {
  const navigation = { goBack: jest.fn(), setOptions: jest.fn() };
  const view = render(<AccessibleRouteScreen navigation={navigation} />);
  await view.findByText('東側電梯目前停用');
  expect(getDocsFromServer).toHaveBeenCalledWith('schools/school-a/pois');
  expect(view.getByText('入口坡道')).toBeTruthy();
  expect(view.queryByText('阅覽室')).toBeNull();
  expect(
    view.queryByText(/100\s*(公尺|m)|已到達|最佳路線|輪椅適用|開始導航|1F|8 樓|常用無障礙路線/),
  ).toBeNull();
  expect(navigation.setOptions).toHaveBeenCalledWith({ headerShown: false });
  fireEvent.press(view.getByText('在地圖查看地點'));
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'MapV2', { focusPoiId: 'place-0' });
});

test('missing or untyped facilities cannot become a default elevator on the first floor', async () => {
  jest.mocked(getDocsFromServer).mockResolvedValue(
    snapshot([
      { ...place, facilities: ['會議室', '飲水機'] },
      { ...place, accessible: true, facilities: [{ name: '未提供分類的設施' }, null, 3] },
    ]),
  );
  const view = render(<AccessibleRouteScreen />);
  await view.findByText('尚未提供相關設施資訊');
  expect(view.queryByText('學校發布的圖書館')).toBeNull();
  expect(view.queryByText('電梯')).toBeNull();
  expect(view.queryByText(/1F|未提供分類的設施/)).toBeNull();
  expect(view.getByText(/這不表示校園沒有這些設施/)).toBeTruthy();
});

test('canonical read errors stay errors instead of falling back or becoming an empty result', async () => {
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  const view = render(<AccessibleRouteScreen />);
  await view.findByText('目前無法讀取設施資料');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
  expect(view.queryByText('尚未提供相關設施資訊')).toBeNull();
  fireEvent.press(view.getByText('重新讀取設施'));
  await view.findByText('東側電梯目前停用');
  expect(view.queryByText('目前無法讀取設施資料')).toBeNull();
});

test('a confirmed empty canonical collection uses only the current school migration data', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot([]))
    .mockResolvedValueOnce(snapshot([place]));
  const view = render(<AccessibleRouteScreen />);
  await view.findByText('東側電梯目前停用');
  expect(where).toHaveBeenCalledWith('schoolId', '==', 'school-a');
  expect(getDocsFromServer).toHaveBeenNthCalledWith(2, ['pois', ['schoolId', '==', 'school-a']]);
});

test('a conflicting school record fails closed without exposing its facility text', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot([{ ...place, schoolId: 'other-school' }]));
  const view = render(<AccessibleRouteScreen />);
  await view.findByText('目前無法讀取設施資料');
  expect(view.queryByText('東側電梯目前停用')).toBeNull();
});

test('search and type filters retain recorded wording and can be cleared', async () => {
  const view = render(<AccessibleRouteScreen />);
  await view.findByText('入口坡道');
  fireEvent.press(view.getByText('坡道'));
  expect(view.queryByText('東側電梯目前停用')).toBeNull();
  fireEvent.changeText(view.getByLabelText('搜尋無障礙設施'), '找不到的目的地');
  expect(view.getByText('找不到符合的設施')).toBeTruthy();
  expect(view.queryByText('在地圖查看地點')).toBeNull();
  fireEvent.press(view.getByText('清除搜尋與篩選'));
  expect(view.getByText('東側電梯目前停用')).toBeTruthy();
});

test.each(['school', 'account'])(
  'changing %s clears search and excludes a pending old response',
  async (change) => {
    const old = deferred<Awaited<ReturnType<typeof getDocsFromServer>>>();
    const next = deferred<Awaited<ReturnType<typeof getDocsFromServer>>>();
    jest
      .mocked(getDocsFromServer)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const view = render(
      <AccessibleRouteScreen route={{ params: { destination: '先前的目的地' } }} />,
    );
    if (change === 'school') mockSchool = { id: 'school-b' };
    else mockUser = { uid: 'user-b' };
    view.rerender(<AccessibleRouteScreen route={{ params: { destination: '先前的目的地' } }} />);
    await act(async () => old.resolve(snapshot([place])));
    expect(view.queryByText('東側電梯目前停用')).toBeNull();
    await act(async () =>
      next.resolve(snapshot([{ ...place, name: '新學校地點', facilities: ['新地點入口坡道'] }])),
    );
    expect(view.getByText('新地點入口坡道')).toBeTruthy();
    expect(view.getByLabelText('搜尋無障礙設施').props.value).toBe('');
    expect(view.queryByText('先前的目的地')).toBeNull();
  },
);

test('a school switch masks already-rendered facilities before the next request completes', async () => {
  const view = render(<AccessibleRouteScreen />);
  await view.findByText('東側電梯目前停用');
  const next = deferred<Awaited<ReturnType<typeof getDocsFromServer>>>();
  jest.mocked(getDocsFromServer).mockReturnValueOnce(next.promise);
  mockSchool = { id: 'school-b' };
  view.rerender(<AccessibleRouteScreen />);
  expect(view.queryByText('東側電梯目前停用')).toBeNull();
  expect(view.queryByText('在地圖查看地點')).toBeNull();
  await act(async () => next.resolve(snapshot([{ ...place, facilities: [] }])));
  expect(view.getByText('尚未提供相關設施資訊')).toBeTruthy();
});
