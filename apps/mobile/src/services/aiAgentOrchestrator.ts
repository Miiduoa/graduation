/* eslint-disable */
/**
 * AI Agent Orchestrator — Agentic 設計模式（行動端 TypeScript 實作）
 * ═══════════════════════════════════════════════════════════════
 *
 * 對應文獻／產品論述的對照（本專案以 App 內工具 + 本地狀態機實作，不依賴 LangGraph／MongoDB）：
 * - Planning：modelAssistedPlanning + createPlan + executePlan
 * - 多代理協作：SubAgentType 分工 + executeSubAgent 鏈式呼叫
 * - 監督者模式：supervisorRoute 決定主代理與協作代理
 * - 「LangGraph 式」記憶：memoryManager 工作／長期記憶 + 本對話 turn（狀態可 serializeOrchestratorState）
 * - Agentic RAG：agenticRetrieve（代理驅動多源檢索）
 * - CRAG：gradeRetrieval + correctRetrieval
 * - Adaptive-RAG：selectRAGStrategy（direct / simple_rag / multi_step_rag）
 * - GraphRAG：knowledgeGraph.querySubgraph
 *
 * 雲端 ai-server 另以 Chroma + Adaptive/CRAG 補強 RAG（見 backend/ai-server/rag/agentic_pipeline.py）。
 */

export type OrchestrateOptions = {
  /** 僅產生規劃／檢索／圖譜上下文，不執行計畫內工具（避免與 autonomousQuery 重複寫入） */
  skipToolExecution?: boolean;
};

/** 是否應跑編排器以注入 Planning／RAG／Graph 上下文（非純寒暄） */
export function shouldRunOrchestratorContext(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 4) return false;
  return selectRAGStrategy(trimmed, analyzeIntents(trimmed)) !== 'direct';
}

import {
  executeTool,
  getToolDeclarations,
  type ToolCallResult,
  type ExecutorContext,
  type GeminiToolDeclaration,
} from './aiAgentTools';
import {
  autonomousQuery,
  autonomousQueryWithReflexion,
  exploreAndLearn,
  analyzeIntents,
  findLearnedSkill,
  executeLearnedSkill,
  type AgentQueryResult,
  type ConversationTurn,
  type DetectedIntent,
  type LearnedSkill,
} from './aiLocalAgent';
import type { CampusActorRole } from '../data';

// ════════════════════════════════════════════════════════════
// I. 型別定義
// ════════════════════════════════════════════════════════════

/** 規劃步驟 */
export type PlanStep = {
  id: number;
  description: string;
  tool?: string;
  args?: Record<string, string>;
  dependsOn?: number[];
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: ToolCallResult;
  subAgent?: SubAgentType;
};

/** 子代理類型 */
export type SubAgentType =
  | 'academic'    // 學業：成績、課表、作業
  | 'dining'      // 餐飲：菜單、訂餐、餐廳
  | 'campus_life' // 校園生活：活動、社團、失物、維修
  | 'social'      // 社交：私訊、學習配對
  | 'calendar'    // 行事曆：事件、排程
  | 'library'     // 圖書館：借閱、座位
  | 'health'      // 健康：就醫、掛號
  | 'admin'       // 行政：請假、文件
  | 'general';    // 通用

/** 記憶項目 */
export type MemoryEntry = {
  id: string;
  content: string;
  type: 'fact' | 'preference' | 'task_result' | 'entity' | 'relation';
  importance: number;    // 0-1
  timestamp: number;
  accessCount: number;
  lastAccess: number;
  tags: string[];
  source: 'conversation' | 'tool_result' | 'inference' | 'user_profile';
};

/** 知識圖譜節點 */
export type KnowledgeNode = {
  id: string;
  label: string;
  type: 'person' | 'course' | 'place' | 'food' | 'event' | 'department' | 'concept';
  properties: Record<string, string>;
};

/** 知識圖譜邊 */
export type KnowledgeEdge = {
  source: string;
  target: string;
  relation: string;
  weight: number;
};

/** RAG 檢索結果 */
export type RetrievalResult = {
  content: string;
  source: string;
  relevanceScore: number;
  sourceType: 'tool_data' | 'memory' | 'graph' | 'conversation';
};

/** CRAG 評估等級 */
export type RetrievalGrade = 'correct' | 'ambiguous' | 'incorrect';

/** Adaptive-RAG 策略 */
export type RAGStrategy = 'direct' | 'simple_rag' | 'multi_step_rag';

/** 編排器執行結果 */
export type OrchestratorResult = {
  answer: string;
  plan?: PlanStep[];
  agentRoute: SubAgentType;
  memoryUpdates: MemoryEntry[];
  retrievals: RetrievalResult[];
  ragStrategy: RAGStrategy;
  graphContext?: string;
  totalTimeMs: number;
  debugTrace: DebugTraceEntry[];
  /** 與 AgentQueryResult 互操作 */
  agentQueryResult?: AgentQueryResult;
};

export type DebugTraceEntry = {
  phase: string;
  detail: string;
  timeMs: number;
};

// ════════════════════════════════════════════════════════════
// II. LangGraph-style Memory System (Pattern 4)
// ════════════════════════════════════════════════════════════

/**
 * 三層記憶系統：
 *   短期 (Short-term) — 當前對話 window（由外部 conversationHistory 提供）
 *   工作 (Working) — 當前任務上下文（plan state, intermediate results）
 *   長期 (Long-term) — 跨對話持久化（偏好、事實、實體關係）
 */
class MemoryManager {
  /** 長期記憶 — 跨對話持久 */
  private longTermStore: Map<string, MemoryEntry> = new Map();
  /** 工作記憶 — 當前任務 */
  private workingMemory: Map<string, MemoryEntry> = new Map();
  /** 最大長期記憶條目 */
  private readonly MAX_LONG_TERM = 500;
  /** 最大工作記憶條目 */
  private readonly MAX_WORKING = 50;

  /** 加入記憶 */
  add(entry: Omit<MemoryEntry, 'id' | 'accessCount' | 'lastAccess'>): MemoryEntry {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const full: MemoryEntry = {
      ...entry,
      id,
      accessCount: 0,
      lastAccess: Date.now(),
    };
    if (entry.type === 'fact' || entry.type === 'preference' || entry.type === 'entity' || entry.type === 'relation') {
      this.longTermStore.set(id, full);
      this._evictIfNeeded(this.longTermStore, this.MAX_LONG_TERM);
    } else {
      this.workingMemory.set(id, full);
      this._evictIfNeeded(this.workingMemory, this.MAX_WORKING);
    }
    return full;
  }

