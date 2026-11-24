import React from 'react';
import { ScrollView } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { CreditAuditInputScreen } from '../screens/CreditAuditInputScreen';
import { MenuSubscriptionScreen } from '../screens/MenuSubscriptionScreen';
import { WidgetPreviewScreen } from '../screens/WidgetPreviewScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'student' } }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../hooks/useDataSource', () => {
  const data = { listMenus: async () => [] };
  return { useDataSource: () => data };
});
jest.mock('../features/academics', () => ({
  getCreditAuditStorageKey: () => 'test-credits',
  getCreditChecklistStorageKey: () => 'test-checklist',
  loadCreditAuditSavedCourses: async () => [],
  loadCreditChecklistStatus: async () => ({}),
}));
jest.mock('../services/analytics', () => ({ analytics: { logScreenView: jest.fn() } }));
jest.mock('../services/notifications', () => ({}));
jest.mock('../services/release', () => ({ isFeatureEnabled: () => true }));
jest.mock('../widgets/NextClassLiveActivitySetting', () => ({
  NextClassLiveActivitySetting: () => null,
}));

beforeEach(() => jest.clearAllMocks());

test('credit audit switches views and keeps the course draft when returning from the saved list', async () => {
  const view = render(<CreditAuditInputScreen />);
  const name = await view.findByPlaceholderText('例如：資料庫系統');
  const panel = view.UNSAFE_getAllByType(ScrollView).find((scroll) => !scroll.props.horizontal)!;
  const scrollTo = jest.spyOn(panel.instance, 'scrollTo');
  fireEvent.scroll(panel, { nativeEvent: { contentOffset: { y: 450 } } });
  fireEvent.changeText(name, '網路程式設計');
  fireEvent.press(view.getByRole('tab', { name: '新增課程' }));
  expect(scrollTo).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('tab', { name: '修課概覽' }));
  expect(view.getByText('個人修課總覽')).toBeVisible();
  fireEvent.press(view.getByRole('tab', { name: '匯入/匯出' }));
  expect(view.getByText('匯入課程')).toBeVisible();
  fireEvent.press(view.getByRole('tab', { name: '已儲存' }));
  fireEvent.press(view.getByRole('button', { name: '新增第一門課程' }));
  expect(view.getByRole('tab', { name: '新增課程' })).toHaveAccessibilityState({ selected: true });
  expect(view.getByDisplayValue('網路程式設計')).toBeVisible();
  expect(scrollTo.mock.calls).toEqual(Array(4).fill([{ y: 0, animated: false }]));
});

test('menu subscriptions can move from the empty state through settings and back to the list', async () => {
  const view = render(<MenuSubscriptionScreen />);
  const add = await view.findByRole('button', { name: '新增訂閱' });
  const scrollTo = jest.spyOn(view.UNSAFE_getByType(ScrollView).instance, 'scrollTo');
  fireEvent.press(add);
  expect(view.getByRole('tab', { name: '新增訂閱' })).toHaveAccessibilityState({ selected: true });
  expect(view.getByText('選擇餐廳')).toBeVisible();
  fireEvent.press(view.getByRole('tab', { name: '設定' }));
  expect(view.getByText('通知設定')).toBeVisible();
  fireEvent.press(view.getByRole('tab', { name: '我的訂閱' }));
  expect(view.getByRole('button', { name: '新增訂閱' })).toBeVisible();
  expect(scrollTo.mock.calls).toEqual(Array(3).fill([{ y: 0, animated: false }]));
});

test('widget preview and instructions both open from the shared control', () => {
  const view = render(<WidgetPreviewScreen />);
  const scrollTo = jest.spyOn(view.UNSAFE_getByType(ScrollView).instance, 'scrollTo');
  fireEvent.press(view.getByRole('tab', { name: '設定說明' }));
  expect(view.getByText('如何新增小工具？')).toBeVisible();
  fireEvent.press(view.getByRole('tab', { name: '預覽' }));
  expect(view.getByText('小工具尺寸')).toBeVisible();
  expect(scrollTo.mock.calls).toEqual(Array(2).fill([{ y: 0, animated: false }]));
});
