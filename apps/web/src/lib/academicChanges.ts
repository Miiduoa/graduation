import type {
  AcademicCourse,
  AcademicCourseResponse,
  AcademicGrade,
  AcademicGradeResponse,
} from './academicRecords';

export type AcademicChangeKind = 'courses' | 'grades';
export type AcademicChangeSnapshot = {
  ownerUid: string;
  schoolId: string;
  fetchedAt: string;
  records: AcademicCourseResponse | AcademicGradeResponse;
};
export type AcademicFieldChange = { label: string; before: string; after: string };
export type AcademicChange = {
  key: string;
  title: string;
  semester: string;
  type: 'added' | 'changed' | 'not-returned' | 'review';
  fields: AcademicFieldChange[];
};
export type AcademicChangeReport = {
  status: 'baseline' | 'compared' | 'scope-reset' | 'semester-reset' | 'empty' | 'stale' | 'limit';
  from: string | null;
  to: string;
  changes: AcademicChange[];
  total: number;
};

type Field = { label: string; value: string; display: string };
type Row = { key: string; title: string; semester: string; fields: Field[] };
const MAX_RECORDS = 5_000;
const text = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ');
const field = (label: string, value: string | number | null | undefined): Field => {
  const normalized = typeof value === 'number' ? String(value) : text(value);
  return { label, value: normalized, display: normalized || '未提供' };
};
function score(value: string | number): Field {
  const normalized = text(String(value));
  // 數字寫法可能變了，實際分數卻沒變。
  // 零是真實分數；未知或等第成績維持來源原文。
  const numeric = /^[-+]?\d+(?:\.\d+)?$/.test(normalized) && Number.isFinite(Number(normalized));
  return { label: '成績', value: numeric ? String(Number(normalized)) : normalized, display: normalized };
}
function gradeRow(row: AcademicGrade): Row {
  const semester = text(row.semester);
  const title = text(row.courseName);
  return {
    key: JSON.stringify([semester, title, text(row.class)]),
    title,
    semester,
    fields: [score(row.score), field('學分', row.credits), field('科目類別', row.courseType)],
  };
}
function courseRow(row: AcademicCourse, term: string | null): Row {
  const semester = text(row.semester ?? term);
  const periods = [...new Set(row.periods)].sort((a, b) => a - b).join('、');
  const weekday = row.dayOfWeek === null ? '未提供' : `星期${'一二三四五六日'[row.dayOfWeek - 1] ?? '?'}`;
  const clock = row.startTime && row.endTime ? `${row.startTime}–${row.endTime}` : '時刻未提供';
  return {
    key: JSON.stringify([semester, text(row.code) ? ['code', text(row.code)] : ['name', text(row.name)], text(row.classOffered)]),
    title: text(row.name),
    semester,
    fields: [
      field('課程名稱', row.name),
      field('上課時間', `${weekday} · ${periods ? `第 ${periods} 節` : '節次未提供'} · ${clock}`),
      field('教室', row.location),
      field('教師', row.teacherName),
      field('學分', row.credits),
      field('科目類別', row.courseType),
      field('原始時間資訊', row.timePlaceRaw),
      field('時間辨識提醒', row.scheduleWarning),
    ],
  };
}
function rows(kind: AcademicChangeKind, snapshot: AcademicChangeSnapshot): Row[] | null {
  const records = snapshot.records;
  if (kind === 'grades' && 'grades' in records) return records.grades.map(gradeRow);
  if (kind === 'courses' && 'courses' in records) {
    return records.courses.map((row) => courseRow(row, records.semester));
  }
  return null;
}
function count(snapshot: AcademicChangeSnapshot): number {
  return 'grades' in snapshot.records ? snapshot.records.grades.length : snapshot.records.courses.length;
}
function grouped(items: Row[]): Map<string, Row[]> {
  const result = new Map<string, Row[]>();
  for (const item of items) {
    const group = result.get(item.key);
    if (group) group.push(item);
    else result.set(item.key, [item]);
  }
  return result;
}
function fingerprint(row: Row): string {
  return JSON.stringify(row.fields.map((item) => [item.label, item.value]));
}
function sameGroup(before: Row[], after: Row[]): boolean {
  return before.length === after.length &&
    JSON.stringify(before.map(fingerprint).sort()) === JSON.stringify(after.map(fingerprint).sort());
}

/** 只比較成功讀取的結果。這些 ID 含會變動的值，不能當身分鍵。 */
export function compareAcademicSnapshots(
  kind: AcademicChangeKind,
  previous: AcademicChangeSnapshot | null,
  next: AcademicChangeSnapshot,
): AcademicChangeReport {
  const report = (status: AcademicChangeReport['status'], changes: AcademicChange[] = []): AcademicChangeReport => ({
    status, from: ['baseline', 'scope-reset', 'semester-reset'].includes(status) ? null : previous?.fetchedAt ?? null,
    to: next.fetchedAt, changes, total: count(next),
  });
  if (!next.ownerUid || !next.schoolId || !Number.isFinite(Date.parse(next.fetchedAt))) return report('stale');
  if (previous && (previous.ownerUid !== next.ownerUid || previous.schoolId !== next.schoolId)) return report('scope-reset');
  if (count(next) > MAX_RECORDS || (previous && count(previous) > MAX_RECORDS)) return report('limit');
  const afterRows = rows(kind, next);
  if (!afterRows) return report('scope-reset');
  if (!previous) return report('baseline');
  const beforeRows = rows(kind, previous);
  if (!beforeRows) return report('scope-reset');
  if (!Number.isFinite(Date.parse(previous.fetchedAt)) || Date.parse(next.fetchedAt) <= Date.parse(previous.fetchedAt)) {
    return report('stale');
  }
  if (kind === 'courses' && 'courses' in previous.records && 'courses' in next.records &&
    text(previous.records.semester) !== text(next.records.semester)) return report('semester-reset');
  if (!beforeRows.length) return report('baseline');
  // 整份回傳是空的，不能當成每門課都被退選。
  if (!afterRows.length) return report('empty');
  const before = grouped(beforeRows);
  const after = grouped(afterRows);
  const changes: AcademicChange[] = [];
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const key of keys) {
    const oldRows = before.get(key) ?? [];
    const newRows = after.get(key) ?? [];
    if (sameGroup(oldRows, newRows)) continue;
    const current = newRows[0] ?? oldRows[0];
    const change = (type: AcademicChange['type'], fields: AcademicFieldChange[] = []) => {
      changes.push({ key, title: current.title, semester: current.semester, type, fields });
    };
    // 成績可能沒有科目代碼；同名不同班次不可依陣列順序硬配。
    // 一門課有多個上課時段同樣要回頭核對來源，不能猜配對。
    if (oldRows.length > 1 || newRows.length > 1) {
      change('review');
    } else if (!oldRows.length) {
      change('added', current.fields.filter((item) => item.value).map((item) => ({ label: item.label, before: '', after: item.display })));
    } else if (!newRows.length) {
      change('not-returned');
    } else {
      const fields = current.fields.flatMap((item, index) => {
        const old = oldRows[0].fields[index];
        return old.value === item.value ? [] : [{ label: item.label, before: old.display, after: item.display }];
      });
      if (fields.length) change('changed', fields);
    }
  }
  return report('compared', changes);
}
