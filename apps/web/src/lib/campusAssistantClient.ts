/**
 * Web client for `askCampusAssistant` Firebase Callable Function.
 * Mirrors apps/mobile/src/services/ai.ts callAskCampusAssistant() but returns
 * the full envelope (including cards) for the Web ai-assistant page to render.
 *
 * Firebase app / Functions region / Emulator wiring 統一走 lib/firebase.ts，
 * 與 apps/mobile/src/firebase.ts 對齊（避免 region 不一致與 emulator 重複 wire）。
 */
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { getAuth, getDb, getFunctionsInstance, isFirebaseConfigured } from './firebase';
import { areFunctionsConfigured } from './functionsUrl';

export type AgentCardKind =
  | 'directions_card'
  | 'route_card'
  | 'poi_card'
  | 'menu_card'
  | 'order_draft_card'
  | 'order_submitted'
  | 'cafeteria_list_card'
  | 'navigate';

export interface AgentCard {
  kind: AgentCardKind;
  payload: Record<string, unknown>;
}

export interface CampusAssistantEnvelope {
  content: string;
  suggestions?: string[];
  actions?: unknown[];
  citations?: unknown[];
  assistantToolsUsed?: string[];
  cards?: AgentCard[];
  run?: { runId?: string; status?: string };
  intent?: { name?: string; confidence?: number };
  evaluation?: { score?: number; needsUserReview?: boolean };
  clarifyingQuestion?: string | null;
  error?: string;
}

export interface CallCampusAssistantInput {
  userId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  schoolId?: string;
  groupId?: string;
  sessionId?: string | null;
  screen?: string;
}

export interface CampusAssistantSnapshot {
  schoolId: string;
  checkedAt: string;
  schedule: { status: 'available' | 'unavailable'; count: number | null };
  assignments: {
    status: 'available' | 'unavailable';
    count: number | null;
    items: Array<{ title: string; groupName: string; dueAt: string | null }>;
  };
  announcements: {
    status: 'available' | 'unavailable';
    items: Array<{ title: string; publishedAt: string | null }>;
  };
}

export interface AgentWriteResult {
  success: boolean;
  toolName?: string;
  errorCode?: string;
  errorMessage?: string;
  requestId?: string;
  repairId?: string;
  reservationId?: string;
  orderId?: string;
  status?: string;
}

export class CampusAssistantError extends Error {
  constructor(
    public readonly code: 'unavailable' | 'unconfigured' | 'session-changed' | 'invalid-response',
  ) {
    super(code);
    this.name = 'CampusAssistantError';
  }
}

