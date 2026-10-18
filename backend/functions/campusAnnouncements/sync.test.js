'use strict';

const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const {
  syncSource,
  visibleAnnouncements,
  feedStatus,
  UNAVAILABLE,
  assertSchoolScopedWrite,
} = require('./sync');
const { SOURCE_UNAVAILABLE } = require('./catalog');
const { robotsAllows, resetPoliteFetch } = require('./politeFetch');
const { countDrop } = require('./extract');

function memoryDb() {
  const docs = new Map();
  const makeRef = (path) => ({
    path,
    id: path.split('/').pop(),
    async set(data, opts = {}) {
      const prev = docs.get(path);
      docs.set(path, opts.merge && prev ? { ...prev, ...data } : { ...data });
    },
    async delete() {
      docs.delete(path);
    },
    async get() {
      const data = docs.get(path);
      return { exists: Boolean(data), id: this.id, data: () => data, ref: this };
    },
  });
  const collection = (base) => ({
    doc: (id) => makeRef(`${base}/${id}`),
    where: (field, _op, value) => ({
      async get() {
        const prefix = `${base}/`;
        const found = [];
        for (const [path, data] of docs) {
          if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
          if (data[field] === value) found.push({ id: path.slice(prefix.length), data: () => data, ref: makeRef(path) });
        }
        return { docs: found };
      },
    }),
  });
  return {
    docs,
    collection: (name) => ({
      doc: (id) => ({
        collection: (child) => collection(`${name}/${id}/${child}`),
      }),
    }),
    batch() {
      const ops = [];
      return {
        delete(ref) {
          ops.push(() => ref.delete());
        },
        async commit() {
          for (const op of ops) await op();
        },
      };
    },
  };
}

const source = {
  schoolId: 'pu',
  sourceId: 'pu-acd',
  office: '教務處',
  scope: 'office',
  kind: 'html_list',
  listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
  parsers: ['iwebTable', 'iwebLinks'],
  rateLimitMs: 0,
};

function htmlResponse(html, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => html,
  };
}

beforeEach(() => resetPoliteFetch());

test('successful fetch writes summaries with original URLs and does not keep login portal items', async () => {
  const db = memoryDb();
  const html = `
    <table><tr><td><a href="/p/412-1042-1.php">選課公告</a></td><td>2026-10-01</td></tr></table>
    <a href="https://alcat.pu.edu.tw/index_menu.php">E校園通知</a>
  `;
  const fetchImpl = jest.fn(async (url) => {
    if (String(url).endsWith('robots.txt')) return htmlResponse('User-agent: *\nAllow: /\n');
    return htmlResponse(html);
  });
  const result = await syncSource(source, { db, fetchImpl, now: () => 1_000, wait: async () => {} });
  expect(result.status).toBe('healthy');
  const written = [...db.docs.entries()].filter(([path]) => path.includes('/announcements/'));
  expect(written).toHaveLength(1);
  expect(written[0][1].originalUrl).toBe('https://acd.pu.edu.tw/p/412-1042-1.php');
  expect(written[0][1].body).toContain('選課');
  expect(written[0][1].origin).toBe('public_scrape');
  expect(JSON.stringify(written[0][1])).not.toMatch(/alcat/);
});

test('a failed fetch keeps previous scrape rows and does not clear lastSuccessAt', async () => {
  const db = memoryDb();
  db.docs.set('schools/pu/announcements/old', {
    sourceId: 'pu-acd',
    origin: 'public_scrape',
    title: '過期稿',
  });
  db.docs.set('schools/pu/announcements/manual', {
    sourceId: 'pu-acd',
    origin: 'editor',
    title: '校方自行發布',
  });
  db.docs.set('schools/pu/announcement-sources/pu-acd', {
    lastSuccessAt: 'kept',
    status: 'healthy',
  });
  const fetchImpl = jest.fn(async (url) => {
    if (String(url).endsWith('robots.txt')) return htmlResponse('User-agent: *\nAllow: /\n');
    return htmlResponse('', 500);
  });
  const result = await syncSource(source, { db, fetchImpl, now: () => 1_000, wait: async () => {} });
  expect(result.status).toBe(UNAVAILABLE);
  expect(db.docs.get('schools/pu/announcements/old').title).toBe('過期稿');
  expect(db.docs.get('schools/pu/announcements/manual').title).toBe('校方自行發布');
  expect(db.docs.get('schools/pu/announcement-sources/pu-acd').status).toBe(UNAVAILABLE);
  expect(db.docs.get('schools/pu/announcement-sources/pu-acd').lastSuccessAt).toBe('kept');
  expect(db.docs.get('schools/pu/announcement-sources/pu-acd').message).toBe(SOURCE_UNAVAILABLE);
});

