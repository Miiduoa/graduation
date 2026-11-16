// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { createCareerInternshipHandlers } from './careerInternshipHandlers';
import { internshipRecord } from '@campus/shared/testFixtures/careerInternship';
import type { InternshipCommand } from '@campus/shared/src/careerInternship';

// A bounded query/transaction double: no SDK initialization or emulator connection.
function memoryStore() {
  const rows = new Map<string, Record<string, unknown>>();
  let reads = 0;
  let pages = 0;
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1)!,
    path,
    exists: rows.has(path),
    data: () => rows.get(path),
  });
  class Query {
    constructor(
      readonly path: string,
      readonly filters: [string, string, unknown][] = [],
      readonly count = Infinity,
      readonly cursor = '',
    ) {}
    doc(id: string) {
      return new Query(`${this.path}/${id}`);
    }
    collection(name: string) {
      return new Query(`${this.path}/${name}`);
    }
    where(field: string, op: string, value: unknown) {
      return new Query(this.path, [...this.filters, [field, op, value]], this.count, this.cursor);
    }
    limit(count: number) {
      return new Query(this.path, this.filters, count, this.cursor);
    }
    startAfter(doc: ReturnType<typeof snapshot>) {
      pages++;
      return new Query(this.path, this.filters, this.count, doc.path);
    }
  }
  const get = async (query: Query) => {
    if (query.path.split('/').length % 2 === 0) {
      reads++;
      return snapshot(query.path);
    }
    const nameQuery = query.filters.some(([field]) => field === 'displayName');
    const compare = (a: string, b: string) => {
      const av = nameQuery ? String(rows.get(a)?.displayName) : a;
      const bv = nameQuery ? String(rows.get(b)?.displayName) : b;
      return av < bv ? -1 : av > bv ? 1 : a < b ? -1 : a > b ? 1 : 0;
    };
    const paths = [...rows.keys()]
      .filter(
        (path) =>
          path.startsWith(`${query.path}/`) &&
          path.split('/').length === query.path.split('/').length + 1 &&
          query.filters.every(([field, op, value]) => {
            const actual = rows.get(path)?.[field];
            if (typeof actual !== typeof value) return false;
            return op === '=='
              ? actual === value
              : op === '>='
                ? actual! >= value!
                : actual! <= value!;
          }),
      )
      .sort(compare)
      .filter((path) => !query.cursor || compare(path, query.cursor) > 0)
      .slice(0, query.count);
    reads += Math.max(1, paths.length);
    return { docs: paths.map(snapshot), size: paths.length };
  };
  const tx = { get, getAll: (...refs: Query[]) => Promise.all(refs.map(get)) };
  const db = {
    doc: (path: string) => new Query(path),
    collection: (path: string) => new Query(path),
    runTransaction: (fn: (tx: unknown) => unknown) => fn(tx),
  } as unknown as Firestore;
  rows.set('schools/pu/members/student', { status: 'active', role: 'student' });
  const handler = createCareerInternshipHandlers({ db });
  return {
    rows,
    stats: () => ({ reads, pages }),
    call: (command: InternshipCommand) =>
      handler({ auth: { uid: 'student' }, data: { ...command, schoolId: 'pu' } }),
  };
}

