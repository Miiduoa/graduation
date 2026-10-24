import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import Constants from 'expo-constants';
import { DormitoryScreen } from '../screens/DormitoryScreen';
import { UnavailableFeatureScreen } from '../screens/UnavailableFeatureScreen';
import { useDataSource } from '../hooks/useDataSource';
import { simulateLaundryStatus, simulateLotteryStats } from '../data/puDormData';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';

let mockUid = 'demo_student';
let mockSchool = 'pu';
const mockSource = {
  getDormitoryInfo: jest.fn().mockResolvedValue(null),
  listRepairRequests: jest.fn().mockResolvedValue([]),
  listDormPackages: jest.fn().mockResolvedValue([]),
  listDormAnnouncements: jest.fn().mockResolvedValue([]),
  reserveWashingMachine: jest.fn(),
};
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: mockUid } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../hooks/useDataSource', () => ({ useDataSource: jest.fn(() => mockSource) }));
jest.mock('../services/demoStore', () => ({ submitDormRepair: jest.fn() }));
jest.mock('../services/tronClassWebUiGate', () => ({ linkingOpenWithPuTronClassGate: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../data/puDormData', () => {
  const original = jest.requireActual('../data/puDormData');
  return {
    ...original,
    simulateMyApplication: jest.fn(() => null),
    simulateLotteryStats: jest.fn(() => ({
      ...original.simulateLotteryStats(),
      currentPhase: 'applying',
    })),
    simulateLaundryStatus: jest.fn(() => [
      {
        id: 'demo-machine',
        floor: '1F',
        number: 1,
        type: 'washer',
        status: 'available',
        price: 20,
        capacity: '10kg',
        remainingMinutes: 0,
      },
    ]),
  };
});

function configure(appEnv: string, enabled = true) {
  Object.assign(Constants.expoConfig!, { extra: { appEnv, enableUniversalDevAccounts: enabled } });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'demo_student';
  mockSchool = 'pu';
  configure('production');
  jest.mocked(linkingOpenWithPuTronClassGate).mockResolvedValue(true);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each(['production', 'preview'])(
  '%s cannot mount fabricated dormitory data even with a demo UID and flag',
  (appEnv) => {
    configure(appEnv);
    const view = render(<DormitoryScreen />);
    expect(view.getByText(/宿舍包裹查詢與線上報修尚未開放/)).toBeTruthy();
    expect(view.queryByText('宿舍功能示範')).toBeNull();
    expect(view.queryByText('冷氣電費')).toBeNull();
    expect(useDataSource).not.toHaveBeenCalled();
    expect(simulateLotteryStats).not.toHaveBeenCalled();
    expect(simulateLaundryStatus).not.toHaveBeenCalled();
  },
);

test.each([
  ['real-user', true],
  ['demo_student', false],
])(
  'development requires both explicit demo consent and a demo identity (%s, %s)',
  (uid, enabled) => {
    configure('development', enabled);
    mockUid = uid;
    const view = render(<DormitoryScreen />);
    expect(view.queryByText('宿舍功能示範')).toBeNull();
    expect(useDataSource).not.toHaveBeenCalled();
  },
);

test('the actual release placeholder opens the existing official housing URL and reports opening failure', async () => {
  const view = render(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  const action = view.getByRole('button', { name: '前往靜宜住宿服務組官網' });
  await act(async () => fireEvent.press(action));
  expect(Linking.openURL).toHaveBeenCalledWith('https://osadorm.pu.edu.tw/');
  expect(Alert.alert).not.toHaveBeenCalled();
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('offline'));
  await act(async () => fireEvent.press(action));
  expect(Alert.alert).toHaveBeenCalledWith('無法開啟官網', '請確認網路連線後再試一次。');
  await act(async () => fireEvent.press(action));
  expect(Linking.openURL).toHaveBeenCalledTimes(3);
  expect(view.getByRole('button', { name: '查看校方公告' })).toBeTruthy();
});

test('another school does not inherit the Providence housing office link', () => {
  mockSchool = 'nchu';
  const view = render(<UnavailableFeatureScreen route={{ name: 'Dormitory' }} />);
  expect(view.queryByText('前往靜宜住宿服務組官網')).toBeNull();
  expect(view.getByRole('button', { name: '查看校方公告' })).toBeTruthy();
});

test('demo lottery submission says it stays on this screen; changing accounts discards the demo', async () => {
  configure('development');
  const view = render(<DormitoryScreen />);
  await waitFor(() => expect(mockSource.getDormitoryInfo).toHaveBeenCalled());
  expect(view.getByText('宿舍功能示範')).toBeTruthy();
  fireEvent.press(view.getByText('抽籤'));
  fireEvent.press(view.getByText('送出申請'));
  const confirmation = jest.mocked(Alert.alert).mock.calls.at(-1)!;
  expect(confirmation[0]).toBe('示範抽籤申請');
  expect(confirmation[1]).toContain('不會送交校方');
  act(() => confirmation[2]!.find((button) => button.text === '送出申請')!.onPress!());
  expect(Alert.alert).toHaveBeenLastCalledWith(
    '示範志願已儲存',
    '未送交校方；正式抽籤請依住宿服務組公告辦理。',
  );
  mockUid = 'real-user';
  view.rerender(<DormitoryScreen />);
  expect(view.queryByText('宿舍功能示範')).toBeNull();
  expect(view.queryByText('已提交')).toBeNull();
});

test('a simulated laundry machine never creates a server reservation', async () => {
  configure('development');
  const view = render(<DormitoryScreen />);
  await waitFor(() => expect(mockSource.getDormitoryInfo).toHaveBeenCalled());
  fireEvent.press(view.getAllByText('洗衣')[0]);
  fireEvent.press(view.getByText('1 號洗衣機'));
  const confirmation = jest.mocked(Alert.alert).mock.calls.at(-1)!;
  expect(confirmation[0]).toBe('示範洗衣預約');
  act(() => confirmation[2]!.find((button) => button.text === '試用預約')!.onPress!());
  expect(mockSource.reserveWashingMachine).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith('示範預約完成', '未預約現場設備，請至洗衣間確認。');
  expect(view.getByText('已預約')).toBeTruthy();
});
