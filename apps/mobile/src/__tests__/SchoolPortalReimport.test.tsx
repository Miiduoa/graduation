import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { PersonalImportRow, PersonalImportRecord } from '@campus/shared';
import { previewPortalReimport, commitPortalReimport, undoPortalReimport } from '../services/portalReimport';
import { personalImportStorageKey, loadPersonalImports, editPersonalImport } from '../services/personalImports';
import { SchoolPortalReimport } from '../components/SchoolPortalReimport';
import { SchoolPortalImportEntry } from '../components/SchoolPortalImport';

const scope = { owner: 'nuni:one', schoolId: 'pu' };
const row = (patch: Partial<PersonalImportRow> = {}): PersonalImportRow => ({ id: 'new', kind: 'grades', schoolId: 'pu', academicYear: '115', semester: '1', title: '統計學', courseCode: 'S101', className: '三B', grade: '90', credits: 3, source: { type: 'paste', line: 2, rawText: 'captured' }, ...patch });
const record = (patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({ ...row({ id: 'old', grade: '80' }), batchId: 'old-batch', importedAt: '2026-10-27T00:00:00Z', ...patch });
const key = personalImportStorageKey(scope);
const mockInject = jest.fn(), mockSaved = jest.fn(), mockCancel = jest.fn();
let mockSerial = 0;
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu', name: '靜宜大學' } }) }));
jest.mock('../state/personalImportScope', () => ({ usePersonalImportScope: () => ({ owner: 'nuni:one', schoolId: 'pu' }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => ({ mode: 'light' }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `request_${++mockSerial}_12345678` }));
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react'), { View } = jest.requireActual('react-native');
  return { WebView: React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject, goBack: jest.fn() }));
    return React.createElement(View, props);
  }) };
});
jest.mock('../ui/components', () => {
  const React = jest.requireActual('react'), { Pressable, Text } = jest.requireActual('react-native');
  return { Button: ({ text, disabled, onPress }: { text: string; disabled?: boolean; onPress(): void }) =>
    React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: text, accessibilityState: { disabled: !!disabled }, disabled, onPress }, React.createElement(Text, null, text)) };
});
async function seed(records = [record()]) {
  await AsyncStorage.setItem(key, JSON.stringify({ version: 1, records, batches: [{ id: 'old-batch', createdAt: '2026-10-27T00:00:00Z', count: records.length }] }));
  jest.mocked(AsyncStorage.setItem).mockClear();
}
const content = async () => { const ledger = await loadPersonalImports(scope); return { records: ledger.records, batches: ledger.batches }; };
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks(); mockSerial = 0;
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  await seed();
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

