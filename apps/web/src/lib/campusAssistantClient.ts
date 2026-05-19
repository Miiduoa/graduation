/**
 * Web client for `askCampusAssistant` Firebase Callable Function.
 * Mirrors apps/mobile/src/services/ai.ts callAskCampusAssistant() but returns
 * the full envelope (including cards) for the Web ai-assistant page to render.
 */
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';

const USE_EMULATOR =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === '1' ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
const EMULATOR_FUNCTIONS_HOST =
  process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || 'localhost';
const EMULATOR_FUNCTIONS_PORT = Number(
  process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_FUNCTIONS_PORT || '5001',
);
let emulatorWired = false;

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

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const REGION = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || 'us-central1';

function getApp(): FirebaseApp | null {
  try {
    if (getApps().length > 0) return getApps()[0];
    if (!firebaseConfig.projectId) return null;
    return initializeApp(firebaseConfig);
  } catch {
    return null;
  }
}

function hasUsableFirebaseConfig(): boolean {
  return Boolean(firebaseConfig.projectId && firebaseConfig.apiKey && firebaseConfig.appId);
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
  if (!hasUsableFirebaseConfig()) {
    console.warn(
      '[campusAssistantClient] Firebase Web config missing. Set NEXT_PUBLIC_FIREBASE_* env vars.',
    );
    return null;
  }
  if (signal?.aborted) return null;

  const app = getApp();
  if (!app) return null;

  try {
    const functions = getFunctions(app, REGION);
    if (USE_EMULATOR && !emulatorWired && typeof window !== 'undefined') {
      try {
        connectFunctionsEmulator(functions, EMULATOR_FUNCTIONS_HOST, EMULATOR_FUNCTIONS_PORT);
        emulatorWired = true;
        console.info(
          `[campusAssistantClient] Functions emulator @ ${EMULATOR_FUNCTIONS_HOST}:${EMULATOR_FUNCTIONS_PORT}`,
        );
      } catch (e) {
        console.warn('[campusAssistantClient] emulator wire failed:', e);
      }
    }
    const callable = httpsCallable<
      {
        messages: CallCampusAssistantInput['messages'];
        context: Record<string, unknown>;
      },
      CampusAssistantEnvelope
    >(functions, 'askCampusAssistant');

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
  if (!hasUsableFirebaseConfig()) {
    return { success: false, errorCode: 'no_firebase', errorMessage: 'Firebase 設定不可用' };
  }
  const app = getApp();
  if (!app) return { success: false, errorCode: 'no_app', errorMessage: 'Firebase app 未初始化' };
  try {
    const functions = getFunctions(app, REGION);
    if (USE_EMULATOR && !emulatorWired && typeof window !== 'undefined') {
      try {
        connectFunctionsEmulator(functions, EMULATOR_FUNCTIONS_HOST, EMULATOR_FUNCTIONS_PORT);
        emulatorWired = true;
      } catch {}
    }
    const callable = httpsCallable<CreateOrderInput, CreateOrderResult>(
      functions,
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
