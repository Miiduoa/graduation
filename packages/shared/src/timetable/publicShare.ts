import { MAX_PERIOD_SLOTS } from './schoolPeriods';

type RecordData = Record<string, unknown>;
type ShareDatabase = {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): RecordData | undefined }>;
    };
  };
};

function record(value: unknown): RecordData {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordData
    : {};
}

function publicText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function publicTimetableMeta(value: unknown): RecordData {
  const input = record(value);
  const meta: RecordData = {};
  for (const [key, limit] of Object.entries({ school: 80, year: 12, semester: 12, className: 80, title: 80 })) {
    if (typeof input[key] === 'string') meta[key] = publicText(input[key], limit);
  }
  if (typeof input.credits === 'number' && Number.isFinite(input.credits)) {
    meta.credits = Math.max(0, Math.min(60, input.credits));
  }
  return meta;
}

export function publicTimetableCourses(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).map((item) => {
    const course = record(item);
    let day = Number(course.day);
    let start = Number(course.start);
    let end = Number(course.end);
    if (!Number.isInteger(day) || day < 0 || day > 5) day = 0;
    if (day === 0) {
      start = 0;
      end = 0;
    } else {
      if (!Number.isInteger(start) || start < 1 || start > MAX_PERIOD_SLOTS) start = 1;
      if (!Number.isInteger(end) || end < start || end > MAX_PERIOD_SLOTS) end = start;
    }
    const color = publicText(course.color, 12);
    return {
      id: publicText(course.id, 120) || globalThis.crypto.randomUUID(),
      name: publicText(course.name, 100) || '未命名課程',
      day, start, end,
      teacher: '',
      room: publicText(course.room, 80),
      color: ['violet', 'blue', 'mint', 'orange', 'pink', 'lime', 'gray'].includes(color) ? color : 'gray',
    };
  });
}

export async function readPublicTimetableShare(db: ShareDatabase, token: string) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(token)) {
    return { status: 400, body: { code: 'invalid', error: '分享碼不正確。' } };
  }
  const snapshot = await db.collection('timetableShares').doc(token).get();
  if (!snapshot.exists) {
    return { status: 404, body: { code: 'missing', error: '這份分享不存在或已撤回。' } };
  }
  const data = snapshot.data() || {};
  if (data.revoked !== false) {
    return { status: 410, body: { code: 'revoked', error: '這份分享已撤回。' } };
  }
  const timestamp = record(data.expiresAt);
  const expires = typeof timestamp.toMillis === 'function' ? timestamp.toMillis() : NaN;
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    return { status: 410, body: { code: 'expired', error: '這份分享已過期。' } };
  }
  return {
    status: 200,
    body: {
      schoolId: publicText(data.schoolId, 80) || null,
      name: publicText(data.name, 40) || '課表',
      courses: publicTimetableCourses(data.courses),
      meta: publicTimetableMeta(data.meta),
      expiresAt: new Date(expires).toISOString(),
    },
  };
}