  /** 按相關性檢索記憶 */
  retrieve(query: string, limit: number = 5): MemoryEntry[] {
    const queryTokens = this._tokenize(query);
    const scored: Array<{ entry: MemoryEntry; score: number }> = [];
    const allEntries = [...this.longTermStore.values(), ...this.workingMemory.values()];

    for (const entry of allEntries) {
      const entryTokens = this._tokenize(entry.content + ' ' + entry.tags.join(' '));
      let overlap = 0;
      for (const qt of queryTokens) {
        if (entryTokens.some(et => et.includes(qt) || qt.includes(et))) overlap++;
      }
      if (overlap === 0) continue;
      const relevance = overlap / Math.max(queryTokens.length, 1);
      // 時間衰減：24 小時半衰期
      const ageHours = (Date.now() - entry.timestamp) / 3_600_000;
      const recency = Math.exp(-0.029 * ageHours); // ln(2)/24 ≈ 0.029
      const score = relevance * 0.6 + entry.importance * 0.25 + recency * 0.15;
      scored.push({ entry, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit).map(s => {
      s.entry.accessCount++;
      s.entry.lastAccess = Date.now();
      return s.entry;
    });
    return results;
  }

  /** 從對話歷史中萃取記憶 */
  extractFromConversation(history: ConversationTurn[]): MemoryEntry[] {
    const extracted: MemoryEntry[] = [];
    for (const turn of history) {
      if (turn.role !== 'user') continue;
      const msg = turn.content;
      // 萃取偏好
      const prefMatch = msg.match(/我(?:喜歡|愛吃|想吃|偏好|常[吃喝去用]|最愛)\s*(.{2,15})/);
      if (prefMatch) {
        extracted.push(this.add({
          content: `使用者偏好：${prefMatch[1]}`,
          type: 'preference',
          importance: 0.7,
          timestamp: Date.now(),
          tags: ['preference', prefMatch[1]],
          source: 'conversation',
        }));
      }
      // 萃取事實（「我是...系」「我住...」）
      const factMatch = msg.match(/我(?:是|住在?|讀|就讀|在|叫)\s*(.{2,20})/);
      if (factMatch) {
        extracted.push(this.add({
          content: `使用者事實：${factMatch[1]}`,
          type: 'fact',
          importance: 0.8,
          timestamp: Date.now(),
          tags: ['fact', factMatch[1]],
          source: 'conversation',
        }));
      }
    }
    return extracted;
  }

  /** 把工作記憶轉成 prompt 文字 */
  formatWorkingMemory(): string {
    if (this.workingMemory.size === 0) return '';
    const entries = [...this.workingMemory.values()]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
    return entries.map(e => `- ${e.content}`).join('\n');
  }

  /** 把長期記憶中與查詢最相關的格式化成 prompt */
  formatRelevantLongTerm(query: string): string {
    const relevant = this.retrieve(query, 5);
    if (relevant.length === 0) return '';
    return relevant.map(e => `- [${e.type}] ${e.content}`).join('\n');
  }

  /** 儲存工具結果到工作記憶 */
  recordToolResult(tool: string, result: ToolCallResult): void {
    this.add({
      content: `工具 ${tool} 結果：${result.summary}`,
      type: 'task_result',
      importance: result.success ? 0.6 : 0.3,
      timestamp: Date.now(),
      tags: [tool, result.success ? 'success' : 'failure'],
      source: 'tool_result',
    });
  }

  /** 清空工作記憶（新任務開始時） */
  clearWorking(): void {
    this.workingMemory.clear();
  }

  /** 取得所有長期記憶（序列化用） */
  getLongTermEntries(): MemoryEntry[] {
    return [...this.longTermStore.values()];
  }

  /** 載入長期記憶 */
  loadLongTerm(entries: MemoryEntry[]): void {
    for (const e of entries) {
      this.longTermStore.set(e.id, e);
    }
    this._evictIfNeeded(this.longTermStore, this.MAX_LONG_TERM);
  }

  private _tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w一-鿿㐀-䶿]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
  }

  private _evictIfNeeded(store: Map<string, MemoryEntry>, max: number): void {
    if (store.size <= max) return;
    const entries = [...store.entries()]
      .sort((a, b) => {
        // importance * recency 加權淘汰
        const scoreA = a[1].importance * 0.5 + (a[1].accessCount / 10) * 0.3 + (a[1].lastAccess / Date.now()) * 0.2;
        const scoreB = b[1].importance * 0.5 + (b[1].accessCount / 10) * 0.3 + (b[1].lastAccess / Date.now()) * 0.2;
        return scoreA - scoreB; // 低分先淘汰
      });
    const toRemove = entries.slice(0, store.size - max);
    for (const [key] of toRemove) {
      store.delete(key);
    }
  }
}

// 全域記憶管理器
const memoryManager = new MemoryManager();

/** 取得記憶管理器（外部序列化/載入用） */
export function getMemoryManager(): MemoryManager {
  return memoryManager;
}

// ════════════════════════════════════════════════════════════
// III. Knowledge Graph (GraphRAG — Pattern 8)
// ════════════════════════════════════════════════════════════

class KnowledgeGraph {
  private nodes: Map<string, KnowledgeNode> = new Map();
  private edges: KnowledgeEdge[] = [];

  addNode(node: KnowledgeNode): void {
    this.nodes.set(node.id, node);
  }

  addEdge(edge: KnowledgeEdge): void {
    // 避免重複邊
    const exists = this.edges.some(
      e => e.source === edge.source && e.target === edge.target && e.relation === edge.relation,
    );
    if (!exists) this.edges.push(edge);
  }

