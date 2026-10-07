import { doc, onSnapshot, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';

type ClassroomIdentity = { groupId: string; sessionId: string; userId: string };
type AttendanceAccess = {
  onActive?: (value: boolean) => void;
  onTeacher: (value: boolean) => void;
  onToken: (value: string | null) => void;
  onJoined: (value: boolean) => void;
  onError: (message: string) => void;
};

export function subscribeClassroomAttendance(
  db: Firestore,
  identity: ClassroomIdentity,
  observer: AttendanceAccess,
): Unsubscribe {
  const { groupId, sessionId, userId } = identity;
  let disposed = false;
  let generation = 0;
  let stopSecret: Unsubscribe | undefined;
  let stopRecord: Unsubscribe | undefined;
  const clearAccess = () => {
    generation += 1;
    stopSecret?.();
    stopRecord?.();
    stopSecret = undefined;
    stopRecord = undefined;
    observer.onTeacher(false);
    observer.onActive?.(false);
    observer.onToken(null);
    observer.onJoined(false);
  };

  clearAccess();
  const stopMember = onSnapshot(
    doc(db, 'groups', groupId, 'members', userId),
    (member) => {
      if (disposed) return;
      clearAccess();
      const data = member.data();
      if (!member.exists() || data?.status !== 'active') return;
      observer.onActive?.(true);
      const currentGeneration = generation;
      const current = () => !disposed && generation === currentGeneration;
      const isTeacher = data.role === 'owner' || data.role === 'instructor';
      observer.onTeacher(isTeacher);
      if (isTeacher) {
        stopSecret = onSnapshot(
          doc(db, 'groups', groupId, 'liveSessionSecrets', sessionId),
          (secret) => {
            if (!current()) return;
            const token = secret.data()?.qrToken;
            observer.onToken(typeof token === 'string' && token.trim() ? token : null);
          },
          () => {
            if (!current()) return;
            observer.onToken(null);
            observer.onError('無法載入簽到碼，請確認你仍有這門課的授課權限。');
          },
        );
      }
      stopRecord = onSnapshot(
        doc(db, 'groups', groupId, 'attendanceSessions', sessionId, 'attendanceRecords', userId),
        (record) => {
          if (current()) observer.onJoined(record.exists() && record.data()?.status === 'present');
        },
        () => {
          if (!current()) return;
          observer.onJoined(false);
          observer.onError('無法確認你的簽到紀錄，請稍後再試。');
        },
      );
    },
    () => {
      if (disposed) return;
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