test('visible feed hides stale scrape rows from a down source and labels a total outage', () => {
  const now = new Date('2026-10-18T00:00:00.000Z');
  const rows = [
    {
      id: 'a',
      sourceId: 'pu-acd',
      origin: 'public_scrape',
      title: '選課公告',
      publishedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'b',
      sourceId: 'pu-osa',
      origin: 'public_scrape',
      title: '學務處住宿申請',
      publishedAt: '2026-10-08T00:00:00.000Z',
    },
  ];
  const sources = [
    { sourceId: 'pu-acd', status: UNAVAILABLE },
    { sourceId: 'pu-osa', status: 'healthy' },
  ];
  expect(visibleAnnouncements(rows, sources, now).map((row) => row.id)).toEqual(['b']);
  expect(feedStatus(visibleAnnouncements(rows, sources, now), sources).status).toBe('ready');
  expect(feedStatus([], [{ status: UNAVAILABLE }, { status: UNAVAILABLE }])).toEqual({
    status: UNAVAILABLE,
    message: SOURCE_UNAVAILABLE,
  });
});

test('robots disallow and count drops are treated as failures', () => {
  expect(robotsAllows('User-agent: *\nDisallow: /p/\n', '/p/403-1.php')).toBe(false);
  expect(robotsAllows('User-agent: *\nAllow: /\n', '/p/403-1.php')).toBe(true);
  expect(countDrop(10, 2)).toBe(true);
  expect(countDrop(10, 8)).toBe(false);
});

test('FieldValue timestamps are used when writing health', async () => {
  expect(typeof FieldValue.serverTimestamp).toBe('function');
  expect(Timestamp.now()).toBeInstanceOf(Timestamp);
});

test('dry-run fetches and parses without writing Firestore', async () => {
  const db = memoryDb();
  const html = `<table><tr><td><a href="/p/412-1042-1.php">選課公告</a></td><td>2026-10-01</td></tr></table>`;
  const fetchImpl = jest.fn(async (url) => {
    if (String(url).endsWith('robots.txt')) return htmlResponse('User-agent: *\nAllow: /\n');
    return htmlResponse(html);
  });
  const result = await syncSource(source, {
    db,
    dryRun: true,
    fetchImpl,
    now: () => 1_000,
    wait: async () => {},
  });
  expect(result).toMatchObject({
    status: 'healthy',
    dryRun: true,
    itemCount: 1,
  });
  expect(result.items[0]).toMatchObject({
    schoolId: 'pu',
    title: '選課公告',
    originalUrl: 'https://acd.pu.edu.tw/p/412-1042-1.php',
    path: expect.stringMatching(/^schools\/pu\/announcements\//),
  });
  expect([...db.docs.keys()]).toEqual([]);
});

test('dry-run does not need Firestore', async () => {
  const html = `<table><tr><td><a href="/p/412-1042-1.php">選課公告</a></td><td>2026-10-01</td></tr></table>`;
  const result = await syncSource(source, {
    dryRun: true,
    fetchImpl: async (url) =>
      String(url).endsWith('robots.txt')
        ? htmlResponse('User-agent: *\nAllow: /\n')
        : htmlResponse(html),
    now: () => 1_000,
    wait: async () => {},
  });
  expect(result.status).toBe('healthy');
  expect(result.items).toHaveLength(1);
});

test('missing dates stay empty and leftover scrape rows are hidden instead of deleted', async () => {
  const db = memoryDb();
  db.docs.set('schools/pu/announcements/old', {
    sourceId: 'pu-acd',
    origin: 'public_scrape',
    title: '過期稿',
    visible: true,
    studentFeed: true,
  });
  const html = `<table><tr><td><a href="/p/412-1042-1.php">選課公告</a></td></tr></table>`;
  const result = await syncSource(source, {
    db,
    fetchImpl: async (url) =>
      String(url).endsWith('robots.txt')
        ? htmlResponse('User-agent: *\nAllow: /\n')
        : htmlResponse(html),
    now: () => 1_000,
    wait: async () => {},
  });
  expect(result.status).toBe('healthy');
  const written = [...db.docs.entries()].filter(([path]) => path.includes('/announcements/'));
  const current = written.find(([path]) => path !== 'schools/pu/announcements/old');
  expect(current[1].publishedAt).toBeNull();
  expect(db.docs.get('schools/pu/announcements/old')).toMatchObject({
    title: '過期稿',
    visible: false,
    studentFeed: false,
  });
});

test('writes stay inside the selected school announcement collections', () => {
  expect(() =>
    assertSchoolScopedWrite('pu', { path: 'schools/pu/announcements/pub_1' }),
  ).not.toThrow();
  expect(() =>
    assertSchoolScopedWrite('pu', { path: 'schools/pu/announcement-sources/pu-acd' }),
  ).not.toThrow();
  expect(() => assertSchoolScopedWrite('pu', { path: 'announcements/pub_1' })).toThrow(/refused/);
  expect(() =>
    assertSchoolScopedWrite('pu', { path: 'schools/nthu/announcements/pub_1' }),
  ).toThrow(/refused/);
});
