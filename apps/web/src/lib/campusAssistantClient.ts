/**
 * Web client for `askCampusAssistant` Firebase Callable Function.
 * Mirrors apps/mobile/src/services/ai.ts callAskCampusAssistant() but returns
 * the full envelope (including cards) for the Web ai-assistant page to render.
 *
 * Firebase app / Functions region / Emulator wiring 統一走 lib/firebase.ts，
 * 與 apps/mobile/src/firebase.ts 對齊（避免 region 不一致與 emulator 重複 wire）。
 */
import { httpsCallable } from 'firebase/functions';
import { getFunctionsInstance, isFirebaseConfigured } from './firebase';

export type AgentCardKind =
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
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  schoolId?: string;
  sessionId?: string | null;
  screen?: string;
}

/**
 * Call the deployed askCampusAssistant Cloud Function.
 * Returns null if Firebase config is not available (Web falls back to local
 * demo reply in that case).
 */
export async function callCampusAssistant(
  input: CallCampusAssistantInput,
  signal?: AbortSignal,
): Promise<CampusAssistantEnvelope | null> {
  if (!isFirebaseConfigured()) {
    console.warn(
      '[campusAssistantClient] Firebase Web config missing. Set NEXT_PUBLIC_FIREBASE_* env vars.',
    );
    return null;
  }
  if (signal?.aborted) return null;

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
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
    });

    return result.data as CampusAssistantEnvelope;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.warn('[campusAssistantClient] callable failed:', err?.code, err?.message);
    return null;
  }
}

/**
 * Confirm an order draft (kind='order_draft_card') by calling createOrder
 * Cloud Function. This is the "user confirmed" path that actually writes to
 * Firestore. Returns { orderId, total, cafeteria } on success.
 */
export interface CreateOrderInput {
  schoolId: string;
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
  errorCode?: string;
  errorMessage?: string;
}

export async function confirmCreateOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (!isFirebaseConfigured()) {
    return { success: false, errorCode: 'no_firebase', errorMessage: 'Firebase 設定不可用' };
  }
  try {
    const callable = httpsCallable<CreateOrderInput, CreateOrderResult>(
      getFunctionsInstance(),
      'createOrder',
    );
    const result = await callable(input);
    return result.data;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return {
      success: false,
      errorCode: err?.code || 'callable_failed',
      errorMessage: err?.message || '下單失敗',
    };
  }
}
