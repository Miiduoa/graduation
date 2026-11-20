/**
 * 產品回饋 — Micro-CSAT／NPS 節流、離線佇列、Firestore `feedback` 集合統一寫入。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getDb } from '../firebase';

const QUEUE_KEY = '@productFeedback:queue:v1';
const LAST_NPS_MS_KEY = '@productFeedback:lastNpsMs:v1';
const LAST_CSAT_PREFIX = '@productFeedback:lastCsatMs:';

export type MicroCsatContext = 'crowd_report' | 'ai_tool_success';

export type ProductFeedbackKind = 'general' | 'csat' | 'nps';

export type QueuedFeedbackDoc = {
  kind: ProductFeedbackKind;
  feedbackType?: string;
  title: string;
  description: string;
  rating?: number;
  score?: number;
  context?: string;
  contactEmail?: string | null;
  submittedBy?: string | null;
  schoolId: string;
  queuedAtMs: number;
};

function msDays(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

export async function shouldOfferMicroCsat(
  context: MicroCsatContext,
  minDaysBetweenPrompts = 7,
): Promise<boolean> {
  try {
    const key = `${LAST_CSAT_PREFIX}${context}`;
    const raw = await AsyncStorage.getItem(key);
    const last = raw ? parseInt(raw, 10) : 0;
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= msDays(minDaysBetweenPrompts);
  } catch {
    return false;
  }
}

export async function markMicroCsatShown(context: MicroCsatContext): Promise<void> {
  try {
    await AsyncStorage.setItem(`${LAST_CSAT_PREFIX}${context}`, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export async function shouldOfferNps(minDaysBetween = 90): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LAST_NPS_MS_KEY);
    const last = raw ? parseInt(raw, 10) : 0;
    if (!Number.isFinite(last) || last <= 0) return true;
    return Date.now() - last >= msDays(minDaysBetween);
  } catch {
    return false;
  }
}

export async function markNpsShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_NPS_MS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

async function loadQueue(): Promise<QueuedFeedbackDoc[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedFeedbackDoc[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveQueue(items: QueuedFeedbackDoc[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-40)));
}

export async function enqueueFeedback(doc: QueuedFeedbackDoc): Promise<void> {
  const q = await loadQueue();
  q.push(doc);
  await saveQueue(q);
}

async function writeFeedbackToFirestore(payload: Record<string, unknown>): Promise<void> {
  const db = getDb();
  await addDoc(collection(db, 'feedback'), payload);
}

/** 送出回饋；失敗時寫入本機佇列。成功後嘗試記錄遊戲化（失敗忽略）。 */
export async function submitProductFeedback(input: {
  kind: ProductFeedbackKind;
  feedbackType?: string;
  title: string;
  description: string;
  rating?: number;
  score?: number;
  context?: string;
  contactEmail?: string | null;
  submittedBy?: string | null;
  schoolId: string;
}): Promise<{ ok: boolean }> {
  const payload: Record<string, unknown> = {
    kind: input.kind,
    type: input.feedbackType ?? 'other',
    title: input.title.trim(),
    description: input.description.trim(),
    rating: input.rating ?? 0,
    score: input.score,
    context: input.context ?? null,
    contactEmail: input.contactEmail ?? null,
    submittedBy: input.submittedBy ?? null,
    schoolId: input.schoolId,
    createdAt: serverTimestamp(),
  };

  try {
    await writeFeedbackToFirestore(payload);
    try {
      const { recordFeedbackParticipation } = await import('./gamificationEngine');
      await recordFeedbackParticipation(input.kind);
    } catch {
      /* gamification optional */
    }
    return { ok: true };
  } catch (e) {
    console.warn('[productFeedback] Firestore submit failed, enqueue:', e);
    await enqueueFeedback({
      kind: input.kind,
      feedbackType: input.feedbackType,
      title: input.title.trim(),
      description: input.description.trim(),
      rating: input.rating,
      score: input.score,
      context: input.context,
      contactEmail: input.contactEmail ?? null,
      submittedBy: input.submittedBy ?? null,
      schoolId: input.schoolId,
      queuedAtMs: Date.now(),
    });
    return { ok: false };
  }
}

/** App 前景或啟動時重試佇列。 */
export async function flushFeedbackQueue(): Promise<void> {
  const q = await loadQueue();
  if (q.length === 0) return;

  const remaining: QueuedFeedbackDoc[] = [];
  for (const item of q) {
    try {
      await writeFeedbackToFirestore({
        kind: item.kind,
        type: item.feedbackType ?? 'other',
        title: item.title,
        description: item.description,
        rating: item.rating ?? 0,
        score: item.score,
        context: item.context ?? null,
        contactEmail: item.contactEmail ?? null,
        submittedBy: item.submittedBy ?? null,
        schoolId: item.schoolId,
        queuedAtMs: item.queuedAtMs,
        createdAt: serverTimestamp(),
      });
      try {
        const { recordFeedbackParticipation } = await import('./gamificationEngine');
        await recordFeedbackParticipation(item.kind);
      } catch {
        /* ignore */
      }
    } catch {
      remaining.push(item);
    }
  }
  await saveQueue(remaining);
}
