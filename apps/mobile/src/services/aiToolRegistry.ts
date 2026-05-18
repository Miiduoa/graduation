/**
 * AI Tool Registry — 全域 Action Executor / 統一工具層
 * ═══════════════════════════════════════════════════════════
 *
 * 設計目標（4 階段）：
 * 1. 工具標準化：每一個 AI 可操作的功能，都用 ToolSpec 明確定義必填/選填欄位、
 *    預設值、角色政策、是否寫入、錯誤碼。
 * 2. 全域 Action 執行層：executeToolStandard() 是唯一入口；接收 { toolName,
 *    args, userId, role, schoolId }，做 role policy / 預設值 / choiceMenu
 *    index 解析 / 校驗，再呼叫底層 handler，回傳統一格式
 *    { success, summary, data, errorCode, isWrite, isDraft, missingInfo,
 *      choiceMenu }。
 * 3. 自然語言 → 參數補齊：負責把「幫我點第 2 個」、缺數量、缺時段等情境，
 *    用 lastChoiceMenu 與預設值補齊；不確定時回 missingInfo 讓 AI 追問。
 * 4. 草稿 / 真送清楚分開：
 *    - success && isWrite === true && !isDraft  →「已為你完成 ...」
 *    - success && isDraft === true              →「幫你整理好了，請到 X 頁送出」
 *    - !success && errorCode === 'missing_info' →「我還缺 ...」
 *
 * 重點：AI 端只能透過此 registry 呼叫工具；不再直接碰 Firestore / DataSource。
 */

import { getDataSource, hasDataSource } from '../data/source';
import {
  getPuDiningCafeterias,
  getPuDiningMenuItems,
  isProvidenceDiningSchoolId,
} from '../data/puDiningCatalog';
import type {
  AssistantChoiceMenu,
  CampusActorRole,
  Cafeteria,
  MenuItem,
} from '../data/types';
import type { LearnedSkill } from '../data/puAIAgentData';
import { getCloudFunctionRegion, getFirebaseApp } from '../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  executeTool as executeLegacyTool,
  type ExecutorContext as LegacyExecutorContext,
  type ToolCallResult,
} from './aiAgentTools';

// ════════════════════════════════════════════════════════════
// Stage 1：標準化型別契約
// ════════════════════════════════════════════════════════════

export type ToolKind = 'read' | 'write' | 'cross_role_write';

export type ToolErrorCode =
  | 'auth_required'
  | 'school_required'
  | 'role_denied'
  | 'missing_info'
  | 'ambiguous_choice'
  | 'not_found'
  | 'precondition_failed'
  | 'offline'
  | 'tool_not_found'
  | 'execution_failed'
  | 'unknown';

export type ToolMissingField = {
  field: string;
  prompt: string;
  type?: ToolFieldType;
  example?: string;
};

export type StandardToolResult = {
  success: boolean;
  toolName: string;
  summary: string;
  data?: unknown;
  errorCode?: ToolErrorCode;
  error?: string;
  /** 此 tool 在語意上是否為寫入型（與 success 無關） */
  isWrite: boolean;
  /** 是否只建立了草稿/排隊任務，尚未真寫入。配合 success === true 使用 */
  isDraft: boolean;
  /** 缺欄位時 AI 應追問使用者；missingInfo 為空表示沒問題或屬其他錯誤 */
  missingInfo?: ToolMissingField[];
  choiceMenu?: AssistantChoiceMenu;
  learnedSkill?: LearnedSkill;
  recordId?: string;
};

export type ToolFieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date' // YYYY-MM-DD
  | 'datetime' // ISO 8601
  | 'time' // HH:mm
  | 'enum'
  | 'string_list';

export type ToolFieldSpec = {
  name: string;
  description: string;
  type: ToolFieldType;
  required?: boolean;
  enum?: readonly string[];
  /** 缺值時要不要追問；若有 default 則不追問 */
  default?: unknown | ((ctx: ToolExecutionContext) => unknown);
  promptIfMissing?: string;
  example?: string;
};

export type ToolExecutionContext = {
  userId?: string;
  schoolId: string;
  role?: CampusActorRole;
  /** 使用者本次自然語言原文，用於補齊缺漏資訊與技能蒸餾 */
  lastUserMessage?: string;
  /** 上一輪 AI 提供的 choiceMenu，用於把「第 N 個」轉成真實 ID */
  lastChoiceMenu?: AssistantChoiceMenu;
  /** 是否離線（讀取 ai.ts 自有狀態時可注入） */
  isOnline?: boolean;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<StandardToolResult>;

export type ToolParametersSpec = {
  type: 'object';
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
};

export type ToolSpec = {
  name: string;
  aliases?: readonly string[];
  description: string;
  kind: ToolKind;
  fields: readonly ToolFieldSpec[];
  /** 給模型看的標準 function-calling schema；新工具先在 registry 定義。 */
  parameters?: ToolParametersSpec;
  /** 角色允許清單；未列出的角色會被 role_denied */
  allowedRoles: readonly CampusActorRole[];
  /** 是否需要登入；預設依 kind: write/cross_role_write 須登入 */
  requiresAuth?: boolean;
  /** 是否需要 schoolId；預設依 kind: write 須有 */
  requiresSchool?: boolean;
  handler: ToolHandler;
};

// ════════════════════════════════════════════════════════════
// 共用 helpers
// ════════════════════════════════════════════════════════════

function makeFailure(
  toolName: string,
  errorCode: ToolErrorCode,
  summary: string,
  extra?: Partial<StandardToolResult>,
): StandardToolResult {
  return {
    success: false,
    toolName,
    summary,
    errorCode,
    isWrite: false,
    isDraft: false,
    ...extra,
  };
}

function makeMissingInfo(
  toolName: string,
  fields: ToolMissingField[],
  isWrite: boolean,
): StandardToolResult {
  const head = fields[0];
  const summary = head
    ? head.prompt ?? `我還需要「${head.field}」才能執行 ${toolName}。`
    : `我還缺一些資訊才能執行 ${toolName}。`;
  return {
    success: false,
    toolName,
    summary,
    errorCode: 'missing_info',
    isWrite,
    isDraft: false,
    missingInfo: fields,
  };
}

function asString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  return '';
}

