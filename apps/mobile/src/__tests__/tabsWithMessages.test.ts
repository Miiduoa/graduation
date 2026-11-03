import { tabsWithMessages } from '../app/tabsWithMessages';

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