  /** 查找與關鍵詞相關的子圖 */
  querySubgraph(keywords: string[], maxHops: number = 2): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; summary: string } {
    const matchedIds = new Set<string>();
    // 第一步：找到關鍵詞匹配的節點
    for (const [id, node] of this.nodes) {
      const nodeText = `${node.label} ${Object.values(node.properties).join(' ')}`.toLowerCase();
      for (const kw of keywords) {
        if (nodeText.includes(kw.toLowerCase())) {
          matchedIds.add(id);
          break;
        }
      }
    }
    // 第二步：BFS 擴展 maxHops
    const visited = new Set<string>(matchedIds);
    let frontier = [...matchedIds];
    for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
      const next: string[] = [];
      for (const nodeId of frontier) {
        for (const edge of this.edges) {
          if (edge.source === nodeId && !visited.has(edge.target)) {
            visited.add(edge.target);
            next.push(edge.target);
          }
          if (edge.target === nodeId && !visited.has(edge.source)) {
            visited.add(edge.source);
            next.push(edge.source);
          }
        }
      }
      frontier = next;
    }
    const resultNodes = [...visited].map(id => this.nodes.get(id)!).filter(Boolean);
    const resultEdges = this.edges.filter(e => visited.has(e.source) && visited.has(e.target));

    // 生成摘要
    const triples = resultEdges.map(
      e => `${this.nodes.get(e.source)?.label ?? e.source} —[${e.relation}]→ ${this.nodes.get(e.target)?.label ?? e.target}`,
    );
    const summary = triples.length > 0
      ? `知識圖譜上下文：\n${triples.slice(0, 15).join('\n')}`
      : '';

    return { nodes: resultNodes, edges: resultEdges, summary };
  }

  /** 從工具結果中自動萃取實體和關係 */
  extractFromToolResult(tool: string, result: ToolCallResult): void {
    if (!result.success || !result.data) return;
    const data = result.data as any;

    // 餐廳相關
    if (tool.includes('dining') || tool.includes('menu') || tool.includes('cafeteria')) {
      if (Array.isArray(data)) {
        for (const item of data.slice(0, 20)) {
          if (item.name || item.cafeteriaName) {
            const cafId = `cafe_${item.cafeteriaId || item.id || item.name}`;
            this.addNode({
              id: cafId,
              label: item.cafeteriaName || item.name,
              type: 'place',
              properties: { category: item.category || '餐廳', location: item.location || '' },
            });
            if (item.menuItemName || item.itemName) {
              const foodId = `food_${item.menuItemId || item.itemName || item.menuItemName}`;
              this.addNode({
                id: foodId,
                label: item.menuItemName || item.itemName,
                type: 'food',
                properties: { price: String(item.price || ''), category: item.category || '' },
              });
              this.addEdge({ source: cafId, target: foodId, relation: '提供', weight: 1.0 });
            }
          }
        }
      }
    }

    // 課程相關
    if (tool.includes('course') || tool.includes('grade') || tool.includes('schedule')) {
      if (Array.isArray(data)) {
        for (const item of data.slice(0, 20)) {
          if (item.courseName || item.name) {
            const courseId = `course_${item.courseId || item.id || item.name}`;
            this.addNode({
              id: courseId,
              label: item.courseName || item.name,
              type: 'course',
              properties: {
                instructor: item.instructor || item.teacherName || '',
                schedule: item.schedule || item.time || '',
              },
            });
            if (item.instructor || item.teacherName) {
              const teacherId = `person_${item.instructor || item.teacherName}`;
              this.addNode({
                id: teacherId,
                label: item.instructor || item.teacherName,
                type: 'person',
                properties: { role: 'teacher' },
              });
              this.addEdge({ source: teacherId, target: courseId, relation: '教授', weight: 1.0 });
            }
          }
        }
      }
    }

    // 活動相關
    if (tool.includes('event') || tool.includes('activity') || tool.includes('announcement')) {
      if (Array.isArray(data)) {
        for (const item of data.slice(0, 10)) {
          if (item.title || item.name) {
            const eventId = `event_${item.id || item.title}`;
            this.addNode({
              id: eventId,
              label: item.title || item.name,
              type: 'event',
              properties: { date: item.date || item.startsAt || '', location: item.location || '' },
            });
          }
        }
      }
    }
  }

  /** 取得節點數量 */
  size(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edges.length };
  }

  /** 序列化 */
  serialize(): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
    return { nodes: [...this.nodes.values()], edges: this.edges };
  }

  /** 反序列化 */
  load(data: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }): void {
    for (const n of data.nodes) this.nodes.set(n.id, n);
    this.edges.push(...data.edges);
  }
}

// 全域知識圖譜
const knowledgeGraph = new KnowledgeGraph();

/** 取得知識圖譜（外部序列化用） */
export function getKnowledgeGraph(): KnowledgeGraph {
  return knowledgeGraph;
}

/** 從本回合已載入的校園結構化資料灌入圖譜，重啟後仍可依賴當次對話的 Firestore／App 快照補圖。 */
export type CampusGraphSeedInput = {
  schoolId: string;
  announcements?: Array<{ id: string; title: string; source?: string }>;
  events?: Array<{ id: string; title: string; location?: string; startsAt?: string }>;
  courses?: Array<{ id: string; name: string; teacher?: string; location?: string }>;
  pois?: Array<{ id: string; name: string; category?: string }>;
};

export function seedKnowledgeGraphFromCampusContext(input: CampusGraphSeedInput): void {
  if (!input.schoolId) return;
  const schoolNodeId = `school_${input.schoolId}`;
  knowledgeGraph.addNode({
    id: schoolNodeId,
    label: `學校 ${input.schoolId}`,
    type: 'department',
    properties: { kind: 'school' },
  });
  for (const a of (input.announcements ?? []).slice(0, 40)) {
    const nid = `announcement_${a.id}`;
    knowledgeGraph.addNode({
      id: nid,
      label: (a.title ?? '').slice(0, 120),
      type: 'event',
      properties: { source: a.source ?? '' },
    });
    knowledgeGraph.addEdge({ source: schoolNodeId, target: nid, relation: '公告', weight: 0.85 });
  }
  for (const e of (input.events ?? []).slice(0, 40)) {
    const nid = `calendar_${e.id}`;
    knowledgeGraph.addNode({
      id: nid,
      label: (e.title ?? '').slice(0, 120),
      type: 'event',
      properties: { location: e.location ?? '', startsAt: e.startsAt ?? '' },
    });
    knowledgeGraph.addEdge({ source: schoolNodeId, target: nid, relation: '活動', weight: 0.8 });
  }
  for (const c of (input.courses ?? []).slice(0, 60)) {
    const cid = `course_${c.id}`;
    knowledgeGraph.addNode({
      id: cid,
      label: (c.name ?? '').slice(0, 120),
      type: 'course',
      properties: { teacher: c.teacher ?? '', location: c.location ?? '' },
    });
    knowledgeGraph.addEdge({ source: schoolNodeId, target: cid, relation: '開課', weight: 0.75 });
    const teacher = (c.teacher ?? '').trim();
    if (teacher) {
      const tid = `teacher_${teacher.replace(/\s+/g, '_').slice(0, 48)}`;
      knowledgeGraph.addNode({
        id: tid,
        label: teacher,
        type: 'person',
        properties: { role: 'teacher' },
      });
      knowledgeGraph.addEdge({ source: tid, target: cid, relation: '教授', weight: 1.0 });
    }
  }
  for (const p of (input.pois ?? []).slice(0, 50)) {
    const pid = `poi_${p.id}`;
    knowledgeGraph.addNode({
      id: pid,
      label: (p.name ?? '').slice(0, 120),
      type: 'place',
      properties: { category: p.category ?? '' },
    });
    knowledgeGraph.addEdge({ source: schoolNodeId, target: pid, relation: '地點', weight: 0.7 });
  }
}

// ════════════════════════════════════════════════════════════
// IV. Supervisor Router (Pattern 3)
// ════════════════════════════════════════════════════════════

/** 將工具名稱映射到子代理 */
const TOOL_TO_AGENT: Record<string, SubAgentType> = {
  // Academic
  query_courses: 'academic', query_schedule: 'academic', query_grades: 'academic',
  query_assignments: 'academic', submit_assignment: 'academic', query_attendance: 'academic',
  query_gpa: 'academic', query_course_modules: 'academic',
  // Dining
  query_dining_menu: 'dining', query_cafeterias: 'dining', create_order: 'dining',
  query_orders: 'dining', cancel_order: 'dining',
  // Campus Life
  query_announcements: 'campus_life', query_events: 'campus_life',
  query_clubs: 'campus_life', query_repair_requests: 'campus_life',
  submit_repair_request: 'campus_life', query_lost_found: 'campus_life',
  submit_lost_found: 'campus_life', query_bus_routes: 'campus_life',
  query_campus_map: 'campus_life', query_campus_pois: 'campus_life',
  // Social
  query_conversations: 'social', send_message: 'social',
  query_study_buddies: 'social',
  // Calendar
  query_calendar: 'calendar', create_event: 'calendar',
  query_todos: 'calendar',
  // Library
  query_library_loans: 'library', renew_book: 'library',
  query_library_seats: 'library', reserve_seat: 'library',
  // Health
  query_health_appointments: 'health', make_appointment: 'health',
  // Admin
  submit_leave_request: 'admin', query_leave_records: 'admin',
  query_notifications: 'admin',
};

