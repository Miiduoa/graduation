const { questionKeywords, relevantItems } = require('./assistantRelevance');

const text = (item) => item.title;

test('只剩通用字的問題代表要看清單', () => {
  expect(questionKeywords('今天有什麼公告')).toEqual([]);
  expect(questionKeywords('近期活動')).toEqual([]);
  expect(questionKeywords('我有哪些作業快截止？')).toEqual([]);
});

test('有內容的問題只留對得上的資料', () => {
  const items = [{ title: '圖書館國慶日閉館' }, { title: '宿舍週末停水' }];
  expect(relevantItems('圖書館閉館的公告', items, text)).toEqual([{ title: '圖書館國慶日閉館' }]);
  expect(relevantItems('學校說期末考取消了嗎', items, text)).toEqual([]);
  // 只對到一組（「取消」）不算相關
  expect(relevantItems('期末考取消', [{ title: '停車證申請取消' }], text)).toEqual([]);
});
