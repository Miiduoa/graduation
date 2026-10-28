import { toPublicSchoolId } from '../data/schoolIds';
import type { SchoolSyncSummary } from './schoolSyncSummary';

type Principal = { uid: string };
export type SchoolSyncPhase = 'campus' | 'learning' | 'finishing';
export type SchoolSyncAttempt = Readonly<{
  id: number;
  ownerUid: string;
  principal: number;
  schoolId: string;
}>;

export type SchoolLoginSyncSnapshot = Readonly<{
  attempt: SchoolSyncAttempt;
  phase: SchoolSyncPhase;
  status: 'syncing' | 'complete' | 'interrupted';
  startedAt: number;
  completedAt?: number;
  summary?: SchoolSyncSummary;
  collapsed: boolean;
}>;

const principals = new WeakMap<Principal, number>();
const listeners = new Set<() => void>();
let principalSequence = 0;
let attemptSequence = 0;
let snapshot: SchoolLoginSyncSnapshot | null = null;

function principalId(user: Principal): number {
  const existing = principals.get(user);
  if (existing !== undefined) return existing;
  const id = ++principalSequence;
  principals.set(user, id);
  return id;
}

function publish(next: SchoolLoginSyncSnapshot | null): void {
  if (snapshot === next) return;
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeSchoolLoginSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSchoolLoginSyncSnapshot(): SchoolLoginSyncSnapshot | null {
  return snapshot;
}

/** Only a verified login creates a receipt; no credentials or academic rows are retained here. */
export function beginSchoolLoginSync(user: Principal, schoolId: string): SchoolSyncAttempt {
  const attempt = Object.freeze({
    id: ++attemptSequence,
    ownerUid: user.uid,
    principal: principalId(user),
    schoolId: toPublicSchoolId(schoolId) || schoolId,
  });
  publish({ attempt, phase: 'campus', status: 'syncing', startedAt: Date.now(), collapsed: false });
  return attempt;
}

export function isSchoolLoginSyncOwner(
  value: SchoolLoginSyncSnapshot | null,
  user: Principal | null | undefined,
  schoolId: string | null | undefined,
): value is SchoolLoginSyncSnapshot {
  return Boolean(
    value &&
    user &&
    value.attempt.ownerUid === user.uid &&
    value.attempt.principal === principals.get(user) &&
    value.attempt.schoolId === toPublicSchoolId(schoolId),
  );
}

export function updateSchoolLoginSync(attempt: SchoolSyncAttempt, phase: SchoolSyncPhase): void {
  if (snapshot?.attempt !== attempt || snapshot.status !== 'syncing') return;
  publish({ ...snapshot, phase });
}

export function completeSchoolLoginSync(
  attempt: SchoolSyncAttempt,
  summary: SchoolSyncSummary,
): void {
  if (snapshot?.attempt !== attempt || snapshot.status !== 'syncing') return;
  publish({
    ...snapshot,
    status: 'complete',
    completedAt: Date.now(),
    summary: { incomplete: summary.incomplete, items: summary.items.map((item) => ({ ...item })) },
  });
}

export function interruptSchoolLoginSync(attempt: SchoolSyncAttempt): void {
  if (snapshot?.attempt !== attempt || snapshot.status !== 'syncing') return;
  publish({ ...snapshot, status: 'interrupted', completedAt: Date.now() });
}

export function setSchoolLoginSyncCollapsed(attempt: SchoolSyncAttempt, collapsed: boolean): void {
  if (snapshot?.attempt !== attempt) return;
  publish({ ...snapshot, collapsed });
}

export function clearSchoolLoginSync(): void {
  publish(null);
}

/** Invalidate only the departing principal; a newer login may already have published its own work. */
export function invalidateSchoolLoginSync(
  user: Principal | null | undefined,
  schoolId: string | null,
): void {
  if (isSchoolLoginSyncOwner(snapshot, user, schoolId)) clearSchoolLoginSync();
}
