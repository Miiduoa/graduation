import { filterAssignmentQuery } from '../../services/assignmentQueryFilter';

const rows = [
  { title: 'HW1', groupName: 'SQL' },
  { title: '期末報告', groupName: '資料庫' },
  { title: '期末報告', groupName: '資料庫實務' },
  { title: 'HW10', groupName: 'SQL' },
  { title: '作業', groupName: '資料庫實務' },
];

test.each(['我還有哪些作業待交？', '下週五的作業有哪些？', '還沒交的作業', '未來 7 天有哪些作業？',
  '我明天已交的作業有哪些？', '已經交的作業有哪些？', '已繳的作業有哪些？',
  '我繳交的作業有哪些？', '我提交的作業有哪些？', '我交的作業有哪些？'])('keeps the full snapshot for %s', (question) => {
  expect(filterAssignmentQuery(question, rows)).toEqual({ scope: null, items: rows });
});

test('keeps receipt words inside explicitly quoted course and assignment names literal', () => {
  const named = [
    { groupName: '已交', title: '交付報告' },
    { groupName: '資料庫', title: '已交報告' },
    { groupName: '工程倫理', title: '已交報告' },
  ];
  expect(filterAssignmentQuery('「已交」的作業有哪些？', named).items).toEqual([named[0]]);
  expect(filterAssignmentQuery('資料庫的「已交報告」有哪些？', named).items).toEqual([named[1]]);
});

test('preserves every exact title match and its original course, including beyond the preview', () => {
  const fillers = Array.from({ length: 20 }, (_, i) => ({ title: `練習 ${i}`, groupName: '設計' }));
  expect(filterAssignmentQuery('「期末報告」的作業何時截止？', [...fillers, ...rows]).items).toEqual([rows[1], rows[2]]);
  expect(filterAssignmentQuery('資料庫實務的「期末報告」何時到期？', rows).items).toEqual([rows[2]]);
});

test('uses full normalized names and keeps literal digits and punctuation distinct', () => {
  expect(filterAssignmentQuery('ｓＱｌ的作業', rows).items).toEqual([rows[0], rows[3]]);
  expect(filterAssignmentQuery('HW10什麼時候截止？', rows).items).toEqual([rows[3]]);
  expect(filterAssignmentQuery('「.*」的作業', rows).items).toEqual([]);
  expect(filterAssignmentQuery('「作業」何時截止？', rows).items).toEqual([rows[4]]);
});

test('does not substitute a shorter course or unrelated assignments for a missing one', () => {
  expect(filterAssignmentQuery('請問資料庫管理的作業', rows)).toEqual({ scope: expect.stringContaining('資料庫管理'), items: [] });
  expect(filterAssignmentQuery('那高等數學這門課的作業呢', rows)).toEqual({ scope: '高等數學', items: [] });
  expect(filterAssignmentQuery('下週三高等數學有哪些作業？', rows)).toEqual({ scope: '高等數學', items: [] });
  expect(filterAssignmentQuery('資料庫有「從未同步」這份作業嗎？', rows).items).toEqual([]);
});

test('matches related course names individually only when requested', () => {
  expect(filterAssignmentQuery('下週資料庫實務的作業', rows).items).toEqual([rows[2], rows[4]]);
  expect(filterAssignmentQuery('資料庫與資料庫實務的作業', rows).items).toEqual([rows[1], rows[2], rows[4]]);
});

test('intersects a course shorthand with a shared title and keeps both course alternatives', () => {
  const reports = [
    { groupName: '資料庫設計', title: '期中報告' },
    { groupName: '資料庫管理', title: '期中報告' },
    { groupName: '工程倫理', title: '期中報告' },
    { groupName: '資料庫設計', title: '期末報告' },
  ];
  expect(filterAssignmentQuery('資料庫的期中報告什麼時候交？', reports).items).toEqual(reports.slice(0, 2));
  expect(filterAssignmentQuery('不存在的期中報告什麼時候交？', reports).items).toEqual([]);
  expect(filterAssignmentQuery('資料庫的測試報告什麼時候交？', reports).items).toEqual([]);
});

test('explicit deadline subjects cannot widen an unknown title to the full snapshot', () => {
  expect(filterAssignmentQuery('量子力學心得報告什麼時候交？', rows)).toEqual({ scope: '量子力學心得報告', items: [] });
  expect(filterAssignmentQuery('我的作業什麼時候交？', rows)).toEqual({ scope: null, items: rows });
  expect(filterAssignmentQuery('有哪些作業？', rows)).toEqual({ scope: null, items: rows });
  const english = [{ title: '閱讀心得', groupName: '英語' }, { title: '英語', groupName: '文化' }];
  expect(filterAssignmentQuery('英語的作業有哪些？', english).items).toEqual([english[0]]);
  const named = [{ title: '星星的孩子', groupName: '文學' }];
  expect(filterAssignmentQuery('星星的孩子什麼時候交？', named).items).toEqual(named);
});
