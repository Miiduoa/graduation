import type { LmsCourseError, LmsHomeworkItem, LmsReadonlySnapshot } from './tronClassLmsTypes';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function readHomework(value: unknown, legacy: boolean): LmsHomeworkItem {
  const row = asRecord(value);
  const id = positiveId(row?.id);
  const courseId = positiveId(row?.courseId);
  if (!row || !id || !courseId || typeof row.courseName !== 'string' || typeof row.title !== 'string' ||
    !(row.deadline === null || typeof row.deadline === 'string') || typeof row.deadlineLabel !== 'string' ||
    (typeof row.submitted !== 'boolean' && row.submitted !== null) || typeof row.description !== 'string' ||
    typeof row.href !== 'string' || !row.href.startsWith('https://tronclass.pu.edu.tw/')) {
    throw new Error('Invalid homework');
  }
  // Older servers also sent false when the school supplied no usable status.
  const submitted = legacy && row.submitted === false ? null : row.submitted;
  return {
    id, courseId, courseName: row.courseName, title: row.title, deadline: row.deadline,
    deadlineLabel: row.deadlineLabel, submitted, description: row.description, href: row.href,
  };
}

// Unversioned clients require strictly boolean homework rows. Keep the same projection
// in Firestore so a rolled-back server can still serve the confirmed part of the feed.
export function encodeLmsSnapshot(snapshot: LmsReadonlySnapshot) {
  const homework: LmsHomeworkItem[] = [];
  const unconfirmedHomework: { index: number; item: LmsHomeworkItem }[] = [];
  const courseErrors: (LmsCourseError & { unconfirmedSubmission?: true })[] = [...snapshot.courseErrors];
  const warned = new Set(courseErrors.filter((error) => error.area === 'homework').map((error) => error.courseId));
  for (const [index, item] of snapshot.homework.entries()) {
    if (item.submitted !== null) {
      homework.push(item);
      continue;
    }
    unconfirmedHomework.push({ index, item });
    // The original decoder accepts at most 500 course warnings.
    if (!warned.has(item.courseId) && courseErrors.length < 500) {
      warned.add(item.courseId);
      courseErrors.push({
        courseId: item.courseId, courseName: item.courseName, area: 'homework',
        status: null, unconfirmedSubmission: true,
      });
    }
  }
  return { ...snapshot, homework, unconfirmedHomework, courseErrors };
}

export function decodeLmsSubmissions(row: Record<string, unknown>, legacy = false) {
  if (!Array.isArray(row.homework) || !Array.isArray(row.courseErrors) || row.homework.length > 5000) {
    throw new Error('Invalid homework list');
  }
  const confirmed = row.homework.map((item) => readHomework(item, legacy));
  if (legacy) return { homework: confirmed, courseErrors: row.courseErrors };

  const unknowns = row.unconfirmedHomework;
  if (!Array.isArray(unknowns) || confirmed.length + unknowns.length > 5000 ||
      confirmed.some((item) => item.submitted === null)) throw new Error('Invalid homework list');
  const total = confirmed.length + unknowns.length;
  const homework = new Array<LmsHomeworkItem>(total);
  const unconfirmedCourses = new Set<number>();
  for (const value of unknowns) {
    const entry = asRecord(value);
    const index = entry?.index;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= total || homework[index]) {
      throw new Error('Invalid unconfirmed homework position');
    }
    const item = readHomework(entry?.item, false);
    if (item.submitted !== null) throw new Error('Invalid unconfirmed homework');
    homework[index] = item;
    unconfirmedCourses.add(item.courseId);
  }
  let next = 0;
  for (let index = 0; index < total; index++) {
    if (!homework[index]) homework[index] = confirmed[next++];
  }
  const courseErrors = row.courseErrors.filter((error) => {
    const value = asRecord(error);
    return !(value?.unconfirmedSubmission === true && value.area === 'homework' && value.status === null &&
      typeof value.courseId === 'number' && unconfirmedCourses.has(value.courseId));
  });
  return { homework, courseErrors };
}
