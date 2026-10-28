// @vitest-environment node
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPuCampusGateway } from './puCampusClient';
import { createTronClassCoursesHandler } from './tronClassCoursesHandler';
import { tronClassSchoolSource } from './tronClassSchoolSource';
import type { AcademicFirestore, SchoolDataSnapshot } from './academicRecordsHandlers';
import { loadTronClassCourses } from '../tronClassCourses';

const auth = vi.hoisted(() => ({
  user: { uid: 'pu:fixture', getIdToken: vi.fn(async () => 'fixture-id-token') },
}));
vi.mock('../firebase', () => ({
  getAuth: () => ({ currentUser: auth.user }),
  isFirebaseConfigured: () => true,
  getCloudFunctionUrl: () => '/api/fn/getMyTronClassCourses',
}));
const uid = 'pu:fixture';
const linkedId = 'a'.repeat(32);
const now = Date.parse('2026-10-28T00:00:00Z');
const request = { auth: { uid, token: { schoolId: 'pu' } }, data: { status: 'ongoing' } };
function database(cookies: Record<string, string>) {
  const docs: Record<string, Record<string, unknown>> = {
    [`users/${uid}`]: { schoolId: 'pu' },
    [`schools/pu/members/${uid}`]: { status: 'active' },
    '_puSessions/current': { ownerUid: uid, expiresAt: new Date(now + 60000), tronClassSessionId: linkedId },
    [`_puTronClassSessions/${linkedId}`]: { ownerUid: uid, expiresAt: new Date(now + 60000), cookies, userId: 44 },
  };
  const snapshot = (path: string): SchoolDataSnapshot => ({ exists: !!docs[path], data: () => docs[path] });
  const ref = (path: string) => ({ get: async () => snapshot(path) });
  const query: ReturnType<AcademicFirestore['collection']> = {
    where: (field, operator, value) => {
      expect([field, operator, value]).toEqual(['ownerUid', '==', uid]); return query;
    },
    orderBy: () => query, limit: () => query,
    get: async () => ({ docs: [{ ...snapshot('_puSessions/current'), ref: ref('_puSessions/current') }] }),
  };
  const db: AcademicFirestore = { doc: ref, collection: () => query };
  return { db, docs };
}
function upstream(courses: unknown[], cookie = 'session=verified') {
  return vi.spyOn(https, 'request').mockImplementation((options: unknown, callback: unknown) => {
    const input = options as { headers: Record<string, string>; hostname: string; path: string };
    expect(input.hostname).toBe('tronclass.pu.edu.tw');
    expect(input.path).toBe('/api/my-courses');
    expect(input.headers.Cookie).toBe(cookie);
    const req = Object.assign(new EventEmitter(), {
      write: vi.fn(), destroy: vi.fn(),
      end: () => {
        const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
        (callback as (response: unknown) => void)(res);
        res.emit('data', Buffer.from(JSON.stringify({ courses, pages: 1 })));
        res.emit('end');
      },
    });
    return req as unknown as ReturnType<typeof https.request>;
  });
}
function callable(result: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/fn/getMyTronClassCourses');
    expect(init?.cache).toBe('no-store');
    expect(JSON.parse(String(init?.body))).toEqual({ data: { status: 'ongoing' } });
    return new Response(JSON.stringify({ result }), { status: 200 });
  }));
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('WOW Class course credit pipeline', () => {
  it('carries the verified session and original credits through real source, handler and browser decoder', async () => {
    const gateway = createPuCampusGateway({ fetch: async (url) => new Response(JSON.stringify({
      id: 44, login_name: '412345678', name: '測試同學', role: 'student',
    }), { status: 200, headers: { 'Set-Cookie': `session=${url.endsWith('/api/profile') ? 'verified' : 'before'}; Path=/` } }) });
    const session = await gateway.loginTronClass('412345678', 'fixture-password', { route: 'student' });
    const { db } = database(session.cookies);
    const raw = [0, '0.5', 3, null].map((credit, index) => ({
      id: index + 1, name: `課程${index}`, course_code: `00${index}`, credit, semester: { name: '1151' },
      teachers: [{ name: '測試老師' }], internal_cookie: 'must-not-leak',
    }));
    const fetch = upstream(raw);
    const handler = createTronClassCoursesHandler({ db, fetchCourses: tronClassSchoolSource, now: () => now });
    const result = await handler(request);
    callable(result);
    const view = await loadTronClassCourses(uid);
    expect(view.courses.map((row) => row.credit)).toEqual([0, 0.5, 3, null]);
    expect(view.courses.map((row) => row.code)).toEqual(['000', '001', '002', '003']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|session|verified|fixture-password/);
    expect(result).toMatchObject({ ownerUid: uid, schoolId: 'pu', source: 'pu-tronclass' });
  });

  it.each([undefined, null, '', 'unknown', false, -1, {}, []].map((credit) => [credit]))('keeps unavailable source credits unknown, not zero: %j', async (credit) => {
    const { db } = database({ session: 'verified' });
    upstream([{ id: 1, name: '來源課程', credit }]);
    const result = await createTronClassCoursesHandler({ db, fetchCourses: tronClassSchoolSource, now: () => now })(request);
    callable(result);
    expect((await loadTronClassCourses(uid)).courses[0].credit).toBeNull();
  });

  it('retains the existing credits alias from the real school parser', async () => {
    const { db } = database({ session: 'verified' });
    upstream([{ id: 1, name: '來源課程', credits: '2.5' }]);
    const result = await createTronClassCoursesHandler({ db, fetchCourses: tronClassSchoolSource, now: () => now })(request);
    expect(result.courses[0].credit).toBe(2.5);
  });

  it('does not release read data when membership is revoked during the school request', async () => {
    const { db, docs } = database({ session: 'verified' });
    const handler = createTronClassCoursesHandler({ db, now: () => now, fetchCourses: async () => {
      docs[`schools/pu/members/${uid}`].status = 'disabled';
      return [{ id: 1, name: '來源課程', credit: 3 }];
    } });
    await expect(handler(request)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it.each([-1, '3', '', true, {}, []].map((credit) => [credit]))('rejects invalid public API credit values without coercion: %j', async (credit) => {
    callable({ success: true, ownerUid: uid, schoolId: 'pu', source: 'pu-tronclass',
      fetchedAt: new Date(now).toISOString(), status: 'ongoing',
      courses: [{ id: 1, name: '課程', code: '0001', teachers: [], semester: null, status: 'ongoing', credit }],
    });
    await expect(loadTronClassCourses(uid)).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('remains compatible with an older server that has no credit field', async () => {
    callable({ success: true, ownerUid: uid, schoolId: 'pu', source: 'pu-tronclass',
      fetchedAt: new Date(now).toISOString(), status: 'ongoing',
      courses: [{ id: 1, name: '課程', code: '0001', teachers: [], semester: null, status: 'ongoing' }],
    });
    expect((await loadTronClassCourses(uid)).courses[0].credit).toBeNull();
  });
});
