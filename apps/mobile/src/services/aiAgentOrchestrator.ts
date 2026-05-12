/* eslint-disable */
/**
 * AI Agent Orchestrator — DEPRECATED STUB
 * ═══════════════════════════════════════════════
 * 此檔案已無任何消費者，保留型別匯出以相容可能的外部引用。
 * 所有邏輯已整合至 ai.ts + aiLocalAgent.ts。
 */

// ── Types ────────────────────────────────────────
export type OrchestrateOptions = { maxSteps?: number; timeout?: number };
export type PlanStep = { id: string; action: string; params: Record<string, unknown>; status: string };
export type SubAgentType = 'planner' | 'executor' | 'critic' | 'retriever';
export type MemoryEntry = { key: string; value: string; ts: number; ttl?: number };
export type KnowledgeNode = { id: string; label: string; type: string; data?: Record<string, unknown> };
export type KnowledgeEdge = { from: string; to: string; relation: string; weight?: number };
export type RetrievalResult = { content: string; score: number; source: string };
export type RetrievalGrade = 'correct' | 'ambiguous' | 'incorrect';
export type RAGStrategy = 'direct' | 'simple_rag' | 'multi_step_rag';
export type OrchestratorResult = { answer: string; plan: PlanStep[]; debug?: DebugTraceEntry[] };
export type DebugTraceEntry = { ts: number; agent: string; action: string; detail?: string };
export type CampusGraphSeedInput = { courses?: any[]; grades?: any[]; attendance?: any[] };

type DetectedIntent = { intent: string; confidence: number };

// ── No-op stubs ──────────────────────────────────
export function shouldRunOrchestratorContext(_message: string): boolean { return false; }

class _MemoryManager {
  add(_e: MemoryEntry) {}
  get(_k: string): MemoryEntry | undefined { return undefined; }
  search(_q: string): MemoryEntry[] { return []; }
  clear() {}
}
class _KnowledgeGraph {
  addNode(_n: KnowledgeNode) {}
  addEdge(_e: KnowledgeEdge) {}
  query(_q: string): RetrievalResult[] { return []; }
}
const _mm = new _MemoryManager();
const _kg = new _KnowledgeGraph();
export function getMemoryManager() { return _mm; }
export function getKnowledgeGraph() { return _kg; }
export function seedKnowledgeGraphFromCampusContext(_input: CampusGraphSeedInput): void {}
export function selectRAGStrategy(_message: string, _intents: DetectedIntent[]): RAGStrategy { return 'direct'; }
export async function orchestrate(_msg: string, _opts?: OrchestrateOptions): Promise<OrchestratorResult> {
  return { answer: '', plan: [] };
}
export async function orchestratedQuery(_msg: string): Promise<string> { return ''; }
export function buildOrchestratedQueryDigest(): string { return ''; }
export function buildOrchestratorContextSection(): string { return ''; }
export function serializeOrchestratorState(): { memory: string; graph: string } { return { memory: '[]', graph: '{}' }; }
export function loadOrchestratorState(_state: { memory: string; graph: string }): void {}
