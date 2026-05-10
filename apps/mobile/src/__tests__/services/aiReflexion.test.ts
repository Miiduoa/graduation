import {
  evaluateLocalAgentForReflexion,
  evaluateToolRoundForReflexion,
  clampReflectionText,
  composeQuickLocalReflection,
  buildLocalAgentReflectorUserContent,
  MAX_REFLECTION_CHARS,
} from '../../services/aiReflexion';
import type { AgentQueryResult } from '../../services/aiLocalAgent';

describe('aiReflexion', () => {
  it('evaluateToolRoundForReflexion detects failure', () => {
    expect(
      evaluateToolRoundForReflexion([
        { tool: 'x', result: { success: true, summary: 'ok' } },
      ]),
    ).toBe(false);
    expect(
      evaluateToolRoundForReflexion([
        { tool: 'x', result: { success: false, summary: 'bad', error: 'e' } },
      ]),
    ).toBe(true);
  });

  it('evaluateLocalAgentForReflexion detects failedActions', () => {
    const q: AgentQueryResult = {
      intents: [],
      results: [],
      totalTimeMs: 0,
      contextText: '',
      executedActions: [],
      failedActions: [{ tool: 't', reason: 'r', missingInfo: 'm' }],
      pendingWriteActions: [],
    };
    expect(evaluateLocalAgentForReflexion(q)).toBe(true);
  });

  it('clampReflectionText respects max length', () => {
    const long = '測'.repeat(MAX_REFLECTION_CHARS + 10);
    expect(clampReflectionText(long).length).toBeLessThanOrEqual(MAX_REFLECTION_CHARS + 2);
  });

  it('composeQuickLocalReflection summarizes failures without LLM', () => {
    const q: AgentQueryResult = {
      intents: [],
      results: [{ tool: 'query_menus', result: { success: false, summary: 'no', error: 'x' }, reason: 'r' }],
      totalTimeMs: 0,
      contextText: '',
      executedActions: [],
      failedActions: [],
      pendingWriteActions: [],
    };
    const t = composeQuickLocalReflection(q);
    expect(t.length).toBeGreaterThan(0);
    expect(t).toContain('query_menus');
  });

  it('buildLocalAgentReflectorUserContent merges quick facts with full payload', () => {
    const q: AgentQueryResult = {
      intents: [],
      results: [{ tool: 't', result: { success: false, summary: 'x' }, reason: 'r' }],
      totalTimeMs: 0,
      contextText: '',
      executedActions: [],
      failedActions: [],
      pendingWriteActions: [],
    };
    const body = buildLocalAgentReflectorUserContent('幫我訂餐', q);
    expect(body).toContain('【系統已整理');
    expect(body).toContain('代理執行狀態');
  });
});
