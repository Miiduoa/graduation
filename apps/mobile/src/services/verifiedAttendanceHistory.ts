import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { listCourseMemberships } from './courseWorkspace';
import { getDb } from '../firebase';

export type AttendanceReceiptStatus =
  | 'present'
  | 'late'
  | 'absent'
  | 'excused'
  | 'unconfirmed'
  | 'unavailable';

export type AttendanceHistoryEntry = {
  sessionId: string;
  startedAt: Date | null;
  active: boolean;
  status: AttendanceReceiptStatus;
  checkedInAt: Date | null;
};

export type VerifiedCourseHistory = {
  courseId: string;
  courseName: string;
  sessions: AttendanceHistoryEntry[];
  error: boolean;
};

const MAX_RECENT_SESSIONS = 30;
const RECEIPT_STATUSES = new Set<AttendanceReceiptStatus>([
  'present',
  'late',
  'absent',
  'excused',
]);

function asDate(value: unknown): Date | null {
  if (!value) return null;
  try {
    const date =
      typeof (value as { toDate?: unknown }).toDate === 'function'
        ? (value as { toDate: () => Date }).toDate()
        : value instanceof Date
          ? value
          : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

/**
 * A missing receipt is not proof of absence. Only the server-owned record
 * for the signed-in member can confirm an attendance status.
 */
export function verifiedReceiptStatus(
  data: Record<string, unknown> | null,
  identity: { uid: string; groupId: string; sessionId: string },
): AttendanceReceiptStatus {
  if (!data) return 'unconfirmed';
  const status = data.status;
  if (
    data.uid !== identity.uid ||
    data.groupId !== identity.groupId ||
    data.sessionId !== identity.sessionId ||
    typeof status !== 'string' ||
    !RECEIPT_STATUSES.has(status as AttendanceReceiptStatus) ||
    (['present', 'late'].includes(status) && !asDate(data.checkedInAt))
  ) {
    return 'unavailable';
  }
  return status as AttendanceReceiptStatus;
}

export function summarizeVerifiedAttendance(courses: VerifiedCourseHistory[]) {
  const sessions = courses.flatMap((course) => course.sessions);
  return {
    sessions: sessions.length,
    confirmed: sessions.filter((entry) => entry.status === 'present' || entry.status === 'late')
      .length,
    excused: sessions.filter((entry) => entry.status === 'excused').length,
    absent: sessions.filter((entry) => entry.status === 'absent').length,
    unconfirmed: sessions.filter((entry) => entry.status === 'unconfirmed').length,
    unavailable: sessions.filter((entry) => entry.status === 'unavailable').length,
  };
}

export async function loadVerifiedAttendanceHistory(
  db: Firestore,
  uid: string,
  schoolId?: string,
): Promise<VerifiedCourseHistory[]> {
  if (!uid) return [];
  const memberships = await listCourseMemberships(db, uid, schoolId);

  return Promise.all(
    memberships.map(async (membership) => {
      try {
        // Same schema-v2 server-owned sessions used by the teacher roster.
        const snapshot = await getDocsFromServer(
          query(
            collection(db, 'groups', membership.groupId, 'attendanceSessions'),
            where('schemaVersion', '==', 2),
            orderBy('startedAt', 'desc'),
            limit(MAX_RECENT_SESSIONS),
          ),
        );
        const sessions = await Promise.all(
          snapshot.docs.map(async (session) => {
            const data = session.data();
            const base = {
              sessionId: session.id,
              startedAt: asDate(data.startedAt),
              active: data.active === true,
            };
            try {
              const receipt = await getDocFromServer(
                doc(
                  db,
                  'groups',
                  membership.groupId,
                  'attendanceSessions',
                  session.id,
                  'attendanceRecords',
                  uid,
                ),
              );
              const row = receipt.exists() ? receipt.data() : null;
              const status = verifiedReceiptStatus(row, {
                uid,
                groupId: membership.groupId,
                sessionId: session.id,
              });
              return {
                ...base,
                status,
                checkedInAt:
                  (status === 'present' || status === 'late') && row
                    ? asDate(row.checkedInAt)
                    : null,
              } satisfies AttendanceHistoryEntry;
            } catch {
              return { ...base, status: 'unavailable', checkedInAt: null } satisfies AttendanceHistoryEntry;
            }
          }),
        );
        return {
          courseId: membership.groupId,
          courseName: membership.name,
          sessions,
          error: false,
        } satisfies VerifiedCourseHistory;
      } catch {
        // Keep the course visible while making incomplete data explicit.
        return {
          courseId: membership.groupId,
          courseName: membership.name,
          sessions: [],
          error: true,
        } satisfies VerifiedCourseHistory;
      }
    }),
  );
}

/** Screen-facing adapter: Firebase setup belongs in the data service, not the view. */
export function loadMyVerifiedAttendanceHistory(uid: string, schoolId?: string) {
  return loadVerifiedAttendanceHistory(getDb(), uid, schoolId);
}