/** Only accept a response for the account that started the request. */
export async function callCampusAssistant(
  input: CallCampusAssistantInput,
  signal?: AbortSignal,
): Promise<CampusAssistantEnvelope> {
  if (!isFirebaseConfigured()) {
    throw new CampusAssistantError('unavailable');
  }
  if (!areFunctionsConfigured()) {
    throw new CampusAssistantError('unconfigured');
  }
  const assertCurrentSession = () => {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (!input.userId || getAuth()?.currentUser?.uid !== input.userId) {
      throw new CampusAssistantError('session-changed');
    }
  };
  assertCurrentSession();

  try {
    const callable = httpsCallable<
      {
        messages: CallCampusAssistantInput['messages'];
        context: Record<string, unknown>;
      },
      CampusAssistantEnvelope
    >(getFunctionsInstance(), 'askCampusAssistant');

    const result = await callable({
      messages: input.messages.slice(-12),
      context: {
        schoolId: input.schoolId || 'pu',
        screen: input.screen || 'web/ai-assistant',
        locale: 'zh-TW',
        timezone: 'Asia/Taipei',
        ...(input.groupId ? { groupId: input.groupId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
    });

    assertCurrentSession();
    const data = result.data;
    if (!data || data.error || data.run?.status === 'failed' || typeof data.content !== 'string' || !data.content.trim()) {
      throw new CampusAssistantError('invalid-response');
    }
    return data;
  } catch (e) {
    assertCurrentSession();
    throw e;
  }
}

/** All personal data is read from the signed-in account and the server-authorized school. */
export async function getCampusAssistantSnapshot(
  userId: string,
  schoolId: string,
  signal?: AbortSignal,
): Promise<CampusAssistantSnapshot> {
  if (!isFirebaseConfigured()) throw new CampusAssistantError('unavailable');
  if (!areFunctionsConfigured()) throw new CampusAssistantError('unconfigured');
  const checkSession = () => {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (!userId || getAuth()?.currentUser?.uid !== userId) {
      throw new CampusAssistantError('session-changed');
    }
  };
  checkSession();
  const callable = httpsCallable<{ schoolId: string }, CampusAssistantSnapshot>(
    getFunctionsInstance(),
    'getCampusAssistantSnapshot',
  );
  try {
    const { data } = await callable({ schoolId });
    checkSession();
    if (!data || data.schoolId !== schoolId || !data.assignments || !data.announcements || !data.schedule) {
      throw new CampusAssistantError('invalid-response');
    }
    return data;
  } catch (error) {
    checkSession();
    throw error;
  }
}

/** Submitting an agent proposal is a separate, explicit user action. */
export async function executeCampusAgentWrite(
  input: {
    userId: string;
    schoolId: string;
    toolName: string;
    payload: Record<string, unknown>;
    agentRunId: string;
    groupId?: string;
  },
  signal?: AbortSignal,
): Promise<AgentWriteResult> {
  if (!isFirebaseConfigured()) throw new CampusAssistantError('unavailable');
  if (!areFunctionsConfigured()) throw new CampusAssistantError('unconfigured');
  const checkSession = () => {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (!input.userId || getAuth()?.currentUser?.uid !== input.userId) {
      throw new CampusAssistantError('session-changed');
    }
  };
  checkSession();
  const callable = httpsCallable<
    { toolName: string; input: Record<string, unknown>; agentRunId: string; context: Record<string, string> },
    AgentWriteResult
  >(getFunctionsInstance(), 'executeAgentWrite');
  try {
    const { data } = await callable({
      toolName: input.toolName,
      input: input.payload,
      agentRunId: input.agentRunId,
      context: {
        schoolId: input.schoolId,
        timezone: 'Asia/Taipei',
        ...(input.groupId ? { groupId: input.groupId } : {}),
      },
    });
    checkSession();
    if (!data || typeof data.success !== 'boolean' || data.toolName !== input.toolName) {
      throw new CampusAssistantError('invalid-response');
    }
    return data;
  } catch (error) {
    checkSession();
    throw error;
  }
}

/**
 * Confirm an order draft (kind='order_draft_card') by calling createOrder
 * Cloud Function. This is the "user confirmed" path that actually writes to
 * Firestore. Returns { orderId, total, cafeteria } on success.
 */
export interface CreateOrderInput {
  schoolId: string;
  /** 同一張草稿重送沿用同一個編號，伺服器靠它避免重複下單 */
  requestId: string;
  cafeteriaId: string;
  items: Array<{
    menuItemId: string;
    name: string;
    price: number;
    quantity: number;
    note?: string;
  }>;
  pickupTime?: string | null;
  paymentMethod?: string;
  note?: string | null;
}

export interface CreateOrderResult {
  success: boolean;
  orderId?: string;
  cafeteria?: string;
  total?: number;
  itemCount?: number;
  /** 伺服器下單時一起發的取餐號碼；沒拿到是 null */
  queueNumber?: number | null;
  queueStatus?: 'assigned' | 'pending_confirmation';
  createdAt?: string | null;
  items?: Array<{ name: string; quantity: number }>;
  errorCode?: string;
  errorMessage?: string;
  /** 伺服器明確說這張單不成立（菜單或金額變了）；要換新的送出編號重新確認 */
  notCreated?: boolean;
}

export async function confirmCreateOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, errorCode: 'no_firebase', errorMessage: 'Firebase 設定不可用' };
  }
  if (!areFunctionsConfigured()) {
    return {
      success: false,
      errorCode: 'functions_unconfigured',
      errorMessage: '雲端函式尚未啟用',
    };
  }
  try {
    const callable = httpsCallable<CreateOrderInput, CreateOrderResult>(
      getFunctionsInstance(),
      'createOrder',
    );
    const result = await callable(input);
    return result.data;
  } catch (e) {
    const err = e as { code?: string; message?: string; details?: { orderOutcome?: string } };
    return {
      success: false,
      errorCode: err?.code || 'callable_failed',
      errorMessage: err?.message || '下單失敗',
      notCreated: err?.details?.orderOutcome === 'not_created',
    };
  }
}

/**
 * 號碼還沒拿到時盯著學生自己的訂單副本；店家按「給號碼」後回呼真的號碼。
 * 回傳取消監聽；沒登入或沒辦法監聽時回 null。
 */
export function watchOrderQueueNumber(
  schoolId: string,
  orderId: string,
  onNumber: (queueNumber: number) => void,
): (() => void) | null {
  const uid = getAuth()?.currentUser?.uid;
  if (!uid || !isFirebaseConfigured()) return null;
  try {
    return onSnapshot(
      doc(getDb(), 'users', uid, 'schools', schoolId, 'orders', orderId),
      snapshot => {
        const value = snapshot.exists() ? snapshot.data()?.queueNumber : null;
        if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) onNumber(value);
      },
      () => undefined,
    );
  } catch {
    return null;
  }
}