function asInt(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function normalize(v: unknown): string {
  return asString(v)
    .toLowerCase()
    .replace(/[\s｜|、，,。．.（）()【】\[\]{}「」『』\-—_]/g, '');
}

function parseOrdinalIndex(text?: string): number | null {
  if (!text) return null;
  const t = text.trim();
  const ordinalMap: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  const cn = t.match(/第\s*([一二三四五六七八九十0-9]+)\s*(個|筆|項|份)?/);
  if (cn) {
    const raw = cn[1];
    const n = ordinalMap[raw] ?? parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const arabic = t.match(/(?:^|[^0-9])(\d+)\s*(個|筆|項|份)?/);
  if (arabic) {
    const n = parseInt(arabic[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * 把 args.selectedIndex / args.index 或 lastUserMessage「第 N 個」解析成
 * lastChoiceMenu 的 option id，攤平到 args 後給 handler 用。
 */
function applyChoiceMenuResolution(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Record<string, unknown> {
  const out = { ...args };

  let idx: number | null = null;
  const explicit =
    out.selectedIndex ?? out.optionIndex ?? out.index ?? out.choiceIndex;
  if (explicit != null && asString(explicit) !== '') {
    const n = asInt(explicit, 0);
    if (n > 0) idx = n;
  }

  if (idx == null && ctx.lastUserMessage) {
    idx = parseOrdinalIndex(ctx.lastUserMessage);
  }

  if (idx == null) return out;

  const menu = ctx.lastChoiceMenu;
  const opt = menu?.options?.[idx - 1];
  if (!opt) return out;

  out._resolvedChoiceOptionId = opt.id;
  out._resolvedChoiceLabel = opt.label;

  // 解析 option.id 為 (itemId, vendorId)。支援兩種既有格式：
  //   1. canonical：`itemId@@vendorId`
  //   2. legacy   ：`ord-N-itemId` 或 `pick-N-itemId`
  const parsed = (() => {
    const s = String(opt.id);
    const parts = s.split('@@');
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return { itemId: parts[0].trim(), vendorId: parts[1].trim() };
    }
    const m = s.match(/^(?:ord|pick)-\d+-(.+)$/);
    if (m?.[1]) return { itemId: m[1].trim(), vendorId: '' };
    return { itemId: s.trim(), vendorId: '' };
  })();
  if (out.itemId == null || asString(out.itemId) === '') out.itemId = parsed.itemId;
  if (parsed.vendorId && (out.vendorId == null || asString(out.vendorId) === '')) {
    out.vendorId = parsed.vendorId;
  }
  return out;
}

function fieldHasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function applyDefaults(
  spec: ToolSpec,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Record<string, unknown> {
  const out = { ...args };
  for (const field of spec.fields) {
    if (fieldHasValue(out[field.name])) continue;
    if (field.default !== undefined) {
      const value =
        typeof field.default === 'function'
          ? (field.default as (c: ToolExecutionContext) => unknown)(ctx)
          : field.default;
      if (fieldHasValue(value)) out[field.name] = value;
    }
  }
  return out;
}

function checkMissing(
  spec: ToolSpec,
  args: Record<string, unknown>,
): ToolMissingField[] {
  const missing: ToolMissingField[] = [];
  for (const field of spec.fields) {
    if (!field.required) continue;
    if (fieldHasValue(args[field.name])) continue;
    missing.push({
      field: field.name,
      prompt:
        field.promptIfMissing ?? `請告訴我「${field.description}」。`,
      type: field.type,
      example: field.example,
    });
  }
  return missing;
}

function isValidDateString(value: string): boolean {
  // 接受 YYYY-MM-DD 或 YYYY/MM/DD
  const m = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) {
    // 也接受 ISO datetime
    const d = new Date(value);
    return !Number.isNaN(d.getTime());
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  if (da < 1 || da > 31) return false;
  const dt = new Date(y, mo - 1, da);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === da;
}

function isValidTimeString(value: string): boolean {
  return /^([01]?\d|2[0-3])[:：]([0-5]\d)$/.test(value);
}

function checkInvalid(
  spec: ToolSpec,
  args: Record<string, unknown>,
): ToolMissingField[] {
  const invalid: ToolMissingField[] = [];
  for (const field of spec.fields) {
    const value = args[field.name];
    if (!fieldHasValue(value)) continue;

    // ── 整數 / 數值校驗 ──
    if (field.type === 'integer' || field.type === 'number') {
      const n = Number(asString(value));
      if (!Number.isFinite(n) || (field.type === 'integer' && !Number.isInteger(n))) {
        invalid.push({
          field: field.name,
          prompt: `請提供有效的「${field.description}」。`,
          type: field.type,
          example: field.example,
        });
        continue;
      }
      // 數量、copies、份數類 → 必須 ≥ 1
      if (/^(quantity|copies|count|num|數量|份數)$/i.test(field.name) && n < 1) {
        invalid.push({
          field: field.name,
          prompt: `「${field.description}」必須 ≥ 1。`,
          type: field.type,
          example: field.example ?? '1',
        });
        continue;
      }
      // grade 分數合理範圍 0-100
      if (field.name === 'grade' && (n < 0 || n > 100)) {
        invalid.push({
          field: field.name,
          prompt: `分數應介於 0–100。`,
          type: field.type,
          example: '85',
        });
        continue;
      }
    }

    // ── 日期校驗 ──
    if (field.type === 'date') {
      const raw = asString(value);
      if (!isValidDateString(raw)) {
        invalid.push({
          field: field.name,
          prompt: `「${field.description}」日期格式不正確，請給合法的 YYYY-MM-DD（例：2026-05-13）。`,
          type: field.type,
          example: field.example ?? '2026-05-13',
        });
        continue;
      }
    }

    // ── 時間校驗 ──
    if (field.type === 'time') {
      const raw = asString(value);
      if (!isValidTimeString(raw)) {
        invalid.push({
          field: field.name,
          prompt: `「${field.description}」時間格式不正確，請用 HH:mm（例：14:30）。`,
          type: field.type,
          example: field.example ?? '14:30',
        });
        continue;
      }
    }

    // ── datetime 校驗 ──
    if (field.type === 'datetime') {
      const d = new Date(asString(value));
      if (Number.isNaN(d.getTime())) {
        invalid.push({
          field: field.name,
          prompt: `「${field.description}」日期時間無效，請給 ISO 8601 或 YYYY-MM-DD HH:mm。`,
          type: field.type,
          example: field.example,
        });
        continue;
      }
    }
  }

  // ── 區間日期校驗：from <= to / startDate <= endDate ──
  const datePairs: Array<[string, string]> = [
    ['from', 'to'],
    ['startDate', 'endDate'],
    ['fromDate', 'toDate'],
    ['begin', 'end'],
  ];
  for (const [fromKey, toKey] of datePairs) {
    const f = asString(args[fromKey]);
    const t = asString(args[toKey]);
    if (f && t) {
      const fd = new Date(f);
      const td = new Date(t);
      if (!Number.isNaN(fd.getTime()) && !Number.isNaN(td.getTime()) && fd.getTime() > td.getTime()) {
        invalid.push({
          field: toKey,
          prompt: `結束日期（${toKey}）不能早於開始日期（${fromKey}）。`,
          type: 'date',
        });
      }
    }
  }

  return invalid;
}

function isWriteKind(kind: ToolKind): boolean {
  return kind === 'write' || kind === 'cross_role_write';
}

function summaryDraft(spec: ToolSpec, lines: string[]): string {
  const head =
    spec.kind === 'write'
      ? `已幫你準備好「${spec.name}」草稿，尚未送出。`
      : `${spec.name} 草稿已建立，請到對應頁面送出。`;
  return [head, ...lines].filter(Boolean).join('\n');
}

function summaryDone(spec: ToolSpec, lines: string[]): string {
  return [`已為你完成「${spec.name}」。`, ...lines].filter(Boolean).join('\n');
}

// ════════════════════════════════════════════════════════════
// 預設值（共用）
// ════════════════════════════════════════════════════════════

function defaultTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultIn30Min(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30, 0, 0);
  return d.toISOString();
}

function parseTimeOrIso(value: unknown): string {
  const raw = asString(value);
  if (!raw) return defaultIn30Min();
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const m = raw.match(/^(\d{1,2})[:：](\d{2})$/);
  if (m) {
    const d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  return defaultIn30Min();
}

// ════════════════════════════════════════════════════════════
// Stage 3 / 4：每個 canonical tool 的 handler
// ════════════════════════════════════════════════════════════

// ── helper：菜單 + 餐廳 載入（與 aiAgentTools.create_order 一致邏輯）
async function loadMenusAndCafeterias(
  schoolId: string,
): Promise<{ menus: MenuItem[]; cafeterias: Cafeteria[]; remoteCafeteriaIds: Set<string> }> {
  const menus: MenuItem[] = [];
  const cafeterias: Cafeteria[] = [];
  const remoteCafeteriaIds = new Set<string>();

  if (hasDataSource()) {
    try {
      const ds = getDataSource();
      const fsMenus = await ds.listMenus(schoolId);
      if (fsMenus?.length) menus.push(...fsMenus);
    } catch {
      /* ignore */
    }
    try {
      const ds = getDataSource();
      const fsCafs = await ds.listCafeterias(schoolId);
      if (fsCafs?.length) {
        cafeterias.push(...fsCafs);
        for (const c of fsCafs) remoteCafeteriaIds.add(c.id);
      }
    } catch {
      /* ignore */
    }
  }

  if (isProvidenceDiningSchoolId(schoolId)) {
    const localMenus = getPuDiningMenuItems(schoolId);
    if (localMenus?.length) {
      const existing = new Set(menus.map((m) => normalize(m.id)));
      for (const m of localMenus) {
        if (!existing.has(normalize(m.id))) menus.push(m);
      }
    }
    const localCafs = getPuDiningCafeterias(schoolId);
    if (localCafs?.length) {
      const existing = new Set(cafeterias.map((c) => c.id));
      for (const c of localCafs) {
        if (!existing.has(c.id)) cafeterias.push(c);
      }
    }
  }

  return { menus, cafeterias, remoteCafeteriaIds };
}

// ── order_food
async function orderFoodHandler(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<StandardToolResult> {
  const itemId = asString(args.itemId);
  const vendorId = asString(args.vendorId);
  const quantity = Math.max(1, asInt(args.quantity, 1));
  const note = asString(args.note);

  try {
    const functions = getFunctions(getFirebaseApp(), getCloudFunctionRegion());
    const callable = httpsCallable<
      {
        userId: string;
        schoolId: string;
        vendorId: string;
        itemId: string;
        quantity: number;
        note: string;
      },
      {
        orderNo: string;
        vendorName?: string;
        itemName?: string;
        quantity?: number;
        note?: string;
        status?: string;
      }
    >(functions, 'aiOrderFood');
    const res = await callable({
      userId: ctx.userId!,
      schoolId: ctx.schoolId,
      vendorId,
      itemId,
      quantity,
      note,
    });
    const order = res.data ?? {};
    const vendorName = asString((order as any).vendorName) || '指定店家';
    const itemName = asString((order as any).itemName) || '指定品項';
    const orderNo = asString((order as any).orderNo) || asString((order as any).id) || '已建立';
    const finalQty = Math.max(1, asInt((order as any).quantity, quantity));

    return {
      success: true,
      toolName: 'order_food',
      summary: `已為你向「${vendorName}」訂購「${itemName}」${finalQty} 份，訂單編號 ${orderNo}。`,
      data: order,
      isWrite: true,
      isDraft: false,
      recordId: orderNo,
    };
  } catch (e: any) {
    const code = String(e?.code ?? '').toLowerCase();
    const msg = String(e?.message ?? e ?? '').trim();
    if (code.includes('not-found')) {
      return makeFailure(
        'order_food',
        'not_found',
        '找不到菜單品項或餐廳資料，請重新選擇餐點後再試。',
        { isWrite: true, error: msg || code },
      );
    }
    if (code.includes('failed-precondition')) {
      return makeFailure(
        'order_food',
        'precondition_failed',
        '訂餐失敗：餐廳可能暫停接單或尚未開通線上接單。',
        { isWrite: true, error: msg || code },
      );
    }
    return makeFailure(
      'order_food',
      'execution_failed',
      '訂餐失敗，可能是餐廳暫停接單或網路異常。',
      { isWrite: true, error: msg },
    );
  }
}

// ── reserve_seat
async function reserveSeatHandler(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<StandardToolResult> {
  if (!hasDataSource()) {
    return makeFailure('reserve_seat', 'offline', '目前無法連到圖書館系統。', { isWrite: true });
  }
  try {
    const ds = getDataSource();
    const areaId = asString(args.areaId);
    const date = asString(args.date) || defaultTodayIso();
    const startTime = asString(args.startTime) || '10:00';
    const endTime = asString(args.endTime) || '12:00';

    let seats: any[] = [];
    try {
      seats = await ds.listSeats(ctx.schoolId, areaId || undefined);
    } catch {
      seats = [];
    }

    let chosen = seats.find((s: any) => s.id === areaId || s.seatNumber === areaId);
    if (!chosen) {
      chosen =
        seats.find((s: any) => s.status === 'available' && (!areaId || s.zone === areaId || s.floor === areaId)) ??
        seats.find((s: any) => s.status === 'available');
    }
    if (!chosen) {
      return makeFailure(
        'reserve_seat',
        'not_found',
        '目前找不到可預約的座位/區域。',
        { isWrite: true },
      );
    }

    const reservation = await ds.reserveSeat(
      chosen.id,
      ctx.userId!,
      date,
      startTime,
      endTime,
      ctx.schoolId,
    );
    return {
      success: true,
      toolName: 'reserve_seat',
      summary: [
        `已為你預約圖書館座位。`,
        `座位：${chosen.name ?? chosen.seatNumber ?? chosen.id}`,
        `日期：${date}`,
        `時段：${startTime}-${endTime}`,
      ].join('\n'),
      data: reservation,
      isWrite: true,
      isDraft: false,
      recordId: reservation.id,
    };
  } catch (e: any) {
    return makeFailure(
      'reserve_seat',
      'execution_failed',
      `預約失敗：${e?.message ?? '未知錯誤'}`,
      { isWrite: true, error: String(e?.message ?? e) },
    );
  }
}

// ── borrow_book
async function borrowBookHandler(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<StandardToolResult> {
  if (!hasDataSource()) {
    return makeFailure('borrow_book', 'offline', '目前無法連到圖書館系統。', { isWrite: true });
  }
  try {
    const ds = getDataSource();
    const bookId = asString(args.bookId);
    const loan = await ds.borrowBook(bookId, ctx.userId!, ctx.schoolId);
    return {
      success: true,
      toolName: 'borrow_book',
      summary: `已為你借閱書籍（bookId=${bookId}）。借閱編號：${loan.id}`,
      data: loan,
      isWrite: true,
      isDraft: false,
      recordId: loan.id,
    };
  } catch (e: any) {
    return makeFailure(
      'borrow_book',
      'execution_failed',
      `借書失敗：${e?.message ?? '未知錯誤'}`,
      { isWrite: true, error: String(e?.message ?? e) },
    );
  }
}

// ── create_repair_request
async function createRepairRequestHandler(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<StandardToolResult> {
  if (!hasDataSource()) {
    return makeFailure('create_repair_request', 'offline', '目前無法連到報修系統。', {
      isWrite: true,
    });
  }
  try {
    const ds = getDataSource();
    const type = asString(args.type) || 'other';
    const room = asString(args.room);
    const description = asString(args.description) || asString(ctx.lastUserMessage) || 'AI 代理建立的報修申請';
    const title =
      asString(args.title) || `${type === 'ac' ? '冷氣' : type === 'plumbing' ? '水電' : '宿舍'}報修`;

    const repair = await ds.createRepairRequest({
      userId: ctx.userId!,
      schoolId: ctx.schoolId,
      type: type as any,
      title,
      description,
      room,
      priority: 'normal',
    } as any);

    return {
      success: true,
      toolName: 'create_repair_request',
      summary: [
        `已為你提交報修工單。`,
        `工單編號：${repair.id}`,
        `房號：${repair.room}`,
        `問題：${title}`,
        `狀態：${repair.status}`,
      ].join('\n'),
      data: repair,
      isWrite: true,
      isDraft: false,
      recordId: repair.id,
    };
  } catch (e: any) {
    return makeFailure(
      'create_repair_request',
      'execution_failed',
      `報修失敗：${e?.message ?? '未知錯誤'}`,
      { isWrite: true, error: String(e?.message ?? e) },
    );
  }
}

// ── request_leave（沿用既有 aiAgentTools 的請假邏輯，統一回傳）
async function requestLeaveHandler(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<StandardToolResult> {
  const legacyArgs: Record<string, string> = {
    courseName: asString(args.courseId), // 既有 tool 用 courseName，先盡量映過去
    date: asString(args.date),
    reason: asString(args.reason),
    leaveType: asString(args.leaveType),
  };
  const legacyCtx: LegacyExecutorContext = {
    userId: ctx.userId,
    schoolId: ctx.schoolId,
    role: ctx.role,
    lastUserMessage: ctx.lastUserMessage,
  };
  const result = await executeLegacyTool('request_leave', legacyArgs, legacyCtx);
  return wrapLegacyResult('request_leave', result, /*kind*/ 'cross_role_write');
}

// ── create_reminder（行事曆事件）
async function createReminderHandler(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<StandardToolResult> {
  if (!hasDataSource()) {
    return makeFailure('create_reminder', 'offline', '目前無法寫入行事曆。', { isWrite: true });
  }
  try {
    const ds = getDataSource();
    const title = asString(args.title);
    const startIso = parseTimeOrIso(args.time);
    const endIso = new Date(new Date(startIso).getTime() + 30 * 60 * 1000).toISOString();
    const source = asString(args.source) || 'ai_assistant';

    const event = await ds.createCalendarEvent({
      userId: ctx.userId!,
      schoolId: ctx.schoolId,
      title,
      description: `來源：${source}`,
      startAt: startIso,
      endAt: endIso,
      allDay: false,
      type: 'personal',
      sourceType: 'custom',
      reminder: 0,
    } as any);

    return {
      success: true,
      toolName: 'create_reminder',
      summary: [
        `已為你建立提醒。`,
        `標題：${title}`,
        `時間：${new Date(startIso).toLocaleString('zh-TW')}`,
        `提醒編號：${event.id}`,
      ].join('\n'),
      data: event,
      isWrite: true,
      isDraft: false,
      recordId: event.id,
    };
  } catch (e: any) {
    return makeFailure(
      'create_reminder',
      'execution_failed',
      `建立提醒失敗：${e?.message ?? '未知錯誤'}`,
      { isWrite: true, error: String(e?.message ?? e) },
    );
  }
}

// ── send_message
//   接受 canonical { text, targets, conversationId } 與 legacy { content, peerId,
//   recipientId, conversationId } 兩種欄位，避免 AI 用舊名打到 registry 時被擋。
async function sendMessageHandler(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<StandardToolResult> {
  if (!hasDataSource()) {
    return makeFailure('send_message', 'offline', '目前無法送出訊息。', { isWrite: true });
  }
  try {
    const ds = getDataSource();
    const text = asString(args.text || args.content);
    let conversationId = asString(args.conversationId);
    const targetsCandidate = args.targets ?? args.peerId ?? args.recipientId ?? args.userId;
    const targets: string[] = Array.isArray(targetsCandidate)
      ? targetsCandidate.map(asString).filter(Boolean)
      : asString(targetsCandidate)
          .split(/[,，、\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);

    if (!text) {
      return makeMissingInfo(
        'send_message',
        [{ field: 'text', prompt: '想傳什麼內容呢？', type: 'string' }],
        true,
      );
    }
    if (!conversationId) {
      if (targets.length === 0) {
        return makeMissingInfo(
          'send_message',
          [
            {
              field: 'targets',
              prompt: '請告訴我要傳給誰（學號或使用者 ID）。',
              type: 'string_list',
            },
          ],
          true,
        );
      }
      const convo = await ds.createConversation([ctx.userId!, ...targets], ctx.schoolId);
      conversationId = convo.id;
    }

    const msg = await ds.sendMessage({
      conversationId,
      senderId: ctx.userId!,
      content: text,
      type: 'text',
      readBy: [ctx.userId!],
    } as any);

    return {
      success: true,
      toolName: 'send_message',
      summary: `已送出訊息（訊息編號 ${msg.id}）。`,
      data: msg,
      isWrite: true,
      isDraft: false,
      recordId: msg.id,
    };
  } catch (e: any) {
    return makeFailure(
      'send_message',
      'execution_failed',
      `送出訊息失敗：${e?.message ?? '未知錯誤'}`,
      { isWrite: true, error: String(e?.message ?? e) },
    );
  }
}

// ── 通用：包裝舊版 ToolCallResult 成 StandardToolResult
//
// 判斷 isDraft 的邏輯（對 write/cross_role_write 工具）：
//   1. 有 choiceMenu → 必須讓使用者挑選 → 草稿
//   2. raw.isWrite === false 且 raw.success === true → 工具自己標明「沒實際寫入」→ 草稿
//   3. 否則 → 真正寫入完成
function wrapLegacyResult(
  toolName: string,
  raw: ToolCallResult,
  kind: ToolKind,
): StandardToolResult {
  const isWriteSemantic = isWriteKind(kind);
  let isDraft = false;
  if (isWriteSemantic && raw.success) {
    if (raw.choiceMenu) isDraft = true;
    else if (raw.isWrite === false) isDraft = true;
  }
  return {
    success: !!raw.success,
    toolName,
    summary: raw.summary ?? (raw.success ? '完成' : raw.error ?? '失敗'),
    data: raw.data,
    error: raw.error,
    errorCode: raw.success ? undefined : 'execution_failed',
    isWrite: isWriteSemantic,
    isDraft,
    choiceMenu: raw.choiceMenu,
    learnedSkill: raw.learnedSkill,
  };
}

// ── 把任意舊 tool 包成 ToolHandler
function makeLegacyHandler(
  underlyingName: string,
  kind: ToolKind,
  argMapper?: (args: Record<string, unknown>) => Record<string, string>,
): ToolHandler {
  return async (args, ctx) => {
    const legacyArgs: Record<string, string> = argMapper
      ? argMapper(args)
      : Object.fromEntries(
          Object.entries(args)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, asString(v)]),
        );
    const legacyCtx: LegacyExecutorContext = {
      userId: ctx.userId,
      schoolId: ctx.schoolId,
      role: ctx.role,
      lastUserMessage: ctx.lastUserMessage,
    };
    const result = await executeLegacyTool(underlyingName, legacyArgs, legacyCtx);
    return wrapLegacyResult(underlyingName, result, kind);
  };
}

// ════════════════════════════════════════════════════════════
// Stage 1：Tool Registry — 主功能列表
// ════════════════════════════════════════════════════════════

const ALL_ROLES: readonly CampusActorRole[] = [
  'student',
  'teacher',
  'staff',
  'department',
  'department_head',
  'admin',
  'school',
  'vendor',
];
const TEACHING_ROLES: readonly CampusActorRole[] = [
  'teacher',
  'department_head',
  'admin',
  'school',
];
const SERVICE_ROLES: readonly CampusActorRole[] = [
  'staff',
  'department',
  'department_head',
  'admin',
  'school',
];

const ORDER_FOOD_PARAMETERS: ToolParametersSpec = {
  type: 'object',
  properties: {
    vendorId: {
      type: 'string',
      description: '店家/餐廳 ID。必須是可線上接單的正式店家 ID。',
    },
    itemId: {
      type: 'string',
      description: '餐點 ID。建議由 query_menus 或上一輪 choiceMenu 的選項帶入。',
    },
    quantity: {
      type: 'integer',
      description: '數量，至少 1；省略時預設為 1。',
    },
    note: {
      type: 'string',
      description: '備註，例如不要香菜、少冰等；可省略。',
    },
  },
  required: ['vendorId', 'itemId'],
};

// LMS v2 tool specs — 從外部檔合併進來 (21 個工具,對應 docs/LMS_V2_ROLE_ACTION_MAP.md)
// 任何 LMS 相關的 read/write 都已由 supabaseLmsCache facade 與 lmsV2WriteTools 處理。
// 此處只是把它們註冊到 registry,讓 Agent / LLM 看見。
import { LMS_V2_TOOL_SPECS } from './lmsV2ToolSpecs';

const TOOL_SPECS: readonly ToolSpec[] = [
  ...LMS_V2_TOOL_SPECS,
  // ── 訂餐（canonical：嚴格用 itemId/vendorId；
  //     若 AI 仍使用舊名 create_order/order_meal 則 fallback 走 legacy executor，
  //     因為它們欄位是 itemName/cafeteria，schema 不同）
  {
    name: 'order_food',
    description: '從已開通接單的校園餐廳，依 itemId/vendorId 下單一筆餐點。',
    kind: 'cross_role_write',
    parameters: ORDER_FOOD_PARAMETERS,
    allowedRoles: ['student', 'teacher', 'staff', 'department_head', 'admin'],
    fields: [
      {
        name: 'vendorId',
        description: '店家/餐廳 ID',
        type: 'string',
        required: true,
        promptIfMissing: '請告訴我要訂哪一間餐廳（vendorId 或店家名稱）。',
      },
      {
        name: 'itemId',
        description: '餐點 ID',
        type: 'string',
        required: true,
        promptIfMissing: '請告訴我要點哪一道餐點（itemId 或從選單點擊）。',
      },
      {
        name: 'quantity',
        description: '數量',
        type: 'integer',
        default: 1,
      },
      { name: 'note', description: '備註（如：不要香菜）', type: 'string' },
    ],
    handler: orderFoodHandler,
  },

  // ── 座位（canonical：areaId + startTime + endTime；
  //     legacy reserve_library_seat 用 seatId/date/startTime/endTime，
  //     schema 不同所以不 alias，避免 AI 撞欄位）
  {
    name: 'reserve_seat',
    description: '預約圖書館座位/自習室/討論室。',
    kind: 'cross_role_write',
    allowedRoles: ['student', 'teacher', 'staff'],
    fields: [
      {
        name: 'areaId',
        description: '座位 ID 或區域代號（如 floor:2 / quiet_zone）',
        type: 'string',
        required: true,
        promptIfMissing: '請告訴我要預約哪個座位/區域。',
      },
      {
        name: 'date',
        description: '日期 YYYY-MM-DD',
        type: 'date',
        default: () => defaultTodayIso(),
      },
      {
        name: 'startTime',
        description: '起始時間 HH:mm',
        type: 'time',
        required: true,
        promptIfMissing: '幾點開始要使用座位？（HH:mm）',
        example: '10:00',
      },
      {
        name: 'endTime',
        description: '結束時間 HH:mm',
        type: 'time',
        required: true,
        promptIfMissing: '幾點結束？（HH:mm）',
        example: '12:00',
      },
    ],
    handler: reserveSeatHandler,
  },

  // ── 借書
  {
    name: 'borrow_book',
    description: '對指定 bookId 建立借閱紀錄。',
    kind: 'cross_role_write',
    allowedRoles: ['student', 'teacher', 'staff'],
    fields: [
      {
        name: 'bookId',
        description: '書籍 ID',
        type: 'string',
        required: true,
        promptIfMissing: '請告訴我要借哪一本書（bookId）。',
      },
    ],
    handler: borrowBookHandler,
  },

  // ── 報修
  {
    name: 'create_repair_request',
    description: '建立宿舍/校園維修工單。',
    kind: 'cross_role_write',
    allowedRoles: ['student', 'staff', 'department_head', 'admin'],
    fields: [
      {
        name: 'type',
        description: '報修類型',
        type: 'enum',
        enum: ['electrical', 'plumbing', 'furniture', 'ac', 'network', 'other'],
        default: 'other',
      },
      {
        name: 'room',
        description: '房號/地點',
        type: 'string',
        required: true,
        promptIfMissing: '請告訴我房號或地點，沒有房號我不能直接送出工單。',
      },
      {
        name: 'description',
        description: '問題描述',
        type: 'string',
        required: true,
        promptIfMissing: '請描述目前的問題狀況（例如冷氣不冷、漏水）。',
      },
    ],
    handler: createRepairRequestHandler,
  },

  // ── 請假
  {
    name: 'request_leave',
    description: '針對指定課程/日期建立請假申請。',
    kind: 'cross_role_write',
    allowedRoles: ['student', 'teacher'],
    fields: [
      {
        name: 'courseId',
        description: '課程 ID 或課程名稱（也可留空，由 AI 比對當天課表）',
        type: 'string',
      },
      {
        name: 'date',
        description: '請假日期 YYYY-MM-DD',
        type: 'date',
        default: () => defaultTodayIso(),
      },
      {
        name: 'reason',
        description: '請假原因',
        type: 'string',
        required: true,
        promptIfMissing: '請告訴我請假原因（例如生病、家庭因素）。',
      },
      {
        name: 'leaveType',
        description: '假別',
        type: 'enum',
        enum: ['sick', 'personal', 'official'],
        default: 'personal',
      },
    ],
    handler: requestLeaveHandler,
  },

  // ── 行事曆 / 提醒（canonical：title + time + source；
  //     legacy create_calendar_event 用 title + startAt + endAt + location，
  //     schema 不同；若 AI 仍用舊名走 fallback executor）
  {
    name: 'create_reminder',
    description: '在使用者個人行事曆建立提醒事件。',
    kind: 'write',
    allowedRoles: ALL_ROLES,
    fields: [
      {
        name: 'title',
        description: '事件標題',
        type: 'string',
        required: true,
        promptIfMissing: '請告訴我提醒的標題。',
      },
      {
        name: 'time',
        description: '時間（ISO 8601 或 HH:mm）',
        type: 'datetime',
        default: () => defaultIn30Min(),
      },
      {
        name: 'source',
        description: '來源（assignment/course/ai/manual）',
        type: 'string',
        default: 'ai_assistant',
      },
    ],
    handler: createReminderHandler,
  },

  // ── 訊息
  {
    name: 'send_message',
    description: '發送私訊到指定 conversationId 或建立新對話送給 targets。',
    kind: 'cross_role_write',
    allowedRoles: ['student', 'teacher', 'staff', 'department_head', 'admin'],
    fields: [
      {
        name: 'conversationId',
        description: '對話 ID（若有則直接送）',
        type: 'string',
      },
      {
        name: 'text',
        description: '訊息內容',
        type: 'string',
        required: true,
        promptIfMissing: '想傳什麼內容呢？',
      },
      {
        name: 'targets',
        description: '收件人（學號或 userId 列表，逗號或頓號分隔）',
        type: 'string_list',
      },
    ],
    handler: sendMessageHandler,
  },

  // ── 健康預約
  {
    name: 'create_health_appointment',
    description: '預約衛保/諮商中心看診。',
    kind: 'cross_role_write',
    allowedRoles: ['student', 'teacher', 'staff'],
    fields: [
      {
        name: 'department',
        description: '科別',
        type: 'enum',
        enum: ['general', 'dental', 'counseling', 'physical_therapy', 'mental'],
        default: 'general',
      },
      {
        name: 'date',
        description: '日期',
        type: 'date',
        required: true,
        promptIfMissing: '想預約哪一天？',
      },
      {
        name: 'timeSlot',
        description: '時段 HH:mm',
        type: 'time',
        required: true,
        promptIfMissing: '想預約幾點？（HH:mm）',
      },
      { name: 'reason', description: '看診原因', type: 'string' },
    ],
    handler: makeLegacyHandler('create_health_appointment', 'cross_role_write'),
  },

  // ── 列印
  {
    name: 'create_print_job',
    aliases: ['print_file'],
    description: '建立列印工作。',
    kind: 'cross_role_write',
    allowedRoles: ['student', 'teacher', 'staff'],
    fields: [
      {
        name: 'printerId',
        description: '印表機 ID',
        type: 'string',
        required: true,
        promptIfMissing: '請告訴我要送到哪台印表機。',
      },
      {
        name: 'fileName',
        description: '檔名',
        type: 'string',
        required: true,
        promptIfMissing: '請告訴我檔案名稱。',
      },
      { name: 'copies', description: '份數', type: 'integer', default: 1 },
      { name: 'colorMode', description: 'bw/color', type: 'enum', enum: ['bw', 'color'], default: 'bw' },
    ],
    handler: makeLegacyHandler('create_print_job', 'cross_role_write'),
  },

  // ── 失物招領
  {
    name: 'create_lost_found',
    aliases: ['post_lost'],
    description: '發布失物招領或拾獲物品公告。',
    kind: 'cross_role_write',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'type', description: 'lost/found', type: 'enum', enum: ['lost', 'found'], default: 'lost' },
      { name: 'title', description: '物品名稱', type: 'string', required: true, promptIfMissing: '物品是什麼？' },
      { name: 'description', description: '詳細描述', type: 'string', required: true, promptIfMissing: '請告訴我物品的特徵或細節。' },
      { name: 'location', description: '地點', type: 'string' },
      { name: 'contactInfo', description: '聯絡方式', type: 'string' },
    ],
    handler: makeLegacyHandler('create_lost_found', 'cross_role_write'),
  },

  // ── 簽到
  {
    name: 'check_in_attendance',
    description: '對課堂進行簽到（出席打卡）。',
    kind: 'cross_role_write',
    allowedRoles: ['student'],
    fields: [
      { name: 'courseSpaceId', description: '課程空間 ID', type: 'string', required: true, promptIfMissing: '請給我課程空間 ID。' },
      { name: 'sessionId', description: '點名場次 ID', type: 'string', required: true, promptIfMissing: '請給我點名場次 ID。' },
      { name: 'qrToken', description: 'QR Token（選填）', type: 'string' },
    ],
    handler: makeLegacyHandler('check_in_attendance', 'cross_role_write'),
  },

  // ── 教師：建立作業
  {
    name: 'create_assignment',
    aliases: ['assignment_publish'],
    description: '在課程群組發布作業。',
    kind: 'cross_role_write',
    allowedRoles: TEACHING_ROLES,
    fields: [
      { name: 'groupId', description: '群組/課程 ID', type: 'string', required: true, promptIfMissing: '請告訴我要發布到哪一個課程/群組。' },
      { name: 'title', description: '作業標題', type: 'string', required: true, promptIfMissing: '作業標題是什麼？' },
      { name: 'description', description: '說明', type: 'string' },
      { name: 'dueAt', description: '截止 ISO 8601', type: 'datetime' },
    ],
    handler: makeLegacyHandler('create_assignment', 'cross_role_write'),
  },

  // ── 教師：批改
  {
    name: 'grade_submission',
    description: '對學生繳交記錄評分。',
    kind: 'cross_role_write',
    allowedRoles: TEACHING_ROLES,
    fields: [
      { name: 'submissionId', description: '繳交 ID', type: 'string', required: true, promptIfMissing: '請告訴我繳交 ID。' },
      { name: 'grade', description: '分數 0-100', type: 'integer', required: true, promptIfMissing: '請告訴我分數。' },
      { name: 'feedback', description: '回饋', type: 'string' },
    ],
    handler: makeLegacyHandler('grade_submission', 'cross_role_write'),
  },

  // ── 教師：開始點名
  {
    name: 'start_attendance',
    description: '為某堂課開始點名（產生 QR Code）。',
    kind: 'cross_role_write',
    allowedRoles: TEACHING_ROLES,
    fields: [
      { name: 'courseSpaceId', description: '課程空間 ID', type: 'string', required: true, promptIfMissing: '請給我課程空間 ID。' },
    ],
    handler: makeLegacyHandler('start_attendance', 'cross_role_write'),
  },

  // ── 通用：標已讀
  {
    name: 'mark_notifications_read',
    description: '把通知標為已讀。',
    kind: 'write',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'action', description: 'all/single', type: 'enum', enum: ['all', 'single'], default: 'all' },
      { name: 'notificationId', description: '通知 ID（action=single）', type: 'string' },
    ],
    handler: makeLegacyHandler('mark_notifications_read', 'write'),
  },

  // ── 讀取類（不限角色）
  {
    name: 'query_courses',
    description: '查詢使用者課程（today/all/next）。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [{ name: 'filter', description: 'today/all/next', type: 'enum', enum: ['today', 'all', 'next'], default: 'all' }],
    handler: makeLegacyHandler('query_courses', 'read'),
  },
  {
    name: 'query_assignments',
    description: '查詢待繳作業/考試。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [{ name: 'status', description: 'pending/overdue/all', type: 'enum', enum: ['pending', 'overdue', 'all'], default: 'all' }],
    handler: makeLegacyHandler('query_assignments', 'read'),
  },
  {
    name: 'query_grades',
    description: '查詢成績/GPA。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [{ name: 'semester', description: '學期', type: 'string' }],
    handler: makeLegacyHandler('query_grades', 'read'),
  },
  {
    name: 'query_calendar',
    description: '查詢行事曆事件。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'startDate', description: 'YYYY-MM-DD', type: 'date' },
      { name: 'endDate', description: 'YYYY-MM-DD', type: 'date' },
    ],
    handler: makeLegacyHandler('query_calendar', 'read'),
  },
  {
    name: 'query_menus',
    description: '查詢餐廳菜單。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'cafeteria', description: '餐廳名稱', type: 'string' },
      { name: 'keyword', description: '關鍵字', type: 'string' },
    ],
    handler: makeLegacyHandler('query_menus', 'read'),
  },
  {
    name: 'recommend_lunch',
    description: '推薦午餐／正餐主食候選（排除飲料為主），不下單。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'budget', description: '預算上限（元）', type: 'string' },
      {
        name: 'timeSlot',
        description: 'lunch / dinner / breakfast',
        type: 'enum',
        enum: ['lunch', 'dinner', 'breakfast'],
        default: 'lunch',
      },
    ],
    handler: makeLegacyHandler('recommend_lunch', 'read'),
  },
  {
    name: 'query_orders',
    description: '查詢訂單。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [{ name: 'status', description: 'pending/completed/all', type: 'enum', enum: ['pending', 'completed', 'all'], default: 'all' }],
    handler: makeLegacyHandler('query_orders', 'read'),
  },
  {
    name: 'query_library',
    description: '搜尋書籍/借閱/座位。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'action', description: 'search/loans/seats', type: 'enum', enum: ['search', 'loans', 'seats'], required: true, promptIfMissing: '想做什麼？search/loans/seats' },
      { name: 'keyword', description: '關鍵字', type: 'string' },
    ],
    handler: makeLegacyHandler('query_library', 'read'),
  },

  // ════════════════════════════════════════════════════════════
  // TronClass parity 新增 LMS 代理工具
  // ════════════════════════════════════════════════════════════

  {
    name: 'query_modules',
    description: '查詢某課程的單元與教材列表。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'courseSpaceId', description: '課程空間 ID', type: 'string', required: true, promptIfMissing: '請告訴我哪一門課？' },
      { name: 'includeMaterials', description: '是否一併回傳教材列表', type: 'boolean', default: true },
    ],
    handler: makeLegacyHandler('query_modules', 'read'),
  },
  {
    name: 'query_quizzes',
    description: '查詢使用者待答 / 已交測驗。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'courseSpaceId', description: '課程空間 ID', type: 'string' },
      { name: 'status', description: 'pending/submitted/all', type: 'enum', enum: ['pending', 'submitted', 'all'], default: 'pending' },
    ],
    handler: makeLegacyHandler('query_quizzes', 'read'),
  },
  {
    name: 'submit_quiz',
    description: '提交測驗作答（先建立草稿，需使用者於 QuizTakingScreen 按送出）。',
    kind: 'write',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'quizId', description: '測驗 ID', type: 'string', required: true, promptIfMissing: '哪一份測驗？' },
      { name: 'courseSpaceId', description: '課程空間 ID', type: 'string', required: true, promptIfMissing: '哪一門課？' },
      { name: 'answers', description: '作答（JSON 陣列）', type: 'string_list', required: true, promptIfMissing: '我還沒看到你的作答。' },
    ],
    handler: makeLegacyHandler('submit_quiz', 'write'),
  },
  {
    name: 'list_gradebook',
    description: '查看自己（學生）或全班（教師）的成績簿。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'courseSpaceId', description: '課程空間 ID', type: 'string', required: true, promptIfMissing: '哪一門課？' },
    ],
    handler: makeLegacyHandler('list_gradebook', 'read'),
  },
  {
    name: 'post_discussion',
    description: '在課程討論串發文（標題、內容）。',
    kind: 'write',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'courseSpaceId', description: '課程空間 ID', type: 'string', required: true, promptIfMissing: '哪一門課？' },
      { name: 'title', description: '討論標題', type: 'string', required: true, promptIfMissing: '請給我討論的標題。' },
      { name: 'body', description: '討論內容', type: 'string', required: true, promptIfMissing: '請告訴我想討論什麼？' },
      { name: 'threadId', description: '若回覆既有討論串，請提供', type: 'string' },
    ],
    handler: makeLegacyHandler('post_discussion', 'write'),
  },
  {
    name: 'build_study_plan',
    description: 'AI 切分作業 + 安排讀書時間表，會結合 query_assignments / query_calendar 結果。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'horizonDays', description: '規劃天數（預設 7）', type: 'integer', default: 7 },
      { name: 'dailyStudyMinutes', description: '每日讀書分鐘數（預設 90）', type: 'integer', default: 90 },
    ],
    handler: makeLegacyHandler('build_study_plan', 'read'),
  },
  {
    name: 'risk_radar',
    description: '學習風險雷達：依出席率、作業逾期、低分測驗計算風險等級。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'courseSpaceId', description: '若只看單一課程，提供 ID', type: 'string' },
    ],
    handler: makeLegacyHandler('risk_radar', 'read'),
  },

  // ════════════════════════════════════════════════════════════
  // Campus Companion（校園精靈 + 學習花園 + 同儕共生）
  // ════════════════════════════════════════════════════════════

  {
    name: 'query_companion',
    description: '查詢使用者目前的校園精靈與學習花園狀態（季節、氣象、care hint、植物階段）。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'days', description: '聚合最近 N 天的活動（預設 7）', type: 'integer', default: 7 },
    ],
    handler: makeLegacyHandler('query_companion', 'read'),
  },
  {
    name: 'pet_companion',
    description: '與精靈互動：撫摸 / 餵食（用之前採收的知識點）/ 換裝。',
    kind: 'write',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'action', description: 'pat / feed / dress', type: 'enum', enum: ['pat', 'feed', 'dress'], required: true, promptIfMissing: '想對精靈做什麼？撫摸 / 餵食 / 換裝？' },
      { name: 'itemId', description: 'feed/dress 用：道具 ID', type: 'string' },
    ],
    handler: makeLegacyHandler('pet_companion', 'write'),
  },
  {
    name: 'harvest_plant',
    description: '採收已結果且通過的課程植物，換成知識點。',
    kind: 'write',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'courseId', description: '要採收的課程 ID', type: 'string', required: true, promptIfMissing: '要採收哪一門課？' },
    ],
    handler: makeLegacyHandler('harvest_plant', 'write'),
  },
  {
    name: 'send_encouragement',
    description: '向同學寄出一句「鼓勵雲」（匿名或具名，僅顯示一句話 + emoji）。',
    kind: 'cross_role_write',
    allowedRoles: ALL_ROLES,
    fields: [
      { name: 'recipientUid', description: '收件人 uid', type: 'string', required: true, promptIfMissing: '要鼓勵哪位同學？' },
      { name: 'text', description: '鼓勵語（≤ 30 字）', type: 'string', required: true, promptIfMissing: '你想說什麼？' },
      { name: 'anonymous', description: '是否匿名', type: 'boolean', default: true },
    ],
    handler: makeLegacyHandler('send_encouragement', 'cross_role_write'),
  },
  {
    name: 'explore_constellation',
    description: '查看校園星圖：去過的地點、點亮的星座、本月限定星座。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [],
    handler: makeLegacyHandler('explore_constellation', 'read'),
  },

  // ──────────────────────────────────────────────────────
  // 差異化引擎 → AI 可調用工具（本輪新增）
  // ──────────────────────────────────────────────────────

  // grade_predict_what_if：「假設 HW 拿 N 分，總成績多少？」
  {
    name: 'grade_predict_what_if',
    description: '計算「如果某評分項目拿 N 分，總成績會變多少」（what-if simulator）。',
    kind: 'read',
    allowedRoles: ['student', 'teacher', 'staff'],
    fields: [
      {
        name: 'courseId',
        description: '課程 ID（71378 / 71282 / 71240 / 71393 / 77418）',
        type: 'string',
        required: true,
        promptIfMissing: '想試算哪門課？',
      },
      {
        name: 'overrides',
        description: 'Array of { itemId, assumedScore }; 假設某幾項拿的分數',
        type: 'string',
      },
    ],
    handler: async (args, ctx) => {
      try {
        const { simulateWhatIf } = await import('@campus/shared');
        const { getDemoScoreItemsByCourse } = await import('../data/demoCoursesMock');
        const courseId = Number(String(args.courseId).replace(/^tc:/, ''));
        const items = getDemoScoreItemsByCourse(courseId).map((s) => ({
          id: String(s.id),
          title: s.name,
          weight: s.weight,
          maxScore: s.totalScore,
          score: s.studentScore,
          graded: s.studentScore !== null,
        }));
        let overrides: Array<{ itemId: string; assumedScore: number }> = [];
        if (typeof args.overrides === 'string' && args.overrides.trim()) {
          try {
            overrides = JSON.parse(args.overrides);
          } catch {
            /* ignore */
          }
        } else if (Array.isArray(args.overrides)) {
          overrides = args.overrides as Array<{ itemId: string; assumedScore: number }>;
        }
        const result = simulateWhatIf(items, overrides);
        return {
          success: true,
          toolName: 'grade_predict_what_if',
          summary: `預估總成績 ${result.likelyCase ?? '—'}%（${result.letterGrade ?? '—'}） · 範圍 ${result.worstCase}-${result.bestCase}`,
          data: result,
          isWrite: false,
          isDraft: false,
        };
      } catch (e) {
        return makeFailure(
          'grade_predict_what_if',
          'execution_failed',
          `試算失敗：${(e as Error).message}`,
        );
      }
    },
  },

  // study_plan_today：產出今日番茄鐘排程 + 待辦優先序
  {
    name: 'study_plan_today',
    description: '產出今日跨課智慧排程：番茄鐘 + 待辦優先序 + 一句話總結。',
    kind: 'read',
    allowedRoles: ['student'],
    fields: [
      {
        name: 'dailyBudgetMinutes',
        description: '今天可投入學習的分鐘數，預設 240',
        type: 'integer',
        default: 240,
      },
    ],
    handler: async (args, ctx) => {
      try {
        const { planStudy, homeworkToPlannerTask, examToPlannerTask } = await import(
          '@campus/shared'
        );
        const {
          DEMO_COURSES,
          getDemoHomeworksByCourse,
          getDemoExamsByCourse,
        } = await import('../data/demoCoursesMock');
        const tasks: any[] = [];
        for (const c of DEMO_COURSES) {
          for (const hw of getDemoHomeworksByCourse(c.id)) {
            tasks.push(
              homeworkToPlannerTask({
                id: hw.id,
                courseId: hw.courseId,
                courseName: c.name,
                title: hw.title,
                dueAt: hw.dueAt,
                submitted: hw.submitted,
                totalScore: hw.totalScore,
              }),
            );
          }
          for (const e of getDemoExamsByCourse(c.id)) {
            tasks.push(
              examToPlannerTask({
                id: e.id,
                courseId: e.courseId,
                courseName: c.name,
                title: e.title,
                startAt: e.startAt,
                isPractice: e.isPractice,
                submitted: e.submitted,
                totalScore: e.totalScore,
              }),
            );
          }
        }
        const dailyBudget = Number(args.dailyBudgetMinutes ?? 240) || 240;
        const plan = planStudy(tasks, { dailyBudgetMinutes: dailyBudget });
        return {
          success: true,
          toolName: 'study_plan_today',
          summary: plan.summary,
          data: {
            summary: plan.summary,
            pomodoroCount: plan.pomodoros.length,
            totalMinutes: plan.totalEstimatedMinutes,
            topTasks: plan.prioritized.slice(0, 5).map((t) => ({
              title: t.title,
              courseName: t.courseName,
              urgency: t.urgency,
              reason: t.reason,
            })),
          },
          isWrite: false,
          isDraft: false,
        };
      } catch (e) {
        return makeFailure(
          'study_plan_today',
          'execution_failed',
          `排程失敗：${(e as Error).message}`,
        );
      }
    },
  },

  // mistake_due_today：今天該複習的錯題清單
  {
    name: 'mistake_due_today',
    description: '查今天該複習的錯題本題目（按 Leitner 間隔重複排程）。',
    kind: 'read',
    allowedRoles: ['student'],
    fields: [],
    handler: async (args, ctx) => {
      try {
        const { recommendDailyPracticeSet, statsOf } = await import('@campus/shared');
        const AsyncStorageMod = await import('@react-native-async-storage/async-storage');
        const { getScopedStorageKey } = await import('./scopedStorage');
        const storageKey = getScopedStorageKey('mistake_repertoire_v1', {
          uid: ctx.userId ?? 'demo',
          schoolId: ctx.schoolId ?? null,
        });
        const raw = await AsyncStorageMod.default.getItem(storageKey);
        const entries = raw ? (JSON.parse(raw) as any[]) : [];
        const now = new Date().toISOString();
        const due = recommendDailyPracticeSet(entries, now, 10);
        const stats = statsOf(entries, now);
        return {
          success: true,
          toolName: 'mistake_due_today',
          summary: `今天該練 ${due.length} 題 · 吸收率 ${Math.round(stats.masteryRate * 100)}%`,
          data: {
            dueCount: due.length,
            stats,
            preview: due.slice(0, 5).map((d) => ({
              courseName: d.courseName,
              question: d.questionText.slice(0, 60),
              box: d.box,
            })),
          },
          isWrite: false,
          isDraft: false,
        };
      } catch (e) {
        return makeFailure(
          'mistake_due_today',
          'execution_failed',
          `讀取錯題失敗：${(e as Error).message}`,
        );
      }
    },
  },

  // urgent_notifications：拉學生今天的 critical / high 通知
  {
    name: 'urgent_notifications',
    description: '拉學生現在所有 critical / high 級別通知（作業到期、考試、教室異動等）。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [],
    handler: async (args, ctx) => {
      try {
        const { planNotifications } = await import('@campus/shared');
        const {
          DEMO_COURSES,
          getDemoHomeworksByCourse,
          getDemoExamsByCourse,
        } = await import('../data/demoCoursesMock');
        const homeworks = DEMO_COURSES.flatMap((c) =>
          getDemoHomeworksByCourse(c.id).map((hw) => ({
            id: hw.id,
            courseId: hw.courseId,
            courseName: c.name,
            title: hw.title,
            dueAt: hw.dueAt,
            submitted: hw.submitted,
          })),
        );
        const exams = DEMO_COURSES.flatMap((c) =>
          getDemoExamsByCourse(c.id).map((e) => ({
            id: e.id,
            courseId: e.courseId,
            courseName: c.name,
            title: e.title,
            startAt: e.startAt,
            submitted: e.submitted,
          })),
        );
        const list = planNotifications({
          now: new Date().toISOString(),
          homeworks,
          exams,
        });
        const urgent = list.filter((n) => n.severity === 'critical' || n.severity === 'high');
        return {
          success: true,
          toolName: 'urgent_notifications',
          summary: `${urgent.length} 條立即注意`,
          data: urgent.slice(0, 8).map((n) => ({
            kind: n.kind,
            severity: n.severity,
            title: n.title,
            body: n.body,
          })),
          isWrite: false,
          isDraft: false,
        };
      } catch (e) {
        return makeFailure(
          'urgent_notifications',
          'execution_failed',
          `讀取通知失敗：${(e as Error).message}`,
        );
      }
    },
  },

  // socratic_hint：給定題目 + 學生卡點，回 hint（不洩漏答案）
  {
    name: 'socratic_hint',
    description: 'AI 解題教練：給學生 hint 而非答案（5 級漸進；不洩漏正解）。',
    kind: 'read',
    allowedRoles: ['student'],
    fields: [
      {
        name: 'questionText',
        description: '題目內容',
        type: 'string',
        required: true,
        promptIfMissing: '請貼上題目內容',
      },
      {
        name: 'studentAttempt',
        description: '學生目前的嘗試或卡住的點',
        type: 'string',
      },
      {
        name: 'level',
        description: 'Hint 等級 1-5；1 最輕，5 最具體',
        type: 'integer',
        default: 1,
      },
    ],
    handler: async (args, ctx) => {
      try {
        const { fallbackHint, buildSocraticSystemPrompt } = await import('@campus/shared');
        const level = Math.max(1, Math.min(5, Number(args.level) || 1)) as 1 | 2 | 3 | 4 | 5;
        const req = {
          questionText: String(args.questionText ?? ''),
          studentAttempt: String(args.studentAttempt ?? ''),
          level,
        };
        const hint = fallbackHint(req);
        return {
          success: true,
          toolName: 'socratic_hint',
          summary: hint.hint,
          data: {
            hint: hint.hint,
            level: hint.level,
            systemPromptForLLM: buildSocraticSystemPrompt(req),
          },
          isWrite: false,
          isDraft: false,
        };
      } catch (e) {
        return makeFailure(
          'socratic_hint',
          'execution_failed',
          `產生 hint 失敗：${(e as Error).message}`,
        );
      }
    },
  },

  // ai_full_context：拉學生整體現況，給 AI 對話用
  {
    name: 'ai_full_context',
    description: '一次拉學生在 APP 內整體現況（5 門課、待辦、通知、錯題本、預估成績）。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [],
    handler: async (args, ctx) => {
      try {
        const { buildFullAIContext, contextToCompactJson } = await import(
          './aiContextBuilder'
        );
        const fullCtx = await buildFullAIContext({
          uid: ctx.userId ?? 'demo',
          schoolId: ctx.schoolId ?? null,
          displayName: undefined,
          role: ctx.role ?? 'student',
        });
        return {
          success: true,
          toolName: 'ai_full_context',
          summary: `${fullCtx.courses.length} 門課 · ${fullCtx.studyPlan.priorityCount} 待辦 · ${fullCtx.atRiskCourses.length} 風險`,
          data: contextToCompactJson(fullCtx),
          isWrite: false,
          isDraft: false,
        };
      } catch (e) {
        return makeFailure(
          'ai_full_context',
          'execution_failed',
          `讀取 context 失敗：${(e as Error).message}`,
        );
      }
    },
  },

  // ai_data_inventory：列出 APP 內所有 domain 與 AI 整合狀態
  {
    name: 'ai_data_inventory',
    description: '列出 APP 全部 domain（課程/餐廳/圖書館/...) 與 AI 整合狀態。AI 可知道自己掌握什麼資料。',
    kind: 'read',
    allowedRoles: ALL_ROLES,
    fields: [],
    handler: async (args, ctx) => {
      try {
        const { AI_DATA_INVENTORY, aiDataInventoryStats, buildWideAISnapshot, wideSnapshotToPromptLine } = await import(
          './aiDataInventory'
        );
        const stats = aiDataInventoryStats();
        const snap = await buildWideAISnapshot({ uid: ctx.userId ?? 'demo', schoolId: ctx.schoolId ?? null });
        return {
          success: true,
          toolName: 'ai_data_inventory',
          summary: wideSnapshotToPromptLine(snap),
          data: {
            stats,
            coverage: stats.coverage,
            byLevel: stats.byLevel,
            domains: AI_DATA_INVENTORY.map((e) => ({
              key: e.key,
              label: e.label,
              level: e.level,
              roles: e.roles,
              aiKnowledge: e.aiKnowledge,
            })),
            snapshot: snap.domains,
          },
          isWrite: false,
          isDraft: false,
        };
      } catch (e) {
        return makeFailure(
          'ai_data_inventory',
          'execution_failed',
          `讀取 inventory 失敗：${(e as Error).message}`,
        );
      }
    },
  },
];

