import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerAssistantLocally, canAnswerAssistantLocally } from './assistantLocalActions';
import { personalImportsStorageKey } from './personalImports';

const scope = { owner: 'platform:alice', schoolId: 'pu' };
const grade = {
  id: 'grade-a', kind: 'grades', title: '資料庫管理', schoolId: 'pu',
  academicYear: '115', semester: '1', credits: 3, grade: '87', courseCode: 'IM201',
  batchId: 'import-a', importedAt: '2026-11-07T10:00:00.000Z',
  source: { type: 'paste', line: 1, rawText: '只留在來源的私人文字' },
};
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('assistant local actions', () => {
  it('opens a fixed service without reading private storage or calling a provider', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    expect(answerAssistantLocally('幫我開啟助理權限', scope)).toMatchObject({
      kind: 'services', serviceIds: ['assistant-permissions'],
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('leaves data reads, mutations and physical navigation with their original tools', () => {
    for (const question of ['帶我去圖書館', '我的訂單好了嗎', '送出請假申請', '不要開啟社群', '我可以畢業嗎']) {
      expect(canAnswerAssistantLocally(question)).toBe(false);
      expect(answerAssistantLocally(question, scope)).toBeNull();
    }
  });

  it('reads the current account and school while preserving grade literals', () => {
    localStorage.setItem(personalImportsStorageKey(scope), JSON.stringify({ version: 1, records: [grade] }));
    const result = answerAssistantLocally('查看我的匯入成績', scope);
    expect(result?.content).toContain('資料庫管理');
    expect(result?.content).toContain('成績：87');
    expect(result?.content).toContain('不代表已取得');
    expect(result?.content).not.toContain('只留在來源的私人文字');
    expect(result?.serviceIds).toEqual(['import', 'credits']);
    expect(answerAssistantLocally('我的成績', { ...scope, owner: 'platform:bob' })?.content).not.toContain('資料庫管理');
    expect(answerAssistantLocally('我的成績', { ...scope, schoolId: 'nthu' })?.content).not.toContain('資料庫管理');
  });

  it('keeps read failures distinct from a successful empty list', () => {
    localStorage.setItem(personalImportsStorageKey(scope), 'malformed');
    const result = answerAssistantLocally('我的成績', scope);
    expect(result?.content).toContain('目前無法讀取');
    expect(result?.content).not.toContain('目前沒有已儲存');
  });

  it('preserves a general live-school grade query unless personal imports were requested', () => {
    expect(answerAssistantLocally('我的成績', scope, { preferCampusReads: true })).toBeNull();
    expect(answerAssistantLocally('我匯入的成績', scope, { preferCampusReads: true })?.kind).toBe('academics');
  });

  it('does not read a guest namespace as a signed-in academic record', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    expect(answerAssistantLocally('我的成績', { owner: 'guest', schoolId: 'pu' })?.content).toContain('目前無法讀取');
    expect(read).not.toHaveBeenCalled();
  });

  it('can discover every service without implying it has executed anything', () => {
    const result = answerAssistantLocally('你能做什麼？', scope);
    expect(result?.serviceIds).toContain('messages');
    expect(result?.serviceIds).toContain('notifications');
    expect(result?.serviceIds).toContain('merchant');
    expect(result?.serviceIds).toContain('admin');
    expect(result?.content).toContain('帳號權限');
    expect(result?.content).not.toMatch(/已(?:送出|完成|開啟)/);
  });
});