/** 關鍵詞 → 子代理映射 */
const KEYWORD_TO_AGENT: Array<{ keywords: RegExp; agent: SubAgentType }> = [
  { keywords: /成績|分數|GPA|學分|考試|期[中末]|排名|學業|選課|課[程表]|作業|功課|報告|繳交|deadline|教授|老師/, agent: 'academic' },
  { keywords: /餐[廳點]|菜單|吃[什飯]|訂[餐單]|點[餐菜]|外送|飲料|便當|午餐|晚餐|早餐|飢餓|肚子餓|食堂|美食/, agent: 'dining' },
  { keywords: /活動|社團|公告|報名|競賽|講座|展覽|工作坊|志工|服務學習|維修|報修|修繕|失物|遺失|撿到|公車|校車|地圖|位置|在哪/, agent: 'campus_life' },
  { keywords: /私訊|聊天|傳[訊消]|朋友|同學|配對|學伴|社交/, agent: 'social' },
  { keywords: /行事曆|日程|安排|排程|預約|提醒|待辦|todo|事件/, agent: 'calendar' },
  { keywords: /圖書[館]|借[書閱]|還書|續借|藏書|座位|閱覽/, agent: 'library' },
  { keywords: /健康|看[診病]|掛號|就醫|衛生|醫[療務]|體檢|疫苗/, agent: 'health' },
  { keywords: /請假|假[單條]|公假|病假|事假|缺席|文件|證明|申請/, agent: 'admin' },
];

/**
 * 監督者路由：分析訊息 → 決定哪個子代理負責
 * 支持多代理場景：複雜查詢可能涉及多個代理
 */
function supervisorRoute(message: string, intents: DetectedIntent[]): SubAgentType[] {
  const agents = new Set<SubAgentType>();

  // 1. 從已分析的意圖中的工具名推導
  for (const intent of intents) {
    const mapped = TOOL_TO_AGENT[intent.tool];
    if (mapped) agents.add(mapped);
  }

  // 2. 關鍵詞補充
  for (const rule of KEYWORD_TO_AGENT) {
    if (rule.keywords.test(message)) {
      agents.add(rule.agent);
    }
  }

  // 3. 若無法判定，回傳通用
  if (agents.size === 0) agents.add('general');

  return [...agents];
}

// ════════════════════════════════════════════════════════════
// V. Planning Agent (Pattern 1)
// ════════════════════════════════════════════════════════════

/**
 * 規劃器：將複雜請求分解為多步驟計劃
 *
 * 策略：
 * - 簡單查詢（1 個意圖）→ 直接執行，不生成計劃
 * - 中等複雜（2-3 意圖或需要鏈式操作）→ 線性計劃
 * - 複雜（4+ 意圖或需要條件判斷）→ 模型輔助規劃
 */
function createPlan(
  message: string,
  intents: DetectedIntent[],
  agents: SubAgentType[],
): PlanStep[] {
  const steps: PlanStep[] = [];
  let stepId = 0;

  // 檢測是否需要先查詢再行動（鏈式模式）
  const hasWrite = intents.some(i => i.isWrite);
  const hasRead = intents.some(i => !i.isWrite);
  const needsChain = hasWrite && (hasRead || intents.some(i => i.prereqRead));

  if (intents.length === 0) {
    // 無明確意圖 → 通用查詢步驟
    steps.push({
      id: stepId++,
      description: '理解使用者意圖並檢索相關資訊',
      status: 'pending',
      subAgent: agents[0] || 'general',
    });
    return steps;
  }

  // 按依賴排序：先讀取 → 再寫入
  const readIntents = intents.filter(i => !i.isWrite);
  const writeIntents = intents.filter(i => i.isWrite);

  // 讀取步驟
  for (const intent of readIntents) {
    steps.push({
      id: stepId++,
      description: intent.reason,
      tool: intent.tool,
      args: intent.args,
      status: 'pending',
      subAgent: TOOL_TO_AGENT[intent.tool] || agents[0] || 'general',
    });
  }

  // 寫入步驟（依賴讀取）
  for (const intent of writeIntents) {
    const prereqSteps = intent.prereqRead
      ? steps.filter(s => s.tool === intent.prereqRead!.tool).map(s => s.id)
      : readIntents.length > 0 ? [steps[steps.length - 1]?.id].filter((x): x is number => x !== undefined) : [];

    steps.push({
      id: stepId++,
      description: intent.reason,
      tool: intent.tool,
      args: intent.args,
      dependsOn: prereqSteps.length > 0 ? prereqSteps : undefined,
      status: 'pending',
      subAgent: TOOL_TO_AGENT[intent.tool] || agents[0] || 'general',
    });
  }

  return steps;
}

/**
 * 模型輔助規劃：讓 LLM 分解複雜請求
 */
async function modelAssistedPlanning(
  message: string,
  modelInference: (prompt: string) => Promise<string>,
  availableTools: GeminiToolDeclaration[],
): Promise<PlanStep[]> {
  const toolList = availableTools.slice(0, 30).map(t => `- ${t.name}: ${t.description}`).join('\n');
  const prompt = `你是一個任務規劃器。將使用者的請求分解為具體步驟。

可用工具：
${toolList}

使用者請求：${message}

回覆格式（每行一步）：
[STEP:1] [TOOL:工具名] [DESC:步驟描述] [DEPENDS:]
[STEP:2] [TOOL:工具名] [DESC:步驟描述] [DEPENDS:1]

如果不需要工具，省略 [TOOL:]。每步必須有 [DESC:]。
只回覆步驟，不要其他文字。`;

  try {
    const response = await modelInference(prompt);
    const steps: PlanStep[] = [];
    const lines = response.split('\n').filter(l => l.includes('[STEP:'));
    for (const line of lines) {
      const stepMatch = line.match(/\[STEP:(\d+)\]/);
      const toolMatch = line.match(/\[TOOL:([^\]]+)\]/);
      const descMatch = line.match(/\[DESC:([^\]]+)\]/);
      const depMatch = line.match(/\[DEPENDS:([^\]]*)\]/);
      if (stepMatch && descMatch) {
        const deps = depMatch?.[1]?.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d));
        steps.push({
          id: parseInt(stepMatch[1], 10),
          description: descMatch[1].trim(),
          tool: toolMatch?.[1]?.trim(),
          status: 'pending',
          dependsOn: deps && deps.length > 0 ? deps : undefined,
          subAgent: toolMatch ? (TOOL_TO_AGENT[toolMatch[1].trim()] || 'general') : 'general',
        });
      }
    }
    return steps.length > 0 ? steps : [];
  } catch {
    return [];
  }
}

