/**
 * @jest-environment node
 *
 * AI Data Inventory 完整測試。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  AI_DATA_INVENTORY,
  aiDataInventoryStats,
  buildWideAISnapshot,
  wideSnapshotToPromptLine,
} from '../services/aiDataInventory';

describe('AI_DATA_INVENTORY', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('盤點至少 30 個 domain', () => {
    expect(AI_DATA_INVENTORY.length).toBeGreaterThanOrEqual(30);
  });

  it('每個 entry 都有必填欄位', () => {
    for (const e of AI_DATA_INVENTORY) {
      expect(e.key).toBeTruthy();
      expect(e.label).toBeTruthy();
      expect(Array.isArray(e.roles)).toBe(true);
      expect(e.roles.length).toBeGreaterThan(0);
      expect(['native', 'context', 'tool', 'planned', 'static']).toContain(e.level);
      expect(e.aiKnowledge).toBeTruthy();
    }
  });

  it('課程、錯題本、AI 學伴、教師工作台、系所、餐廳 6 個核心是 native', () => {
    const natives = AI_DATA_INVENTORY.filter((e) => e.level === 'native').map((e) => e.key);
    expect(natives).toContain('courses');
    expect(natives).toContain('mistakes');
    expect(natives).toContain('ai_advisor');
    expect(natives).toContain('teacher_workspace');
    expect(natives).toContain('department_admin');
    expect(natives).toContain('vendor_admin');
  });
});

describe('aiDataInventoryStats', () => {
  it('整合覆蓋率 ≥ 80%', () => {
    const s = aiDataInventoryStats();
    expect(s.coverage).toBeGreaterThanOrEqual(80);
    expect(s.total).toBe(AI_DATA_INVENTORY.length);
    expect(s.integrated).toBeGreaterThan(0);
  });
});

describe('buildWideAISnapshot', () => {
  it('回傳所有 domain 並含覆蓋率', async () => {
    const snap = await buildWideAISnapshot({ uid: 'u1', schoolId: 'pu' });
    expect(snap.domains.courses).toBeDefined();
    expect(snap.domains.mistakes).toBeDefined();
    expect(snap.domains.companion).toBeDefined();
    expect(snap.coverage).toBeGreaterThan(0);
    expect(snap.generatedAt).toBeTruthy();
  });

  it('沒有 storage 也不會 throw', async () => {
    const snap = await buildWideAISnapshot({ uid: 'u_empty' });
    expect((snap.domains.mistakes as any).total).toBe(0);
  });
});

describe('wideSnapshotToPromptLine', () => {
  it('產出單行摘要含覆蓋率 + 課程數 + 錯題', async () => {
    const snap = await buildWideAISnapshot({ uid: 'u1' });
    const line = wideSnapshotToPromptLine(snap);
    expect(line).toContain('AI 資料覆蓋率');
    expect(line).toContain('課');
    expect(line).toContain('錯題');
  });
});
