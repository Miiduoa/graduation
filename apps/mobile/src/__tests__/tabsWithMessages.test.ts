import { getTabsForRole } from '../services/permissions';
import { MESSAGE_TAB, tabsWithMessages } from '../app/tabsWithMessages';

describe('tabsWithMessages', () => {
  it('inserts 訊息 before 我的 and keeps other tabs', () => {
    const tabs = [
      { key: 'Today', label: '今天' },
      { key: '學習', label: '課務' },
      { key: '校園', label: '生活' },
      { key: '我的', label: '我' },
    ];
    expect(tabsWithMessages(tabs).map((tab) => tab.key)).toEqual([
      'Today',
      '學習',
      '校園',
      '訊息',
      '我的',
    ]);
  });

  it('does not duplicate 訊息 when already present', () => {
    const tabs = [
      { key: 'Today', label: '今天' },
      { key: '訊息', label: '訊息' },
      { key: '我的', label: '我' },
    ];
    expect(tabsWithMessages(tabs).map((tab) => tab.key)).toEqual(['Today', '訊息', '我的']);
  });
});

test('共同主導覽使用一致名稱，同時保留五個既有 route keys 與店家工作入口', () => {
  const student = tabsWithMessages(getTabsForRole('student'));
  expect(student.map((tab) => tab.label)).toEqual(['今天', '課務', '生活', '交流', '我的']);
  expect(student.map((tab) => tab.key)).toEqual(['Today', '學習', '校園', '訊息', '我的']);
  expect(MESSAGE_TAB.key).toBe('訊息');
  const merchant = tabsWithMessages(getTabsForRole('vendor'));
  expect(merchant.find((tab) => tab.key === '學習')?.label).toBe('店家');
});

test.each(['student', 'teacher', 'staff', 'vendor'] as const)(
  '%s 仍沿用既有路由，角色工作首頁不會被交流入口取代',
  (role) => {
    const tabs = tabsWithMessages(getTabsForRole(role));
    expect(tabs.map((tab) => tab.key)).toEqual(['Today', '學習', '校園', '訊息', '我的']);
    expect(tabs.map((tab) => tab.label)).toEqual([
      '今天',
      role === 'vendor' ? '店家' : '課務',
      '生活',
      '交流',
      '我的',
    ]);
  },
);