// 建立 name + alias 索引
const SPEC_INDEX: Map<string, ToolSpec> = (() => {
  const m = new Map<string, ToolSpec>();
  for (const spec of TOOL_SPECS) {
    m.set(spec.name, spec);
    for (const alias of spec.aliases ?? []) m.set(alias, spec);
  }
  return m;
})();

export function listToolSpecs(): readonly ToolSpec[] {
  return TOOL_SPECS;
}

export function getToolSpec(name: string): ToolSpec | null {
  return SPEC_INDEX.get(name) ?? null;
}

// ════════════════════════════════════════════════════════════
// Gemini Function Declarations（讓 Gemini function-calling 看到 canonical 名稱）
// ════════════════════════════════════════════════════════════

type RegistryGeminiDeclaration = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
};

function fieldTypeToGeminiType(t: ToolFieldType): string {
  switch (t) {
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'string_list':
      return 'string'; // Gemini 不支援陣列直接型別，AI 會以逗號分隔字串送進來
    case 'enum':
    case 'string':
    case 'date':
    case 'datetime':
    case 'time':
    default:
      return 'string';
  }
}

/**
 * 把 registry 中允許某角色使用的工具，輸出成 Gemini function declarations。
 * 與舊版 getToolDeclarations 互補；ai.ts 可合併兩份再去重後送給 Gemini。
 */
