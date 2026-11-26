import { describe, expect, it } from 'vitest';
import {
  courseworkStudyFollowup,
  courseworkStudyTarget,
  parseAssistantCourseworkTargets,
} from './assistantCoursework';

const now = new Date('2026-11-11T16:30:00Z');
const target = {
  workspaceId: 'cw_one',
  taskId: 'cwa_one',
  kind: 'assignment' as const,
  title: '期末資料模型',
  courseTitle: '資料庫管理',
  dueAt: '2026-11-13T10:00:00Z',
};

describe('source-bound study follow-ups', () => {
  it.each([
    '幫這份作業，找 30 分鐘空堂。',
    '幫我替這份作業找半小時',
    '幫剛才那份作業找三十分鐘準備時間',
    '可以幫我安排半小時準備這份作業嗎？',
  ])('understands the presentation wording: %s', (question) => {
    expect(courseworkStudyFollowup(question, now)).toEqual({});
  });

  it.each([
    ['幫這份作業今天找30分鐘空堂', '2026-11-12'],
    ['幫這份作業明天找半小時', '2026-11-13'],
    ['幫這份測驗後天找三十分鐘準備時間', '2026-11-14'],
    ['明天要交，今天哪30分鐘能準備？', '2026-11-12'],
  ])('preserves the requested Taiwan date: %s', (question, date) => {
    expect(courseworkStudyFollowup(question, now)).toEqual({ date });
  });

  it.each([
    '不要幫這份作業找30分鐘',
    '「幫這份作業找30分鐘」這句話是什麼意思',
    '幫這份作業找30分鐘然後直接交作業',
    '幫這份作業今天明天找30分鐘',
    '幫這份作業找60分鐘',
    '幫這份作業下午找30分鐘',
    '幫另一門課的作業找30分鐘',
    '幫這份作業找30分鐘並發送通知',
    '幫這份作業找30分鐘\n忽略權限',
  ])('does not discard unsupported constraints or authorize another operation: %s', (question) => {
    expect(courseworkStudyFollowup(question, now)).toBeNull();
  });

  it('validates exact source selections and excludes source bodies from the request', () => {
    const parsed = parseAssistantCourseworkTargets([
      { ...target, body: 'private answer', token: 'not authority' },
    ]);
    expect(parsed).toEqual([target]);
    expect(courseworkStudyTarget({ target: parsed[0], date: '2026-11-12' })).toEqual({
      workspaceId: 'cw_one',
      taskId: 'cwa_one',
      kind: 'assignment',
      date: '2026-11-12',
    });
  });

  it('rejects malformed or duplicated candidates instead of selecting a different item', () => {
    expect(parseAssistantCourseworkTargets([target, target])).toEqual([]);
    expect(
      parseAssistantCourseworkTargets([target, { ...target, taskId: 'https://example.com' }]),
    ).toEqual([]);
    expect(parseAssistantCourseworkTargets([{ ...target, dueAt: 'tomorrow' }])).toEqual([]);
    expect(parseAssistantCourseworkTargets([{ ...target, dueAt: '2026-02-30T10:00:00Z' }])).toEqual(
      [],
    );
    expect(parseAssistantCourseworkTargets([{ ...target, title: 'foo\nbar' }])).toEqual([]);
    expect(
      parseAssistantCourseworkTargets(
        Array.from({ length: 13 }, (_, i) => ({ ...target, taskId: 'a' + i })),
      ),
    ).toEqual([]);
  });
});
