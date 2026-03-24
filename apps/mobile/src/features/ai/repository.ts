import { buildUserSchoolCollectionPath } from '@campus/shared/src';
import { getDocs, limit, orderBy, query } from 'firebase/firestore';

import { collectionFromSegments } from '../../data/firestorePath';
import { getDb } from '../../firebase';
import { loadPersistedValue, removePersistedValue, savePersistedValue } from '../../services/persistedStorage';
import { getScopedStorageKey } from '../../services/scopedStorage';
import { listPendingAssignmentsForUserGroups, type PendingGroupAssignment } from '../groups/repository';

export const LEGACY_CHAT_HISTORY_KEY = 'ai_chat_history';

type MessageRole = 'user' | 'assistant' | 'system';

export type PersistedAiMessage = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  suggestions?: string[];
  actions?: Array<{ label: string; action: string; params?: Record<string, unknown> }>;
};

export type WeeklyReportRecord = {
  summary?: string;
  stats?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AiPersonalContext = {
  pendingAssignments: PendingGroupAssignment[];
  weeklyReport: WeeklyReportRecord | null;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export function getAIChatHistoryStorageKey(userId: string | null, schoolId: string | null): string {
  return getScopedStorageKey('ai-chat-history', { uid: userId, schoolId });
}

export async function loadAIChatHistory(storageKey: string): Promise<PersistedAiMessage[]> {
  return loadPersistedValue<PersistedAiMessage[]>({
    storageKey,
    legacyKeys: [LEGACY_CHAT_HISTORY_KEY],
    fallback: [],
    deserialize: (raw) => {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((entry) => toRecord(entry))
        .filter((entry) => typeof entry.id === 'string' && typeof entry.role === 'string')
        .map((entry) => ({
          id: String(entry.id),
          role: entry.role as MessageRole,
          content: typeof entry.content === 'string' ? entry.content : '',
          timestamp: toDate(entry.timestamp),
          suggestions: Array.isArray(entry.suggestions)
            ? entry.suggestions.filter((value): value is string => typeof value === 'string')
            : undefined,
          actions: Array.isArray(entry.actions)
            ? entry.actions
                .map((action) => toRecord(action))
                .filter((action) => typeof action.label === 'string' && typeof action.action === 'string')
                .map((action) => ({
                  label: String(action.label),
                  action: String(action.action),
                  params: toRecord(action.params),
                }))
            : undefined,
        }));
    },
  });
}

export async function saveAIChatHistory(
  storageKey: string,
  messages: PersistedAiMessage[],
  maxItems: number
): Promise<void> {
  await savePersistedValue(storageKey, messages.slice(-maxItems));
}

export async function clearAIChatHistory(storageKey: string): Promise<void> {
  await removePersistedValue(storageKey);
}

export async function loadAiPersonalContext(params: {
  uid: string;
  schoolId: string;
}): Promise<AiPersonalContext> {
  const db = getDb();
  const pendingAssignmentsPromise = listPendingAssignmentsForUserGroups(params.uid);
  const canonicalWeeklySnapshot = await getDocs(
    query(
      collectionFromSegments(db, buildUserSchoolCollectionPath(params.uid, params.schoolId, 'weeklyReports')),
      orderBy('generatedAt', 'desc'),
      limit(1)
    )
  ).catch(() => null);

  let weeklyReport: WeeklyReportRecord | null = null;

  if (canonicalWeeklySnapshot && !canonicalWeeklySnapshot.empty) {
    weeklyReport = toRecord(canonicalWeeklySnapshot.docs[0]?.data?.()) as WeeklyReportRecord;
  } else {
    const legacyWeeklySnapshot = await getDocs(
      query(collectionFromSegments(db, ['users', params.uid, 'weeklyReports']), orderBy('generatedAt', 'desc'), limit(1))
    ).catch(() => null);

    if (legacyWeeklySnapshot && !legacyWeeklySnapshot.empty) {
      weeklyReport = toRecord(legacyWeeklySnapshot.docs[0]?.data?.()) as WeeklyReportRecord;
    }
  }

  return {
    pendingAssignments: await pendingAssignmentsPromise,
    weeklyReport,
  };
}
