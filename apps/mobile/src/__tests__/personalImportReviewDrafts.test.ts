import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hasImportReviewDraft, readImportReviewDraft, writeImportReviewDraft,
} from '../services/personalImportDrafts';

const empty = {
  version: 1, kind: 'grades', academicYear: '', semester: '', text: ' \n',
  source: { type: 'paste' }, rows: [], selected: [], issues: [],
  editedIds: [], backupPreview: null,
};

test('只有格式完整且無內容的舊草稿可忽略，有內容或損壞的草稿仍受保護', () => {
  expect(hasImportReviewDraft(null)).toBe(false);
  expect(hasImportReviewDraft(JSON.stringify(empty))).toBe(false);
  expect(hasImportReviewDraft(JSON.stringify({ ...empty, academicYear: '115', semester: '1' }))).toBe(false);
  for (const raw of [
    '', 'broken', 'null', '{}',
    JSON.stringify({ ...empty, text: '未完成輸入' }),
    JSON.stringify({ ...empty, rows: [{ title: '待核對' }] }),
    JSON.stringify({ ...empty, issues: [{ message: '待修正' }] }),
    JSON.stringify({ ...empty, source: { type: 'file', name: '課表.csv' } }),
    JSON.stringify({ ...empty, selected: null }),
  ]) expect(hasImportReviewDraft(raw)).toBe(true);
});

test('清除草稿會依序等候舊寫入，重新進頁不會復活已完成的草稿', async () => {
  const key = 'review-draft-serialized-removal';
  const writing = writeImportReviewDraft(key, JSON.stringify({ ...empty, text: '課程' }));
  const removing = writeImportReviewDraft(key, null);
  expect(await readImportReviewDraft(key)).toBeNull();
  await Promise.all([writing, removing]);
  expect(await AsyncStorage.getItem(key)).toBeNull();
});