test('comparison reads existing records without writing', async () => {
  const result = await previewPortalReimport(scope, [row()]);
  expect(result.plan.entries[0].status).toBe('change');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('80');
});
test('commits mixed additions and replacements once, preserving identity and personal links', async () => {
  await seed([record({ linkedCourseId: 'personal-link' })]);
  const preview = await previewPortalReimport(scope, [row({ linkedCourseId: 'wrong-link' }), row({ id: 'new-other', courseCode: 'S102', title: '英文' })]);
  const receipt = await commitPortalReimport(scope, preview, { new: 'replace' });
  expect(receipt).toMatchObject({ added: 1, updated: 1, kept: 0 });
  const ledger = await loadPersonalImports(scope);
  expect(ledger.records).toHaveLength(2);
  expect(ledger.records.find((item) => item.id === 'old')).toMatchObject({ grade: '90', linkedCourseId: 'personal-link', importedAt: '2026-10-27T00:00:00Z' });
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});
test('rollback restores old values and removes only this untouched transaction additions', async () => {
  const before = await content();
  const preview = await previewPortalReimport(scope, [row(), row({ id: 'new-other', courseCode: 'S102', title: '英文' })]);
  const receipt = await commitPortalReimport(scope, preview, { new: 'replace' });
  expect(await undoPortalReimport(scope, receipt)).toEqual({ removed: 1, restored: 1 });
  expect(await content()).toEqual(before);
});
test('all-keep confirms without writing or exposing undo', async () => {
  const preview = await previewPortalReimport(scope, [row()]);
  const receipt = await commitPortalReimport(scope, preview, { new: 'keep' });
  expect(receipt).toMatchObject({ added: 0, updated: 0, kept: 1, batchId: null });
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
test('exact duplicates do not rewrite source evidence', async () => {
  const before = await content();
  const preview = await previewPortalReimport(scope, [row({ grade: '80' })]);
  const receipt = await commitPortalReimport(scope, preview, {});
  expect(receipt.duplicates).toBe(1);
  expect(await content()).toEqual(before);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
test('a newer edit invalidates the entire reviewed transaction', async () => {
  const preview = await previewPortalReimport(scope, [row(), row({ id: 'extra', courseCode: 'S102' })]);
  const old = (await loadPersonalImports(scope)).records[0];
  await editPersonalImport(scope, old, { ...old, grade: '95' });
  const before = await content(); jest.mocked(AsyncStorage.setItem).mockClear();
  await expect(commitPortalReimport(scope, preview, { new: 'replace' })).rejects.toThrow(/已變更/);
  expect(await content()).toEqual(before); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
test('two concurrent confirmations cannot apply the same stale snapshot twice', async () => {
  const preview = await previewPortalReimport(scope, [row()]);
  const results = await Promise.allSettled([commitPortalReimport(scope, preview, { new: 'replace' }), commitPortalReimport(scope, preview, { new: 'replace' })]);
  expect(results.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
});
test('rollback refuses to overwrite later edits', async () => {
  const receipt = await commitPortalReimport(scope, await previewPortalReimport(scope, [row()]), { new: 'replace' });
  const changed = (await loadPersonalImports(scope)).records[0];
  await editPersonalImport(scope, changed, { ...changed, grade: '96' });
  await expect(undoPortalReimport(scope, receipt)).rejects.toThrow(/已變更/);
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('96');
});
test('cannot commit or roll back another account snapshot', async () => {
  const preview = await previewPortalReimport(scope, [row()]);
  const other = { ...scope, owner: 'nuni:two' };
  await expect(commitPortalReimport(other, preview, { new: 'replace' })).rejects.toThrow(/帳號/);
  const receipt = await commitPortalReimport(scope, preview, { new: 'replace' });
  await expect(undoPortalReimport(other, receipt)).rejects.toThrow(/帳號/);
  expect((await loadPersonalImports(other)).records).toHaveLength(0);
});
test('invalid decisions cannot partially insert the other valid new rows', async () => {
  const before = await content();
  const preview = await previewPortalReimport(scope, [row(), row({ id: 'extra', courseCode: 'S102' })]);
  await expect(commitPortalReimport(scope, preview, {})).rejects.toThrow(/逐筆/);
  expect(await content()).toEqual(before); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
test('inactive scope does not write and a storage failure can be deliberately retried', async () => {
  const preview = await previewPortalReimport(scope, [row()]);
  await expect(commitPortalReimport(scope, preview, { new: 'replace' }, () => false)).rejects.toThrow();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
  await expect(commitPortalReimport(scope, preview, { new: 'replace' })).rejects.toThrow('disk full');
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('80');
  expect((await commitPortalReimport(scope, preview, { new: 'replace' })).updated).toBe(1);
});

function sheet() { return <SchoolPortalReimport scope={scope} rows={[row()]} isCurrent={() => true} onCancel={mockCancel} onSaved={mockSaved} />; }
test('sheet shows real differences and requires a choice before saving', async () => {
  const view = render(sheet());
  expect(await view.findByText('成績：80 → 90')).toBeTruthy();
  expect(view.getByLabelText('確認新增 0 筆、更新 0 筆').props.accessibilityState.disabled).toBe(true);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('選擇更新這筆：統計學'));
  await act(async () => fireEvent.press(view.getByText('確認新增 0 筆、更新 1 筆')));
  expect(mockSaved).toHaveBeenCalledWith(expect.objectContaining({ updated: 1, added: 0 }));
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('90');
});
test('cancel preserves stored content without an implicit update', async () => {
  const view = render(sheet()); await view.findByText('成績：80 → 90');
  fireEvent.press(view.getByText('選擇更新這筆：統計學'));
  fireEvent.press(view.getByText('返回原預覽'));
  expect(mockCancel).toHaveBeenCalledTimes(1); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
test('reload discards stale replacement consent and requires reviewing the newer value', async () => {
  const view = render(sheet()); await view.findByText('成績：80 → 90');
  fireEvent.press(view.getByText('選擇更新這筆：統計學'));
  const old = (await loadPersonalImports(scope)).records[0];
  await act(async () => { await editPersonalImport(scope, old, { ...old, grade: '95' }); });
  await act(async () => fireEvent.press(view.getByText('確認新增 0 筆、更新 1 筆')));
  expect(view.getByText(/原有紀錄已變更/)).toBeTruthy(); expect(mockSaved).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('重新比對既有紀錄'));
  expect(await view.findByText('成績：95 → 90')).toBeTruthy();
  expect(view.getByLabelText('確認新增 0 筆、更新 0 筆').props.accessibilityState.disabled).toBe(true);
});

test('portal entry completes updated-record receipt and two-step rollback through the real ledger', async () => {
  const view = render(<SchoolPortalImportEntry onOpenRecords={jest.fn()} />);
  fireEvent.press(view.getByText('在 App 內開啟校務網站匯入'));
  fireEvent.press(view.getByText('改為成績'));
  fireEvent.press(view.getByText('同意並開啟校方網站'));
  act(() => view.getByTestId('school-portal-browser').props.onLoad());
  fireEvent.press(view.getByText('讀取這頁表格'));
  const script = String(mockInject.mock.calls[0][0]);
  const id = JSON.parse(/var id = ("[^"]+");/.exec(script)![1]);
  const html = '<h2>115 學年度第 1 學期</h2><table><tr><th>課程名稱</th><th>課號</th><th>班級</th><th>學分</th><th>成績</th></tr><tr><td>統計學</td><td>S101</td><td>三B</td><td>3</td><td>90</td></tr></table>';
  act(() => view.getByTestId('school-portal-browser').props.onMessage({ nativeEvent: { url: 'https://alcat.pu.edu.tw/grades', data: JSON.stringify({ version: 1, id, origin: 'https://alcat.pu.edu.tw', html, blockedFrames: 0 }) } }));
  fireEvent.press(view.getByText(/表格 1 · 1 筆/));
  fireEvent.press(view.getByText('整理並核對匯入內容'));
  fireEvent.press(view.getByText('核對重複與更新既有資料'));
  expect(await view.findByText('成績：80 → 90')).toBeTruthy();
  fireEvent.press(view.getByText('選擇更新這筆：統計學'));
  await act(async () => fireEvent.press(view.getByText('確認新增 0 筆、更新 1 筆')));
  expect(view.getByText(/已新增 0 筆、更新 1 筆/)).toBeTruthy();
  expect((await loadPersonalImports(scope)).records).toHaveLength(1);
  fireEvent.press(view.getByText('撤回這次匯入'));
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('90');
  await act(async () => fireEvent.press(view.getByText('確認撤回這次匯入')));
  await waitFor(() => expect(view.getByText('已撤回這次新增與更新')).toBeTruthy());
  expect((await loadPersonalImports(scope)).records[0].grade).toBe('80');
});