// ════════════════════════════════════════════════════════════
// VI. Agentic RAG + CRAG + Adaptive-RAG (Patterns 5-7)
// ════════════════════════════════════════════════════════════

/**
 * Adaptive-RAG：根據查詢複雜度選擇檢索策略
 */
export function selectRAGStrategy(message: string, intents: DetectedIntent[]): RAGStrategy {
  // 直接回答：問候、閒聊、確認
  if (/^(?:你好|嗨|hi|hello|謝謝|掰掰|bye|再見|早安|晚安)\s*[!！。]?\s*$/i.test(message)) {
    return 'direct';
  }

  // 複雜多步驟
  const isComplex =
    intents.length >= 3 ||
    /(?:比較|分析|推薦|建議|規劃|安排|幫我(?:想|決定|評估)|最(?:好|佳|適合))/.test(message) ||
    /(?:如果|假如|萬一|除非)/.test(message) ||
    message.length > 80;

  if (isComplex) return 'multi_step_rag';

  // 單步檢索
  return 'simple_rag';
}

/**
 * Agentic RAG：代理驅動的檢索
 * 不只是被動檢索 — AI 決定「要查什麼」「查到的夠不夠」「要不要再查」
 */
async function agenticRetrieve(
  message: string,
  intents: DetectedIntent[],
  ctx: ExecutorContext,
  conversationHistory: ConversationTurn[],
): Promise<RetrievalResult[]> {
  const results: RetrievalResult[] = [];

  // 1. 從記憶系統檢索
  const memoryResults = memoryManager.retrieve(message, 3);
  for (const mem of memoryResults) {
    results.push({
      content: mem.content,
      source: `memory:${mem.id}`,
      relevanceScore: 0.7,
      sourceType: 'memory',
    });
  }

  // 2. 從知識圖譜檢索
  const keywords = message
    .replace(/[^\w一-鿿㐀-䶿]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
  const graphResult = knowledgeGraph.querySubgraph(keywords, 2);
  if (graphResult.summary) {
    results.push({
      content: graphResult.summary,
      source: 'knowledge_graph',
      relevanceScore: 0.8,
      sourceType: 'graph',
    });
  }

  // 3. 從對話歷史檢索（短期記憶）
  const recentContext = conversationHistory
    .slice(-6)
    .map(t => `${t.role}: ${t.content}`)
    .join('\n');
  if (recentContext) {
    results.push({
      content: recentContext,
      source: 'conversation_history',
      relevanceScore: 0.5,
      sourceType: 'conversation',
    });
  }

  // 4. 從工具執行結果檢索（Agentic 部分 — 主動呼叫工具）
  for (const intent of intents) {
    if (!intent.isWrite && intent.tool) {
      try {
        const toolResult = await executeTool(intent.tool, intent.args, ctx);
        if (toolResult.success) {
          results.push({
            content: toolResult.summary,
            source: `tool:${intent.tool}`,
            relevanceScore: 0.9,
            sourceType: 'tool_data',
          });
          // 同時更新知識圖譜
          knowledgeGraph.extractFromToolResult(intent.tool, toolResult);
          // 記錄到工作記憶
          memoryManager.recordToolResult(intent.tool, toolResult);
        }
      } catch (err) {
        console.warn(`[Orchestrator] Tool retrieval failed: ${intent.tool}`, err);
      }
    }
  }

  return results;
}

/**
 * CRAG：檢索品質評估 + 糾錯
 *
 * 評估標準：
 * - correct: 檢索結果直接回答問題
 * - ambiguous: 部分相關但不完整
 * - incorrect: 完全不相關或過時
 *
 * 糾錯策略：
 * - correct → 直接使用
 * - ambiguous → 精煉查詢 + 補充檢索
 * - incorrect → 重新規劃 + 替代來源
 */
function gradeRetrieval(
  message: string,
  retrievals: RetrievalResult[],
): { grade: RetrievalGrade; reasons: string[] } {
  if (retrievals.length === 0) {
    return { grade: 'incorrect', reasons: ['無檢索結果'] };
  }

  const msgTokens = message.toLowerCase()
    .replace(/[^\w一-鿿]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);

  let totalRelevance = 0;
  let toolDataCount = 0;
  const reasons: string[] = [];

  for (const r of retrievals) {
    totalRelevance += r.relevanceScore;
    if (r.sourceType === 'tool_data') toolDataCount++;

    // 檢查內容與查詢的 token 重疊
    const contentTokens = r.content.toLowerCase()
      .replace(/[^\w一-鿿]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
    const overlap = msgTokens.filter(t => contentTokens.some(ct => ct.includes(t) || t.includes(ct)));
    if (overlap.length === 0 && r.sourceType === 'tool_data') {
      reasons.push(`工具 ${r.source} 結果與查詢無交集`);
    }
  }

  const avgRelevance = totalRelevance / retrievals.length;

  if (avgRelevance >= 0.7 && toolDataCount > 0) {
    return { grade: 'correct', reasons: ['檢索品質良好'] };
  }
  if (avgRelevance >= 0.4 || toolDataCount > 0) {
    if (reasons.length > 0) reasons.unshift('部分結果相關性不足');
    return { grade: 'ambiguous', reasons: reasons.length > 0 ? reasons : ['檢索結果部分相關'] };
  }

  return { grade: 'incorrect', reasons: ['整體檢索品質不佳', ...reasons] };
}

/**
 * CRAG 糾錯：當檢索品質不佳時，嘗試修正
 */
async function correctRetrieval(
  message: string,
  originalRetrievals: RetrievalResult[],
  grade: RetrievalGrade,
  ctx: ExecutorContext,
  modelInference?: (prompt: string) => Promise<string>,
): Promise<RetrievalResult[]> {
  if (grade === 'correct') return originalRetrievals;

  const corrected = [...originalRetrievals];

  if (grade === 'ambiguous') {
    // 嘗試補充查詢：從已有結果中提取關鍵實體，再查一次
    const existingContent = originalRetrievals.map(r => r.content).join(' ');
    const entityMatch = existingContent.match(/(?:[一-鿿]{2,8}(?:店|餐廳|館|室|系|學院|大樓|中心))/g);
    if (entityMatch) {
      for (const entity of entityMatch.slice(0, 2)) {
        const supplementary = memoryManager.retrieve(entity, 2);
        for (const mem of supplementary) {
          corrected.push({
            content: mem.content,
            source: `crag_supplement:${mem.id}`,
            relevanceScore: 0.6,
            sourceType: 'memory',
          });
        }
      }
    }
  }

  if (grade === 'incorrect' && modelInference) {
    // 讓模型重新分析該查什麼
    try {
      const refinedPrompt = `使用者問：「${message}」
目前的檢索結果不夠好。請分析使用者真正想知道什麼，用一句話描述應該查詢的內容：`;
      const refined = await modelInference(refinedPrompt);
      if (refined && refined.length > 5) {
        // 用精煉後的查詢重新檢索記憶
        const rMemory = memoryManager.retrieve(refined, 3);
        for (const mem of rMemory) {
          corrected.push({
            content: mem.content,
            source: `crag_refined:${mem.id}`,
            relevanceScore: 0.65,
            sourceType: 'memory',
          });
        }
        // 也查圖譜
        const rKeywords = refined
          .replace(/[^\w一-鿿]/g, ' ')
          .split(/\s+/)
          .filter(t => t.length >= 2);
        const rGraph = knowledgeGraph.querySubgraph(rKeywords, 2);
        if (rGraph.summary) {
          corrected.push({
            content: rGraph.summary,
            source: 'crag_graph_refined',
            relevanceScore: 0.7,
            sourceType: 'graph',
          });
        }
      }
    } catch {
      // 模型推理失敗不影響主流程
    }
  }

  return corrected;
}

// ════════════════════════════════════════════════════════════
// VII. Multi-Agent Executor (Pattern 2)
// ════════════════════════════════════════════════════════════

/**
 * 子代理執行器：每個子代理專注自己的領域
 * 子代理之間可以互相請求協助（受限制的跨代理呼叫）
 */
async function executeSubAgent(
  agent: SubAgentType,
  step: PlanStep,
  ctx: ExecutorContext,
  _modelInference?: (prompt: string) => Promise<string>,
): Promise<ToolCallResult> {
  if (!step.tool) {
    return {
      success: false,
      summary: `步驟 "${step.description}" 無對應工具`,
    };
  }

  try {
    const result = await executeTool(step.tool, step.args || {}, ctx);

    // 代理間協作：如果結果需要其他代理的資訊
    if (result.success && agent === 'dining' && step.tool === 'create_order') {
      // 訂餐成功 → 通知 calendar 代理加入行事曆
      memoryManager.add({
        content: `已訂餐：${result.summary}`,
        type: 'task_result',
        importance: 0.8,
        timestamp: Date.now(),
        tags: ['order', 'dining', 'calendar_hint'],
        source: 'tool_result',
      });
    }

    if (result.success && agent === 'academic' && step.tool === 'submit_assignment') {
      // 繳交作業成功 → 通知 gamification
      memoryManager.add({
        content: `已繳交作業：${result.summary}`,
        type: 'task_result',
        importance: 0.7,
        timestamp: Date.now(),
        tags: ['assignment', 'academic', 'xp_hint'],
        source: 'tool_result',
      });
    }

    return result;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
      summary: `${step.tool} 執行失敗：${err?.message || '未知錯誤'}`,
    };
  }
}

// ════════════════════════════════════════════════════════════
// VIII. Plan Executor (runs the plan)
// ════════════════════════════════════════════════════════════

/**
 * 執行計劃：按照依賴順序執行步驟
 * 支援並行（無依賴關係的步驟可同時執行）
 */
async function executePlan(
  plan: PlanStep[],
  ctx: ExecutorContext,
  modelInference?: (prompt: string) => Promise<string>,
): Promise<{ plan: PlanStep[]; results: ToolCallResult[] }> {
  const results: ToolCallResult[] = [];
  const completed = new Set<number>();

  // 拓撲排序 + 依賴執行
  let maxIterations = plan.length + 1;
  while (completed.size < plan.length && maxIterations-- > 0) {
    const runnable = plan.filter(step => {
      if (step.status === 'done' || step.status === 'failed' || step.status === 'skipped') return false;
      if (!step.dependsOn || step.dependsOn.length === 0) return true;
      return step.dependsOn.every(dep => completed.has(dep));
    });

    if (runnable.length === 0) break;

    // 同層可並行（但為簡化先序列執行）
    for (const step of runnable) {
      step.status = 'running';

      // 檢查前置步驟是否失敗 → skip
      if (step.dependsOn?.some(dep => plan.find(s => s.id === dep)?.status === 'failed')) {
        step.status = 'skipped';
        completed.add(step.id);
        continue;
      }

      const agent = step.subAgent || 'general';
      const result = await executeSubAgent(agent, step, ctx, modelInference);

      step.result = result;
      step.status = result.success ? 'done' : 'failed';
      completed.add(step.id);
      results.push(result);

      // 更新知識圖譜
      if (step.tool && result.success) {
        knowledgeGraph.extractFromToolResult(step.tool, result);
      }
    }
  }

  return { plan, results };
}

// ════════════════════════════════════════════════════════════
// IX. Main Orchestrator Entry Point
// ════════════════════════════════════════════════════════════

/**
 * 統一編排器入口 — 整合所有 9 大設計模式
 *
 * 流程：
 * 1. Memory: 從對話中萃取記憶 + 檢索長期記憶
 * 2. Adaptive-RAG: 判斷查詢複雜度 → 選策略
 * 3. Supervisor: 路由到子代理
 * 4. Planning: 分解為步驟
 * 5. Agentic RAG: 代理驅動檢索
 * 6. CRAG: 評估 + 糾錯檢索品質
 * 7. GraphRAG: 知識圖譜補充上下文
 * 8. Multi-Agent: 子代理執行計劃
 * 9. Reflexion: 失敗時自我反思重試（由 aiLocalAgent.ts 的 autonomousQueryWithReflexion 提供）
 */
export async function orchestrate(
  message: string,
  ctx: { userId?: string; schoolId: string; role?: CampusActorRole },
  modelInference?: (prompt: string) => Promise<string>,
  conversationHistory: ConversationTurn[] = [],
  options?: OrchestrateOptions,
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const trace: DebugTraceEntry[] = [];

  const execCtx: ExecutorContext = {
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    role: ctx.role,
    lastUserMessage: message,
  };

  // ── Phase 1: Memory — 萃取 + 檢索 ──
  const phaseStart1 = Date.now();
  memoryManager.clearWorking();
  memoryManager.extractFromConversation(conversationHistory);
  const relevantMemory = memoryManager.formatRelevantLongTerm(message);
  trace.push({ phase: 'memory', detail: `長期記憶 ${relevantMemory ? '有相關' : '無相關'}`, timeMs: Date.now() - phaseStart1 });

  // ── Phase 2: Adaptive-RAG — 選策略 ──
  const phaseStart2 = Date.now();
  const intents = analyzeIntents(message);
  const ragStrategy = selectRAGStrategy(message, intents);
  trace.push({ phase: 'adaptive_rag', detail: `策略=${ragStrategy}, 意圖=${intents.length}個`, timeMs: Date.now() - phaseStart2 });

  // 直接回答模式 → 跳過大部分流程
  if (ragStrategy === 'direct') {
    return {
      answer: '',
      agentRoute: 'general',
      memoryUpdates: [],
      retrievals: [],
      ragStrategy: 'direct',
      totalTimeMs: Date.now() - startTime,
      debugTrace: trace,
    };
  }

  // ── Phase 3: Supervisor — 路由子代理 ──
  const phaseStart3 = Date.now();
  const agents = supervisorRoute(message, intents);
  const primaryAgent = agents[0];
  trace.push({ phase: 'supervisor', detail: `路由至 [${agents.join(', ')}]`, timeMs: Date.now() - phaseStart3 });

  // ── Phase 4: Planning — 建立計劃 ──
  const phaseStart4 = Date.now();
  let plan: PlanStep[];

  // 若意圖太少但訊息複雜 → 模型輔助規劃
  if (intents.length === 0 && message.length > 30 && modelInference) {
    const tools = getToolDeclarations(ctx.role);
    plan = await modelAssistedPlanning(message, modelInference, tools);
    if (plan.length === 0) {
      // 模型規劃也失敗 → 回退到 autonomousQuery
      plan = createPlan(message, intents, agents);
    }
  } else {
    plan = createPlan(message, intents, agents);
  }
  trace.push({ phase: 'planning', detail: `${plan.length} 步驟`, timeMs: Date.now() - phaseStart4 });

  // ── Phase 5: Agentic RAG — 代理檢索 ──
  const phaseStart5 = Date.now();
  let retrievals: RetrievalResult[] = [];

  if (ragStrategy === 'simple_rag' || ragStrategy === 'multi_step_rag') {
    retrievals = await agenticRetrieve(message, intents, execCtx, conversationHistory);
  }
  trace.push({ phase: 'agentic_rag', detail: `檢索 ${retrievals.length} 筆`, timeMs: Date.now() - phaseStart5 });

  // ── Phase 6: CRAG — 評估 + 糾錯 ──
  const phaseStart6 = Date.now();
  const { grade, reasons } = gradeRetrieval(message, retrievals);
  if (grade !== 'correct') {
    retrievals = await correctRetrieval(message, retrievals, grade, execCtx, modelInference);
  }
  trace.push({ phase: 'crag', detail: `品質=${grade}${grade !== 'correct' ? ', 已糾錯' : ''}`, timeMs: Date.now() - phaseStart6 });

  // ── Phase 7: GraphRAG — 知識圖譜上下文 ──
  const phaseStart7 = Date.now();
  const graphKeywords = message
    .replace(/[^\w一-鿿]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
  const graphContext = knowledgeGraph.querySubgraph(graphKeywords, 2);
  trace.push({ phase: 'graph_rag', detail: `子圖 ${graphContext.nodes.length} 節點`, timeMs: Date.now() - phaseStart7 });

  // ── Phase 8: Multi-Agent Plan Execution ──
  const phaseStart8 = Date.now();
  // 對於有工具的步驟才執行（純檢索步驟已在 Phase 5 完成）
  const executablePlan = plan.filter(s => s.tool);
  let executedPlan = plan;
  let toolResults: ToolCallResult[] = [];

  if (options?.skipToolExecution) {
    trace.push({
      phase: 'multi_agent_exec',
      detail: '已略過工具執行（skipToolExecution，由對話層 autonomousQuery 負責）',
      timeMs: Date.now() - phaseStart8,
    });
  } else if (executablePlan.length > 0) {
    const exec = await executePlan(executablePlan, execCtx, modelInference);
    executedPlan = exec.plan;
    toolResults = exec.results;

    // 把計劃執行結果也加入檢索結果
    for (const r of toolResults) {
      if (r.success) {
        retrievals.push({
          content: r.summary,
          source: 'plan_execution',
          relevanceScore: 0.95,
          sourceType: 'tool_data',
        });
      }
    }
    trace.push({ phase: 'multi_agent_exec', detail: `執行 ${toolResults.length} 工具`, timeMs: Date.now() - phaseStart8 });
  } else {
    trace.push({ phase: 'multi_agent_exec', detail: '無需執行工具步驟', timeMs: Date.now() - phaseStart8 });
  }

  // ── Phase 9: 組合最終回答用的 context ──
  const allContext: string[] = [];

  // 記憶上下文
  if (relevantMemory) allContext.push(`[記憶]\n${relevantMemory}`);

  // 知識圖譜上下文
  if (graphContext.summary) allContext.push(`[知識圖譜]\n${graphContext.summary}`);

  // 檢索結果
  const toolRetrieval = retrievals.filter(r => r.sourceType === 'tool_data');
  if (toolRetrieval.length > 0) {
    allContext.push(`[資料]\n${toolRetrieval.map(r => r.content).join('\n')}`);
  }

  // 構建與 AgentQueryResult 互操作的結果
  const agentQueryResult: AgentQueryResult = {
    intents,
    results: toolResults.map((r, i) => ({
      tool: executedPlan[i]?.tool || 'unknown',
      result: r,
      reason: executedPlan[i]?.description || '',
    })),
    totalTimeMs: Date.now() - startTime,
    contextText: allContext.join('\n\n'),
    executedActions: toolResults
      .filter(r => executedPlan.some(s => s.tool && intents.some(i => i.isWrite && i.tool === s.tool)))
      .map((r, i) => ({
        tool: executedPlan[i]?.tool || 'unknown',
        result: r,
        reason: executedPlan[i]?.description || '',
      })),
    failedActions: executedPlan
      .filter(s => s.status === 'failed')
      .map(s => ({
        tool: s.tool || 'unknown',
        reason: s.description,
        missingInfo: s.result?.error || '執行失敗',
      })),
    pendingWriteActions: [],
  };

  // 記憶更新
  const memoryUpdates: MemoryEntry[] = [];
  for (const r of toolResults) {
    if (r.success) {
      const entry = memoryManager.add({
        content: r.summary,
        type: 'task_result',
        importance: 0.6,
        timestamp: Date.now(),
        tags: ['tool_result'],
        source: 'tool_result',
      });
      memoryUpdates.push(entry);
    }
  }

  return {
    answer: allContext.join('\n\n'),
    plan: executedPlan,
    agentRoute: primaryAgent,
    memoryUpdates,
    retrievals,
    ragStrategy,
    graphContext: graphContext.summary || undefined,
    totalTimeMs: Date.now() - startTime,
    debugTrace: trace,
    agentQueryResult,
  };
}

// ════════════════════════════════════════════════════════════
// X. 高階入口：Orchestrator + Reflexion 整合
// ════════════════════════════════════════════════════════════

/**
 * 完整的編排查詢 — 整合 9 大設計模式 + Reflexion
 *
 * 使用方式（取代原先的 autonomousQueryWithReflexion）：
 *   const result = await orchestratedQuery(message, ctx, modelInference, history);
 */
export async function orchestratedQuery(
  message: string,
  ctx: { userId?: string; schoolId: string; role?: CampusActorRole },
  modelInference?: (prompt: string) => Promise<string>,
  conversationHistory: ConversationTurn[] = [],
): Promise<AgentQueryResult & {
  orchestratorTrace: DebugTraceEntry[];
  ragStrategy: RAGStrategy;
  agentRoute: SubAgentType;
  graphContext?: string;
}> {
  // Step 1: 嘗試技能快取（最快路徑）
  const cachedSkill = findLearnedSkill(message);
  if (cachedSkill && cachedSkill.successCount >= 2) {
    const execCtx: ExecutorContext = {
      userId: ctx.userId,
      schoolId: ctx.schoolId,
      role: ctx.role,
      lastUserMessage: message,
    };
    try {
      const skillResult = await executeLearnedSkill(cachedSkill, execCtx);
      if (skillResult.success) {
        return {
          intents: [],
          results: [{ tool: cachedSkill.tool, result: skillResult, reason: '(技能快取) ' + cachedSkill.description }],
          totalTimeMs: 0,
          contextText: skillResult.summary,
          executedActions: cachedSkill.steps
            ? [{ tool: cachedSkill.tool, result: skillResult, reason: '技能快取命中' }]
            : [],
          failedActions: [],
          pendingWriteActions: [],
          orchestratorTrace: [{ phase: 'skill_cache', detail: '快取命中', timeMs: 0 }],
          ragStrategy: 'direct',
          agentRoute: 'general',
        };
      }
    } catch {
      // 技能執行失敗 → 正常流程
    }
  }

  // Step 2: 編排器主流程
  const orchResult = await orchestrate(message, ctx, modelInference, conversationHistory);

  // Step 3: 如果編排器也沒好結果 → Reflexion fallback
  const hasGoodResult = orchResult.agentQueryResult &&
    (orchResult.agentQueryResult.contextText.length > 10 || orchResult.agentQueryResult.executedActions.length > 0);

  if (!hasGoodResult && modelInference) {
    // 回退到 autonomousQueryWithReflexion（它有自己的 reflexion loop）
    const reflexionResult = await autonomousQueryWithReflexion(
      message, ctx, modelInference, conversationHistory,
    );

    // 合併 orchestrator 的記憶 + 圖譜上下文
    let mergedContext = reflexionResult.contextText || '';
    if (orchResult.graphContext) {
      mergedContext = mergedContext
        ? `${mergedContext}\n\n${orchResult.graphContext}`
        : orchResult.graphContext;
    }

    return {
      ...reflexionResult,
      contextText: mergedContext,
      orchestratorTrace: orchResult.debugTrace,
      ragStrategy: orchResult.ragStrategy,
      agentRoute: orchResult.agentRoute,
      graphContext: orchResult.graphContext,
    };
  }

  // Step 4: 如果編排器還是沒結果 + 是寫入意圖 → 探索學習
  const noResult = !hasGoodResult;
  const isWrite = /幫我|我要|請.*假|報修|維修|預約|借.*書|續借|還書|取消|退選|發.*訊|繳交|報名|下單|加.*行程|新增|刪除|修改|訂.*[碗份個杯]|點.*[碗份個杯]|買.*[碗份個杯]/.test(message);

  if (noResult && isWrite && modelInference) {
    try {
      const exploration = await exploreAndLearn(message, ctx, modelInference);
      if (exploration.success) {
        const explorationResult: AgentQueryResult = {
          intents: orchResult.agentQueryResult?.intents || [],
          results: [],
          totalTimeMs: Date.now() - (Date.now() - orchResult.totalTimeMs),
          contextText: exploration.result,
          executedActions: [{
            tool: 'exploration',
            result: { success: true, summary: exploration.result },
            reason: '(自主學習) 探索完成',
          }],
          failedActions: [],
          pendingWriteActions: [],
        };
        return {
          ...explorationResult,
          orchestratorTrace: orchResult.debugTrace,
          ragStrategy: orchResult.ragStrategy,
          agentRoute: orchResult.agentRoute,
          graphContext: orchResult.graphContext,
        };
      }
    } catch {
      // 探索失敗不影響
    }
  }

  // Step 5: 返回編排器結果
  const finalResult = orchResult.agentQueryResult || {
    intents: [],
    results: [],
    totalTimeMs: orchResult.totalTimeMs,
    contextText: orchResult.answer,
    executedActions: [],
    failedActions: [],
    pendingWriteActions: [],
  };

  return {
    ...finalResult,
    orchestratorTrace: orchResult.debugTrace,
    ragStrategy: orchResult.ragStrategy,
    agentRoute: orchResult.agentRoute,
    graphContext: orchResult.graphContext,
  };
}

// ════════════════════════════════════════════════════════════
// XI. Context Builder — 為 LLM prompt 提供豐富上下文
// ════════════════════════════════════════════════════════════

/**
 * 建構編排器增強的系統 prompt 區段
 * 讓本地 LLM 知道有哪些上下文可用
 */
/** 供本機 LLM system prompt：濃縮 orchestratedQuery 延伸欄位 */
export function buildOrchestratedQueryDigest(
  result: AgentQueryResult & {
    orchestratorTrace?: DebugTraceEntry[];
    ragStrategy?: RAGStrategy;
    agentRoute?: SubAgentType;
    graphContext?: string;
  },
): string | undefined {
  const trace = result.orchestratorTrace;
  const hasMeta =
    (trace && trace.length > 0) ||
    !!result.ragStrategy ||
    !!result.agentRoute ||
    !!(result.graphContext && result.graphContext.trim());
  if (!hasMeta) return undefined;
  const lines: string[] = [
    '【Agentic 編排摘要：Planning／Supervisor／Adaptive-RAG／CRAG／GraphRAG】',
  ];
  if (result.ragStrategy) lines.push(`- RAG 策略: ${result.ragStrategy}`);
  if (result.agentRoute) lines.push(`- 監督路由: ${result.agentRoute}`);
  if (trace?.length) {
    lines.push(`- 階段: ${trace.map((t) => `${t.phase}(${t.timeMs}ms)`).join(' → ')}`);
  }
  const gc = result.graphContext?.trim();
  if (gc) {
    lines.push(`- 圖譜上下文: ${gc.length > 300 ? `${gc.slice(0, 300)}…` : gc}`);
  }
  return lines.join('\n');
}

export function buildOrchestratorContextSection(
  orchResult: OrchestratorResult,
): string {
  const sections: string[] = [];

  // 策略標籤
  sections.push(`[策略] ${orchResult.ragStrategy} | 路由: ${orchResult.agentRoute}`);

  // 記憶上下文
  const workingMem = memoryManager.formatWorkingMemory();
  if (workingMem) {
    sections.push(`[工作記憶]\n${workingMem}`);
  }

  // 知識圖譜
  if (orchResult.graphContext) {
    sections.push(orchResult.graphContext);
  }

  // 計劃執行摘要
  if (orchResult.plan && orchResult.plan.length > 0) {
    const planSummary = orchResult.plan.map(s =>
      `${s.id + 1}. [${s.status}] ${s.description}${s.result ? ` → ${s.result.summary}` : ''}`,
    ).join('\n');
    sections.push(`[執行計劃]\n${planSummary}`);
  }

  // 檢索結果
  const toolData = orchResult.retrievals.filter(r => r.sourceType === 'tool_data');
  if (toolData.length > 0) {
    sections.push(`[檢索資料]\n${toolData.map(r => r.content).join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * 匯出序列化方法（持久化記憶 + 圖譜）
 */
export function serializeOrchestratorState(): {
  memory: MemoryEntry[];
  graph: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] };
} {
  return {
    memory: memoryManager.getLongTermEntries(),
    graph: knowledgeGraph.serialize(),
  };
}

/**
 * 載入序列化的狀態
 */
export function loadOrchestratorState(state: {
  memory?: MemoryEntry[];
  graph?: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] };
}): void {
  if (state.memory) memoryManager.loadLongTerm(state.memory);
  if (state.graph) knowledgeGraph.load(state.graph);
}
