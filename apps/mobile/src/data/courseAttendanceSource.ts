import { collection, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { getCloudFunctionRegion, getDb, getFirebaseApp } from '../firebase';
import {
  parseLiveAttendanceConfirmation,
  type ConfirmedLiveAttendance,
} from '../services/attendanceConfirmation';
import { onAttendanceCheckin } from '../services/companionHooks';
import {
  startAttendanceSession as startWorkspaceAttendanceSession,
  toDate,
} from '../services/courseWorkspace';
import type { AttendanceSession, AttendanceSummary } from './types';

function requireDocumentId(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('/')) {
    throw new Error('缺少有效的課程或點名場次，請重新開啟課程。');
  }
  return value.trim();
}

export async function startAttendanceSession(input: {
  courseSpaceId: string;
  classroomLat?: number;
  classroomLng?: number;
  qrExpiryMinutes?: number;
}): Promise<{ success: boolean; sessionId: string; qrToken?: string; qrExpiresAt?: string }> {
  const groupId = requireDocumentId(input.courseSpaceId);
  return startWorkspaceAttendanceSession(
    getFunctions(getFirebaseApp(), getCloudFunctionRegion()),
    {
      groupId,
      classroomLat: input.classroomLat,
      classroomLng: input.classroomLng,
      qrExpiryMinutes: input.qrExpiryMinutes,
    },
  );
}

export async function checkInAttendance(input: {
  courseSpaceId: string;
  sessionId: string;
  qrToken?: string;
  uid?: string;
}): Promise<ConfirmedLiveAttendance> {
  const groupId = requireDocumentId(input.courseSpaceId);
  const sessionId = requireDocumentId(input.sessionId);
  const qrToken = typeof input.qrToken === 'string' ? input.qrToken.trim() : '';
  if (!qrToken) {
    throw new Error('請先掃描老師提供的點名 QR Code，再送出簽到。');
  }

  const joinLiveSession = httpsCallable<
    { groupId: string; sessionId: string; qrToken: string },
    unknown
  >(getFunctions(getFirebaseApp(), getCloudFunctionRegion()), 'joinLiveSession');
  const response = await joinLiveSession({ groupId, sessionId, qrToken });
  const confirmation = parseLiveAttendanceConfirmation(response.data);
  if (!confirmation) {
    throw new Error('伺服器尚未確認出席紀錄，請重新掃描點名 QR Code 或聯絡授課老師。');
  }

  try {
    await onAttendanceCheckin({ uid: input.uid, sessionId, courseSpaceId: groupId });
  } catch {
    // Optional companion feedback cannot undo an acknowledged check-in.
  }

  return confirmation;
}

export async function getAttendanceSummary(courseSpaceId: string): Promise<AttendanceSummary> {
  const groupId = requireDocumentId(courseSpaceId);
  // Room participation is not attendance. Read only the canonical records and
  // let read errors propagate instead of displaying them as zero attendance.
  const snapshot = await getDocs(collection(getDb(), 'groups', groupId, 'attendanceSessions'));
  const sessions: AttendanceSession[] = snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    const count = data.attendeeCount;
    return {
      id: docSnap.id,
      groupId,
      groupName: '',
      active: data.active === true,
      attendeeCount:
        typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0,
      startedAt: toDate(data.startedAt),
      endedAt: toDate(data.endedAt),
      source: 'attendance',
      attendanceMode: typeof data.attendanceMode === 'string' ? data.attendanceMode : null,
    };
  });
  const latestSession =
    [...sessions].sort(
      (left, right) => (right.startedAt?.getTime() ?? 0) - (left.startedAt?.getTime() ?? 0),
    )[0] ?? null;

  return {
    groupId,
    totalSessions: sessions.length,
    activeSessions: sessions.filter((session) => session.active).length,
    totalAttendees: sessions.reduce((sum, session) => sum + (session.attendeeCount ?? 0), 0),
    latestSession,
  };
}