export function getRegistryGeminiDeclarations(
  role?: CampusActorRole,
): RegistryGeminiDeclaration[] {
  const out: RegistryGeminiDeclaration[] = [];
  for (const spec of TOOL_SPECS) {
    if (role && !spec.allowedRoles.includes(role)) continue;
    const properties: RegistryGeminiDeclaration['parameters']['properties'] = {};
    const required: string[] = [];
    for (const field of spec.fields) {
      const desc =
        field.description +
        (field.example ? `（例：${field.example}）` : '') +
        (field.default !== undefined ? '（可省略，會用預設值）' : '');
      properties[field.name] = {
        type: fieldTypeToGeminiType(field.type),
        description: desc,
        ...(field.enum && field.enum.length > 0 ? { enum: [...field.enum] } : {}),
      };
      if (field.required) required.push(field.name);
    }
    out.push({
      name: spec.name,
      description: spec.description,
      parameters:
        spec.parameters ?? {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
    });
  }
  return out;
}

// ════════════════════════════════════════════════════════════
// Stage 2：全域 Action Executor
// ════════════════════════════════════════════════════════════

/**
 * 統一執行入口。所有 AI tool call 都應該走這裡。
 *
 * 流程：
 *  1. 解析 toolName 為 ToolSpec（含 alias）
 *  2. 角色 / 登入 / school 檢查（精準錯誤碼）
 *  3. choiceMenu index 解析（「幫我點第 2 個」→ itemId/vendorId）
 *  4. 套預設值
 *  5. 必填欄位檢查 → 缺則回 missing_info
 *  6. 呼叫底層 handler
 *  7. 統一回傳 StandardToolResult
 */
export async function executeToolStandard(
  toolName: string,
  rawArgs: Record<string, unknown> | undefined,
  ctx: ToolExecutionContext,
): Promise<StandardToolResult> {
  const args0: Record<string, unknown> = { ...(rawArgs ?? {}) };

  const spec = getToolSpec(toolName);
  if (!spec) {
    return makeFailure(toolName, 'tool_not_found', `未知的工具：${toolName}`);
  }

  const writeKind = isWriteKind(spec.kind);

  // 角色檢查
  const role = ctx.role ?? 'student';
  if (!spec.allowedRoles.includes(role)) {
    return makeFailure(
      spec.name,
      'role_denied',
      `目前角色（${role}）沒有權限執行「${spec.name}」。`,
      { isWrite: writeKind },
    );
  }

  // 登入檢查
  const requiresAuth = spec.requiresAuth ?? writeKind;
  if (requiresAuth && !ctx.userId) {
    return makeFailure(
      spec.name,
      'auth_required',
      `需要先登入，才能執行「${spec.name}」。`,
      { isWrite: writeKind },
    );
  }

  // school 檢查
  const requiresSchool = spec.requiresSchool ?? writeKind;
  if (requiresSchool && !ctx.schoolId) {
    return makeFailure(
      spec.name,
      'school_required',
      `目前還沒判斷出學校，無法執行「${spec.name}」。`,
      { isWrite: writeKind },
    );
  }

  // 離線檢查（僅針對寫入）
  if (writeKind && ctx.isOnline === false) {
    return makeFailure(
      spec.name,
      'offline',
      `目前離線，「${spec.name}」會寫入校園系統，無法執行。`,
      { isWrite: writeKind },
    );
  }

  const args1 = applyChoiceMenuResolution(args0, ctx);
  const args2 = applyDefaults(spec, args1, ctx);
  const missing = checkMissing(spec, args2);
  if (missing.length > 0) {
    return makeMissingInfo(spec.name, missing, writeKind);
  }
  const invalid = checkInvalid(spec, args2);
  if (invalid.length > 0) {
    return makeMissingInfo(spec.name, invalid, writeKind);
  }

  try {
    const result = await spec.handler(args2, ctx);
    // 保證 toolName 一致
    return { ...result, toolName: result.toolName || spec.name };
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? '未知錯誤');
    return makeFailure(spec.name, 'execution_failed', `執行失敗：${msg}`, {
      isWrite: writeKind,
      error: msg,
    });
  }
}

