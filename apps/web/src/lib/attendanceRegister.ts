import { readAttendanceReceipt } from '@campus/shared/src/attendanceReliability';
export const REGISTER_LABELS = {
  present: '出席', late: '遲到', absent: '缺席', excused: '請假',
  unconfirmed: '尚無紀錄', unavailable: '待核實',
} as const;

export type RegisterStatus = keyof typeof REGISTER_LABELS;
export type RegisterFilter = 'all' | RegisterStatus;
export type RegisterStudent = { uid: string; displayName: string; studentId: string };
export type RegisterRow = RegisterStudent & {
  status: RegisterStatus;
  source: 'qr' | 'manual' | null;
  checkedInAt: string | null;
  correctedAt: string | null;
};
export type RegisterDocument = { id: string; data: Record<string, unknown> };
export type AttendanceRegister = {
  rows: RegisterRow[];
  complete: boolean;
  checkedAt: string;
  active: boolean;
};

/** 缺少紀錄只代表尚未查到，不能代替教師核定缺席。 */
export function assembleAttendanceRegister(
  students: RegisterStudent[],
  documents: RegisterDocument[],
  scope: { courseId: string; sessionId: string; complete: boolean },
): RegisterRow[] {
  const records = new Map(documents.map((document) => [document.id, document.data]));
  return students.map((student) => {
    const empty: RegisterRow = {
      ...student, status: scope.complete ? 'unconfirmed' : 'unavailable',
      source: null, checkedInAt: null, correctedAt: null,
    };
    const data = records.get(student.uid);
    if (!data) return empty;
    const receipt = readAttendanceReceipt(data, {
      groupId: scope.courseId, sessionId: scope.sessionId, userId: student.uid,
    });
    return receipt ? { ...student, ...receipt } : { ...empty, status: 'unavailable' };

  });
}

export function summarizeAttendanceRegister(rows: RegisterRow[]): Record<RegisterStatus, number> {
  const counts: Record<RegisterStatus, number> = {
    present: 0, late: 0, absent: 0, excused: 0, unconfirmed: 0, unavailable: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export function filterAttendanceRegister(
  rows: RegisterRow[], filter: RegisterFilter, query: string,
): RegisterRow[] {
  const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
  const term = normalize(query);
  return rows.filter((row) => (filter === 'all' || row.status === filter) &&
    (!term || [row.displayName, row.studentId, row.uid].some((value) => normalize(value).includes(term))));
}

export function attendanceRegisterCsv(rows: RegisterRow[], checkedAt: string): string {
  const cell = (value: string) => {
    const safe = /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const data = [
    ['學號或帳號', '姓名', '出席狀態', '紀錄來源', '簽到時間', '教師核定時間', '本次查核時間'],
    ...rows.map((row) => [
      row.studentId || row.uid, row.displayName, REGISTER_LABELS[row.status],
      row.source === 'manual' ? '教師補登' : row.source === 'qr' ? 'QR 簽到' : '未標記',
      row.checkedInAt ?? '', row.correctedAt ?? '', checkedAt,
    ]),
  ];
  return '\uFEFF' + data.map((row) => row.map(cell).join(',')).join('\r\n');
}
