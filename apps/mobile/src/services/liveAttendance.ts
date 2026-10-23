import { doc, onSnapshot, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';

type ClassroomIdentity = { groupId: string; sessionId: string; userId: string };
type AttendanceAccess = {
  onActive?: (value: boolean) => void;
  onTeacher: (value: boolean) => void;
  onToken: (value: string | null) => void;
  onQrExpiresAt?: (value: number | null) => void;
  onJoined: (value: boolean) => void;
  onError: (message: string) => void;
};

export function attendanceExpiryMillis(value: unknown): number | null {
  try {
    let millis: number;
    if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
      millis = (value as { toMillis: () => number }).toMillis();
    } else if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
      millis = (value as { toDate: () => Date }).toDate().getTime();
    } else if (value instanceof Date) {
      millis = value.getTime();
    } else if (typeof value === 'string' || typeof value === 'number') {
      millis = new Date(value).getTime();
    } else {
      return null;
    }
    return Number.isFinite(millis) && millis > 0 ? millis : null;
  } catch {
    return null;
  }
}

export function subscribeClassroomAttendance(
  db: Firestore,
  identity: ClassroomIdentity,
  observer: AttendanceAccess,
  readToken = true,
): Unsubscribe {
  const { groupId, sessionId, userId } = identity;
  let disposed = false;
  let memberFailed = false;
  let generation = 0;
  let stopSecret: Unsubscribe | undefined;
  let stopRecord: Unsubscribe | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const clearToken = () => {
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    expiryTimer = undefined;
    observer.onToken(null);
    observer.onQrExpiresAt?.(null);
  };
  const clearAccess = () => {
    generation += 1;
    stopSecret?.();
    stopRecord?.();
    stopSecret = undefined;
    stopRecord = undefined;
    observer.onTeacher(false);
    observer.onActive?.(false);
    clearToken();
    observer.onJoined(false);
  };

  clearAccess();
  const stopMember = onSnapshot(
    doc(db, 'groups', groupId, 'members', userId),
    { includeMetadataChanges: true },
    (member) => {
      if (disposed || memberFailed) return;
      clearAccess();
      if (member.metadata.fromCache || member.metadata.hasPendingWrites) return;
      const data = member.data();
      if (!member.exists() || data?.status !== 'active') return;
      observer.onActive?.(true);
      const currentGeneration = generation;
      const current = () => !disposed && generation === currentGeneration;
      const isTeacher = data.role === 'owner' || data.role === 'instructor';
      observer.onTeacher(isTeacher);
      if (isTeacher && readToken) {
        let secretFailed = false;
        stopSecret = onSnapshot(
          doc(db, 'groups', groupId, 'liveSessionSecrets', sessionId),
          { includeMetadataChanges: true },
          (secret) => {
            if (!current() || secretFailed) return;
            clearToken();
            if (secret.metadata.fromCache || secret.metadata.hasPendingWrites) return;
            const token = secret.data()?.qrToken;
            const expiresAt = attendanceExpiryMillis(secret.data()?.qrExpiresAt);
            if (
              typeof token !== 'string' ||
              !/^[A-Za-z0-9_-]{43}$/.test(token) ||
              expiresAt === null
            ) {
              observer.onError('無法確認簽到碼或有效期限，請重新進入課堂。');
              return;
            }
            observer.onQrExpiresAt?.(expiresAt);
            const expire = () => {
              if (!current()) return;
              observer.onToken(null);
              observer.onError('簽到碼已到期，請結束後重新開始點名。');
            };
            if (expiresAt <= Date.now()) {
              expire();
              return;
            }
            observer.onToken(token);
            expiryTimer = setTimeout(expire, expiresAt - Date.now());
          },
          () => {
            if (!current()) return;
            secretFailed = true;
            clearToken();
            observer.onError('無法載入簽到碼，請確認你仍有這門課的授課權限。');
          },
        );
      }
      let recordFailed = false;
      stopRecord = onSnapshot(
        doc(db, 'groups', groupId, 'attendanceSessions', sessionId, 'attendanceRecords', userId),
        { includeMetadataChanges: true },
        (record) => {
          if (current() && !recordFailed)
            observer.onJoined(
              !record.metadata.fromCache &&
                !record.metadata.hasPendingWrites &&
                record.exists() &&
                record.data()?.status === 'present',
            );
        },
        () => {
          if (!current()) return;
          recordFailed = true;
          observer.onJoined(false);
          observer.onError('無法確認你的簽到紀錄，請稍後再試。');
        },
      );
    },
    () => {
      if (disposed) return;
      memberFailed = true;
      clearAccess();
      observer.onError('無法確認課程成員資格，請重新進入課程。');
    },
  );

  return () => {
    disposed = true;
    generation += 1;
    stopMember();
    stopSecret?.();
    stopRecord?.();
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
  };
}

export function readAttendanceQr(data: string, groupId: string, sessionId: string): string {
  if (data.trim().startsWith('{')) {
    const payload = JSON.parse(data) as Record<string, unknown>;
    if (payload.groupId !== groupId || payload.sessionId !== sessionId) {
      throw new Error('請掃描老師目前課堂的 QR Code。');
    }
    if (typeof payload.qrToken !== 'string' || !payload.qrToken.trim()) {
      throw new Error('這個 QR Code 沒有簽到碼，請向老師確認。');
    }
    return payload.qrToken.trim();
  }
  const url = new URL(data);
  if (
    url.protocol !== 'campusone:' ||
    url.hostname !== 'classroom' ||
    url.pathname !== '/join' ||
    url.searchParams.get('groupId') !== groupId ||
    url.searchParams.get('sessionId') !== sessionId
  ) {
    throw new Error('請掃描老師目前課堂的 QR Code。');
  }
  const token = url.searchParams.get('token')?.trim();
  if (!token) throw new Error('這個 QR Code 沒有簽到碼，請向老師確認。');
  return token;
}

export async function joinClassroomAttendance(
  functions: Functions,
  input: { groupId: string; sessionId: string; qrToken: string },
): Promise<{ success: boolean; alreadyJoined?: boolean; checkedInAt?: string }> {
  const token = input.qrToken?.trim();
  if (!token) throw new Error('請先掃描老師的 QR Code 或輸入簽到碼。');
  const join = httpsCallable<
    { groupId: string; sessionId: string; qrToken: string },
    { success: boolean; alreadyJoined?: boolean; checkedInAt?: string }
  >(functions, 'joinLiveSession');
  const result = await join({ ...input, qrToken: token });
  if (!result.data.success) throw new Error('簽到尚未完成，請確認簽到碼後重試。');
  return result.data;
}