// ════════════════════════════════════════════════════════════
// Stage 4：UI 文案輔助
// ════════════════════════════════════════════════════════════

/**
 * 把 StandardToolResult 轉成 user-facing 文案。
 * 規則：
 *  - success && isWrite && !isDraft  → 「✅ 已為你完成 …」+ summary
 *  - success && isDraft              → 「📝 草稿已建立 …」+ summary
 *  - success && !isWrite             → 直接顯示 summary（讀取結果）
 *  - !success && missing_info        → 「我還缺 …」摘要
 *  - !success （其他）               → 顯示錯誤摘要
 */
export function formatStandardToolMessage(result: StandardToolResult): string {
  if (result.success) {
    if (result.isDraft) {
      return `📝 草稿已建立，請到對應頁面送出。\n\n${result.summary}`;
    }
    if (result.isWrite) {
      return `✅ 已為你完成。\n\n${result.summary}`;
    }
    return result.summary;
  }
  if (result.errorCode === 'missing_info' && result.missingInfo?.length) {
    const list = result.missingInfo.map((m) => `• ${m.prompt}`).join('\n');
    return `我還需要一些資訊才能繼續：\n${list}`;
  }
  if (result.errorCode === 'role_denied' || result.errorCode === 'auth_required') {
    return result.summary;
  }
  return result.summary || '操作失敗。';
}

