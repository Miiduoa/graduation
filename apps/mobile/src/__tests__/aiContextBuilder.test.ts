/**
 * @jest-environment node
 *
 * 對 services/aiContextBuilder.ts 完整單元測試。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  buildFullAIContext,
  contextToPromptBlock,
  contextToCompactJson,
} from '../services/aiContextBuilder';

const NOW = '2026-05-15T10:00:00+08:00';

describe('buildFullAIContext', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('回傳 5 門 demo 課程資料 + 預估成績', async () => {
    const ctx = await buildFullAIContext({
      uid: 'u1',
      schoolId: 'pu',
      displayName: '小明',
      role: 'student',
      now: NOW,
    });
    expect(ctx.courses).toHaveLength(5);
    expect(ctx.courses[0].prediction).toBeDefined();
    // 至少一門課應該有 prediction
    expect(typeof ctx.courses[0].prediction.bestCase).toBe('number');
  });

  it('user info 帶入正確', async () => {
    const ctx = await buildFullAIContext({
      uid: 'u1',
      displayName: '阿明',
      role: 'student',
      studentId: '411211325',
      department: '資管',
      now: NOW,
    });
    expect(ctx.user.displayName).toBe('阿明');
    expect(ctx.user.studentId).toBe('411211325');
    expect(ctx.user.department).toBe('資管');
  });

  it('studyPlan 含 summary + topTasks', async () => {
    const ctx = await buildFullAIContext({ uid: 'u1', now: NOW });
    expect(ctx.studyPlan.summary).toBeTruthy();
    expect(Array.isArray(ctx.studyPlan.topTasks)).toBe(true);
  });

  it('urgentNotifications 只含 critical / high', async () => {
    const ctx = await buildFullAIContext({ uid: 'u1', now: NOW });
    for (const n of ctx.urgentNotifications) {
      expect(['critical', 'high']).toContain(n.severity);
    }
  });

  it('atRiskCourses 列出 likelyScore < 70 的課', async () => {
    const ctx = await buildFullAIContext({ uid: 'u1', now: NOW });
    for (const r of ctx.atRiskCourses) {
      expect(r.likelyScore === null || r.likelyScore < 70).toBe(true);
    }
  });

  it('讀不到 mistake storage 時 mistakes 預設為 0', async () => {
    const ctx = await buildFullAIContext({ uid: 'u_no_storage', now: NOW });
    expect(ctx.mistakes.total).toBe(0);
    expect(ctx.mistakes.masteryRate).toBe(0);
  });
});

describe('contextToPromptBlock', () => {
  it('產出 markdown 含學生姓名 + 今日重點 + 5 門課', async () => {
    const ctx = await buildFullAIContext({
      uid: 'u1',
      displayName: '小華',
      now: NOW,
    });
    const md = contextToPromptBlock(ctx);
    expect(md).toContain('小華');
    expect(md).toContain('今日重點');
    expect(md).toContain('5 門課當前狀態');
    expect(md).toContain('待辦優先序');
    expect(md).toContain('錯題本');
  });
});

describe('contextToCompactJson', () => {
  it('回傳精簡格式 (給 AI tool call 用)', async () => {
    const ctx = await buildFullAIContext({
      uid: 'u1',
      displayName: '小華',
      role: 'student',
      now: NOW,
    });
    const json = contextToCompactJson(ctx);
    expect(json.user.name).toBe('小華');
    expect(json.user.role).toBe('student');
    expect(json.today.summary).toBeTruthy();
    expect(json.courses.length).toBe(5);
    expect(typeof json.atRisk).toBe('object');
    expect(json.mistakes).toBeDefined();
  });
});