describe('advisor search with a document budget', () => {
  it.each(['members', 'directory'])(
    'pages past students in %s to find a surname advisor',
    async (source) => {
      const { rows, call, stats } = memoryStore();
      for (let i = 0; i < 30; i++) {
        rows.set(`schools/pu/members/s${i}`, {
          status: 'active',
          role: 'student',
          displayName: `王同學${String(i).padStart(2, '0')}`,
        });
        if (source === 'directory')
          rows.set(`schools/pu/directory/s${i}`, {
            displayName: `王同學${String(i).padStart(2, '0')}`,
          });
      }
      rows.set('schools/pu/members/teacher', {
        status: 'active',
        role: 'teacher',
        ...(source === 'members' ? { displayName: '王老師' } : {}),
      });
      rows.set('schools/pu/directory/teacher', {
        displayName: '王老師',
        email: 'teacher@school.edu.tw',
      });
      const result = await call({ action: 'advisorSearch', keyword: '王' });
      expect(result.snapshot?.advisors).toEqual([
        { uid: 'teacher', name: '王老師', email: 'teacher@school.edu.tw', department: '' },
      ]);
      expect(stats().pages).toBeGreaterThan(0);
      expect(stats().reads).toBeLessThanOrEqual(202); // 200 search + actor and service role
      expect(
        (await call({ action: 'advisorSearch', keyword: '王老師' })).snapshot?.advisors?.[0].uid,
      ).toBe('teacher');
    },
  );
  it.each(['members', 'directory', 'users'])(
    'keeps legacy identifiers and email in %s searchable',
    async (source) => {
      for (const field of ['studentId', 'student_id', 'login', 'email']) {
        const { rows, call } = memoryStore();
        rows.set('schools/pu/members/teacher', {
          status: 'active',
          role: 'teacher',
          displayName: '王老師',
        });
        const path = source === 'users' ? 'users/teacher' : `schools/pu/${source}/teacher`;
        const value = field === 'email' ? 'teacher@school.edu.tw' : 'T0000001';
        rows.set(path, { ...rows.get(path), [field]: value });
        expect(
          (await call({ action: 'advisorSearch', keyword: value })).snapshot?.advisors?.map(
            (a) => a.uid,
          ),
        ).toEqual(['teacher']);
      }
    },
  );
  it('excludes inactive and non-advisor members and rejects an empty keyword', async () => {
    const { rows, call } = memoryStore();
    for (const [uid, status, role] of [
      ['inactive', 'inactive', 'teacher'],
      ['student2', 'active', 'student'],
    ])
      rows.set(`schools/pu/members/${uid}`, { status, role, displayName: '王老師' });
    expect((await call({ action: 'advisorSearch', keyword: '王' })).snapshot?.advisors).toEqual([]);
    await expect(call({ action: 'advisorSearch', keyword: '' })).rejects.toMatchObject({
      code: 'invalid-argument',
      message: '請輸入指導老師姓名、學號或學校信箱。',
    });
  });
  it('stops reading when the budget is exhausted', async () => {
    const { rows, call, stats } = memoryStore();
    for (let i = 0; i < 300; i++)
      rows.set(`schools/pu/members/s${i}`, {
        status: 'active',
        role: 'student',
        displayName: `王同學${i}`,
      });
    expect((await call({ action: 'advisorSearch', keyword: '王' })).snapshot?.advisors).toEqual([]);
    expect(stats().reads).toBeLessThanOrEqual(202);
  });
  it('keeps default and maximum result limits', async () => {
    for (const [limit, expected] of [
      [undefined, 20],
      [100, 50],
    ] as const) {
      const { rows, call, stats } = memoryStore();
      for (let i = 0; i < 60; i++)
        rows.set(`schools/pu/members/t${i}`, {
          status: 'active',
          role: 'teacher',
          displayName: `王老師${i}`,
        });
      expect(
        (await call({ action: 'advisorSearch', keyword: '王', limit })).snapshot?.advisors,
      ).toHaveLength(expected);
      expect(stats().reads).toBeLessThanOrEqual(202);
    }
  });
});
it('retains revision rejection with copy matching the automatic reload', async () => {
  const { rows, call } = memoryStore();
  rows.set('schools/pu/internshipRecords/record', { ...internshipRecord(), revision: 2 });
  await expect(
    call({ action: 'removeHours', id: 'record', revision: 1, entryId: 'hours' }),
  ).rejects.toMatchObject({
    code: 'aborted',
    httpErrorCode: { status: 409 },
    message: '另一個視窗已更新這筆紀錄，已為你重新整理。',
  });
});