/**
 * 取得 UI 顯示的 status badge：'executed' | 'drafted' | 'queried' | 'blocked' | 'pending_input'
 */
export function getResultBadge(result: StandardToolResult): {
  badge: 'executed' | 'drafted' | 'queried' | 'blocked' | 'pending_input';
  label: string;
} {
  if (!result.success) {
    if (result.errorCode === 'missing_info') {
      return { badge: 'pending_input', label: '等待補資訊' };
    }
    return { badge: 'blocked', label: '無法執行' };
  }
  if (result.isDraft) return { badge: 'drafted', label: '草稿' };
  if (result.isWrite) return { badge: 'executed', label: '已完成' };
  return { badge: 'queried', label: '已查到' };
}

// ════════════════════════════════════════════════════════════
// 對外暴露：簡化的標準 ParsedAction → StandardToolResult 串列執行
// ════════════════════════════════════════════════════════════

export type StandardParsedAction = {
  tool: string;
  args: Record<string, unknown>;
};

export async function executeAgentActionsStandard(
  actions: StandardParsedAction[],
  ctx: ToolExecutionContext,
): Promise<Array<{ tool: string; result: StandardToolResult }>> {
  const out: Array<{ tool: string; result: StandardToolResult }> = [];
  for (const action of actions) {
    const result = await executeToolStandard(action.tool, action.args, ctx);
    out.push({ tool: action.tool, result });
  }
  return out;
}
