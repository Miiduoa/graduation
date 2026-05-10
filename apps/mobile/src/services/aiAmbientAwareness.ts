import type { DataSource } from '../data/source';
import { loadAiPersonalContext, type AiPersonalContext } from '../features/ai';
import {
  emptyAIAppRuntimeData,
  loadAIAppRuntimeData,
  type AIAppRuntimeData,
} from './aiAppContext';

export type AIAmbientAwarenessReason =
  | 'startup'
  | 'mount'
  | 'foreground-timer'
  | 'app-active'
  | 'app-background'
  | 'manual';

export type AIAmbientAwarenessSnapshot = {
  runtimeData: AIAppRuntimeData;
  personalContext: AiPersonalContext | null;
  refreshedAt: number;
  reason: AIAmbientAwarenessReason | string;
};

const DEFAULT_MIN_INTERVAL_MS = 15_000;

let currentSnapshot: AIAmbientAwarenessSnapshot = {
  runtimeData: emptyAIAppRuntimeData(),
  personalContext: null,
  refreshedAt: 0,
  reason: 'startup',
};
let inFlight: Promise<AIAmbientAwarenessSnapshot> | null = null;
const listeners = new Set<(snapshot: AIAmbientAwarenessSnapshot) => void>();

function notify(snapshot: AIAmbientAwarenessSnapshot) {
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[AIAmbientAwareness] listener failed:', error);
    }
  });
}

export function getAIAmbientAwarenessSnapshot(): AIAmbientAwarenessSnapshot {
  return currentSnapshot;
}

export function subscribeAIAmbientAwareness(
  listener: (snapshot: AIAmbientAwarenessSnapshot) => void,
): () => void {
  listeners.add(listener);
  listener(currentSnapshot);
  return () => {
    listeners.delete(listener);
  };
}

export async function refreshAIAmbientAwareness(params: {
  dataSource: DataSource;
  userId?: string | null;
  schoolId?: string | null;
  reason?: AIAmbientAwarenessReason | string;
  force?: boolean;
  minIntervalMs?: number;
}): Promise<AIAmbientAwarenessSnapshot> {
  const now = Date.now();
  const minIntervalMs = params.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  if (!params.force && now - currentSnapshot.refreshedAt < minIntervalMs) {
    return currentSnapshot;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const [runtimeData, personalContext] = await Promise.all([
        loadAIAppRuntimeData({
          dataSource: params.dataSource,
          userId: params.userId ?? null,
          schoolId: params.schoolId ?? null,
        }),
        params.userId && params.schoolId
          ? loadAiPersonalContext({ uid: params.userId, schoolId: params.schoolId }).catch((error) => {
              console.warn('[AIAmbientAwareness] personal context load failed:', error);
              return null;
            })
          : Promise.resolve(null),
      ]);

      currentSnapshot = {
        runtimeData,
        personalContext,
        refreshedAt: Date.now(),
        reason: params.reason ?? 'manual',
      };
      notify(currentSnapshot);

      if (__DEV__) {
        console.log('[AIAmbientAwareness] refreshed:', {
          reason: currentSnapshot.reason,
          records:
            runtimeData.calendarEvents.length +
            runtimeData.notifications.length +
            runtimeData.orders.length +
            runtimeData.libraryLoans.length +
            runtimeData.printJobs.length +
            runtimeData.dormPackages.length +
            runtimeData.healthAppointments.length +
            runtimeData.enrollments.length +
            runtimeData.grades.length,
          blocked: Object.keys(runtimeData.loadIssues ?? {}).length,
        });
      }

      return currentSnapshot;
    } catch (error) {
      console.warn('[AIAmbientAwareness] refresh failed:', error);
      return currentSnapshot;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
