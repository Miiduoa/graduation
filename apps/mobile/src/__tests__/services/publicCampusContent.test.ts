import {
  collection,
  doc,
  documentId,
  startAfter,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  where,
} from 'firebase/firestore';
import { isFirebaseMockMode } from '../../firebase';
import {
  loadCampusAnnouncements,
  loadCampusAnnouncementFeed,
  loadCampusAnnouncement,
  loadCampusEvent,
  loadCampusEventPage,
  isPublicWebUrl,
} from '../../services/publicCampusContent';
import { getRawAppEnv } from '../../services/release';

jest.mock('firebase/firestore', () => ({
  collection: jest.fn((...args) => args),
  doc: jest.fn((...args) => args),
  documentId: jest.fn(() => '__name__'),
  startAfter: jest.fn((snapshot) => ({ after: snapshot })),
  getDocFromServer: jest.fn(),
  getDocsFromServer: jest.fn(),
  limit: jest.fn((count) => ({ limit: count })),
  orderBy: jest.fn((field, direction) => ({ orderBy: field, direction })),
  where: jest.fn((field, operator, value) => ({ where: field, operator, value })),
  query: jest.fn((...args) => args),
}));
jest.mock('../../firebase', () => ({
  getDb: jest.fn(() => 'db'),
  isFirebaseMockMode: jest.fn(() => false),
}));
jest.mock('../../services/release', () => ({
  getRawAppEnv: jest.fn(() => 'development'),
}));
const row = { title: '校方公告', body: '真實內文', publishedAt: '2026-10-08T00:00:00Z' };
const document = (data = row) => ({ id: 'a1', exists: () => true, data: () => data });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isFirebaseMockMode).mockReturnValue(false);
  jest.mocked(getRawAppEnv).mockReturnValue('development');
});

function docsForPath(input: unknown, announcements: unknown[], sources: unknown[] = []) {
  const path = JSON.stringify(input);
  if (path.includes('announcement-sources')) return { empty: sources.length === 0, docs: sources };
  return { empty: announcements.length === 0, docs: announcements };
}

test('reads school canonical server documents without a mock or cache fallback', async () => {
  jest.mocked(getDocsFromServer).mockImplementation(async (input) => docsForPath(input, [document()]) as never);
  await expect(loadCampusAnnouncements('pu')).resolves.toMatchObject([
    { id: 'a1', schoolId: 'pu', title: '校方公告' },
  ]);
  expect(collection).toHaveBeenCalledWith('db', 'schools', 'pu', 'announcements');
  expect(collection).toHaveBeenCalledWith('db', 'schools', 'pu', 'announcement-sources');
  expect(collection).not.toHaveBeenCalledWith('db', 'announcements');
});

test('an empty school collection is not filled from the root announcements collection', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce({ empty: true, docs: [] } as never)
    .mockImplementation(async (input) => docsForPath(input, [document()]) as never);
  await expect(loadCampusAnnouncements('pu')).resolves.toEqual([]);
  expect(collection).toHaveBeenCalledWith('db', 'schools', 'pu', 'announcements');
  expect(collection).not.toHaveBeenCalledWith('db', 'announcements');
  jest.clearAllMocks();
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadCampusAnnouncements('pu')).rejects.toThrow('permission-denied');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});

test('canonical and legacy details reject other-school data and preserve document IDs', async () => {
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce(document({ ...row, schoolId: 'other' } as never) as never);
  await expect(loadCampusAnnouncement('pu', 'a1')).rejects.toThrow('Invalid campus content');
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce({ exists: () => false } as never)
    .mockResolvedValueOnce(document({ ...row, schoolId: 'other' } as never) as never);
  await expect(loadCampusAnnouncement('pu', 'a1')).resolves.toBeNull();
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce(document({ ...row, id: 'forged' } as never) as never);
  await expect(loadCampusAnnouncement('pu', 'a1')).resolves.toMatchObject({ id: 'a1' });
  expect(doc).toHaveBeenLastCalledWith('db', 'schools', 'pu', 'announcements', 'a1');
});

test('missing IDs never fall back to sample content and invalid runtime never reads Firestore', async () => {
  await expect(loadCampusAnnouncement('pu', '')).resolves.toBeNull();
  await expect(loadCampusEvent('pu', '../other')).resolves.toBeNull();
  expect(getDocFromServer).not.toHaveBeenCalled();
  jest.mocked(isFirebaseMockMode).mockReturnValue(true);
  await expect(loadCampusAnnouncements('pu')).rejects.toThrow('Campus content unavailable');
  expect(getDocsFromServer).not.toHaveBeenCalled();
});

test('attachment links require safe web URLs and malformed dates are not invented', async () => {
  jest.mocked(getDocFromServer).mockResolvedValue(
    document({
      ...row,
      publishedAt: 'broken',
      attachments: [
        { name: '公告附件', url: 'https://school.edu/notice.pdf' },
        { name: 'Unsafe', url: 'javascript:alert(1)' },
        { name: 'Local file', url: 'file:///private/data' },
      ],
    } as never) as never,
  );
  const result = await loadCampusAnnouncement('pu', 'a1');
  expect(result?.publishedAt).toBe('');
  expect(result?.attachments).toHaveLength(1);
  expect(isPublicWebUrl('https://user:password@school.edu')).toBe(false);
});

test('empty announcement lists stay on the school collection with a bounded date ordering', async () => {
  jest.mocked(getDocsFromServer).mockResolvedValue({ empty: true, docs: [] } as never);
  await expect(loadCampusAnnouncements('pu')).resolves.toEqual([]);
  expect(collection).toHaveBeenCalledWith('db', 'schools', 'pu', 'announcements');
  expect(collection).not.toHaveBeenCalledWith('db', 'announcements');
  expect(orderBy).toHaveBeenCalledWith('publishedAt', 'desc');
  expect(limit).toHaveBeenCalledWith(200);
});

function missingIndexError() {
  return Object.assign(new Error('The query requires an index.'), { code: 'failed-precondition' });
}

function productionEmptySchoolRead(schoolId: string) {
  return async (input: unknown) => {
    const encoded = JSON.stringify(input ?? '');
    if (encoded.includes('announcement-sources')) return { empty: true, docs: [] };
    if (encoded.includes(`"schools","${schoolId}","announcements"`)) return { empty: true, docs: [] };
    if (encoded.includes('["db","announcements"]')) throw missingIndexError();
    return { empty: true, docs: [] };
  };
}

test.each(['ncku', 'ntpu', 'feu', 'mmc'] as const)(
  'keeps a successfully empty %s feed without querying the root announcements collection',
  async (schoolId) => {
    jest.mocked(getDocsFromServer).mockImplementation(productionEmptySchoolRead(schoolId) as never);
    await expect(loadCampusAnnouncementFeed(schoolId)).resolves.toEqual({
      announcements: [],
      sources: [],
      allUnavailable: false,
    });
    expect(collection).toHaveBeenCalledWith('db', 'schools', schoolId, 'announcements');
    expect(collection).not.toHaveBeenCalledWith('db', 'announcements');
    expect(orderBy).toHaveBeenCalledWith('publishedAt', 'desc');
  },
);

test('does not mix leftover root-collection rows from another school into an empty feed', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce({ empty: true, docs: [] } as never)
    .mockImplementation(async (input) =>
      docsForPath(input, [document({ ...row, schoolId: 'ntu', title: '臺大稿' })]) as never,
    );
  await expect(loadCampusAnnouncementFeed('ncku')).resolves.toEqual({
    announcements: [],
    sources: [],
    allUnavailable: false,
  });
  expect(collection).not.toHaveBeenCalledWith('db', 'announcements');
});

test.each(['ncku', 'ntpu'] as const)(
  'still rejects %s when the canonical dated query actually fails',
  async (schoolId) => {
    jest.mocked(getDocsFromServer).mockRejectedValueOnce(missingIndexError());
    await expect(loadCampusAnnouncementFeed(schoolId)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(getDocsFromServer).toHaveBeenCalledTimes(1);
  },
);

test('hides scrape rows from dead sources and exposes the office url', async () => {
  const scrape = document({
    ...row,
    origin: 'public_scrape',
    sourceId: 'pu-acd',
    originalUrl: 'https://acd.pu.edu.tw/p/412-1042-1.php',
    summary: '選課摘要',
  });
  jest.mocked(getDocsFromServer).mockImplementation(async (input) =>
    docsForPath(
      input,
      [scrape],
      [
        {
          id: 'pu-acd',
          data: () => ({
            sourceId: 'pu-acd',
            office: '教務處',
            status: 'unavailable',
            listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
            lastSuccessAt: '2026-10-12T10:05:00.000Z',
          }),
        },
      ],
    ) as never,
  );
  await expect(loadCampusAnnouncementFeed('pu')).resolves.toMatchObject({
    announcements: [],
    allUnavailable: true,
    sources: [
      {
        office: '教務處',
        status: 'unavailable',
        message: '暫時抓不到',
        listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php',
        lastSuccessAt: '2026-10-12T10:05:00.000Z',
      },
    ],
  });
});

test.each(['', 'staging', 'production'])(
  'does not load cms-none demo school announcement feeds when app env is %s',
  async (env) => {
    jest.mocked(getRawAppEnv).mockReturnValue(env);
    await expect(loadCampusAnnouncementFeed('tw-demo-uni')).resolves.toEqual({
      announcements: [],
      sources: [],
      allUnavailable: false,
    });
    expect(getDocsFromServer).not.toHaveBeenCalled();
  },
);

test('loads cms-none demo school announcement feeds in an explicit test environment', async () => {
  jest.mocked(getRawAppEnv).mockReturnValue('test');
  jest.mocked(getDocsFromServer).mockImplementation(async (input) => docsForPath(input, [document()]) as never);
  await expect(loadCampusAnnouncementFeed('tw-demo-uni')).resolves.toMatchObject({
    announcements: [{ id: 'a1', schoolId: 'tw-demo-uni' }],
  });
});

function eventDocument(id: string, path: string, data: Record<string, unknown> = {}) {
  return {
    id,
    ref: { parent: { path } },
    exists: () => true,
    data: () => ({ title: `活動 ${id}`, startsAt: '2026-10-08T00:00:00Z', ...data }),
  };
}
const snapshot = (docs: ReturnType<typeof eventDocument>[]) => ({ empty: docs.length === 0, docs });

test('event pages use the producer collection and snapshot cursors even when every date is identical', async () => {
  const path = 'schools/pu/clubEvents';
  const docs = Array.from({ length: 35 }, (_, index) =>
    eventDocument(`e${String(index).padStart(3, '0')}`, path),
  );
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot(docs.slice(0, 26)) as never)
    .mockResolvedValueOnce(snapshot(docs.slice(25)) as never);
  const first = await loadCampusEventPage('pu');
  expect(first.items).toHaveLength(25);
  expect(first.source).toBe('school-club-events');
  expect(collection).toHaveBeenCalledWith('db', 'schools', 'pu', 'clubEvents');
  expect(orderBy).toHaveBeenCalledWith(documentId(), 'asc');
  expect(limit).toHaveBeenCalledWith(26);
  const second = await loadCampusEventPage('pu', first.nextCursor);
  expect(startAfter).toHaveBeenCalledWith(docs[24]);
  expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(35);
  expect(second.nextCursor).toBeNull();
});

test('events with no published date are included and have no invented start time', async () => {
  const raw = {
    id: 'no-date',
    ref: { parent: { path: 'schools/pu/clubEvents' } },
    data: () => ({ title: '待定活動' }),
  };
  jest.mocked(getDocsFromServer).mockResolvedValue({ empty: false, docs: [raw] } as never);
  const page = await loadCampusEventPage('pu');
  expect(page.items[0]).toMatchObject({
    id: 'no-date',
    startsAt: '',
    source: 'school-club-events',
  });
  expect(orderBy).not.toHaveBeenCalledWith('startsAt', expect.anything());
});

test('fallback probes only empty sources and an exhausted later page never switches to another source', async () => {
  const docs = Array.from({ length: 26 }, (_, index) =>
    eventDocument(`e${index}`, 'schools/pu/events'),
  );
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot([]) as never)
    .mockResolvedValueOnce(snapshot(docs) as never)
    .mockResolvedValueOnce(snapshot([]) as never);
  const first = await loadCampusEventPage('pu');
  expect(first.source).toBe('school-events');
  const second = await loadCampusEventPage('pu', first.nextCursor);
  expect(second).toMatchObject({ items: [], source: 'school-events', nextCursor: null });
  expect(collection).toHaveBeenCalledTimes(3);
  expect(collection).not.toHaveBeenCalledWith('db', 'events');
});

test('canonical event read failures are not replaced with legacy data', async () => {
  jest.mocked(getDocsFromServer).mockRejectedValueOnce(new Error('permission-denied'));
  await expect(loadCampusEventPage('pu')).rejects.toThrow('permission-denied');
  expect(getDocsFromServer).toHaveBeenCalledTimes(1);
});

test('a cursor is bound to its school and exact source path', async () => {
  const docs = Array.from({ length: 26 }, (_, index) =>
    eventDocument(`e${index}`, 'schools/pu/clubEvents'),
  );
  jest.mocked(getDocsFromServer).mockResolvedValueOnce(snapshot(docs) as never);
  const { nextCursor } = await loadCampusEventPage('pu');
  jest.mocked(getDocsFromServer).mockClear();
  await expect(loadCampusEventPage('other', nextCursor)).rejects.toThrow('this school');
  await expect(
    loadCampusEventPage('pu', { ...nextCursor!, source: 'legacy-events' }),
  ).rejects.toThrow('this source');
  expect(getDocsFromServer).not.toHaveBeenCalled();
});

test('explicit-source details never substitute a same-ID document from another collection', async () => {
  jest.mocked(getDocFromServer).mockResolvedValueOnce({ exists: () => false } as never);
  await expect(loadCampusEvent('pu', 'same-id', 'school-club-events')).resolves.toBeNull();
  expect(getDocFromServer).toHaveBeenCalledTimes(1);
  expect(doc).toHaveBeenLastCalledWith('db', 'schools', 'pu', 'clubEvents', 'same-id');
});

test('old event links use the producer first, and legacy fallback checks school ownership', async () => {
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce(eventDocument('e1', 'schools/pu/clubEvents') as never);
  await expect(loadCampusEvent('pu', 'e1')).resolves.toMatchObject({
    source: 'school-club-events',
  });
  jest
    .mocked(getDocFromServer)
    .mockResolvedValueOnce({ exists: () => false } as never)
    .mockResolvedValueOnce({ exists: () => false } as never)
    .mockResolvedValueOnce(eventDocument('e2', 'events', { schoolId: 'other' }) as never);
  await expect(loadCampusEvent('pu', 'e2')).resolves.toBeNull();
});

test('pagination traverses more than 100 events without imposing a total-result cap', async () => {
  const docs = Array.from({ length: 131 }, (_, index) =>
    eventDocument(`e${String(index).padStart(3, '0')}`, 'schools/pu/clubEvents'),
  );
  for (let offset = 0; offset < docs.length; offset += 25) {
    jest
      .mocked(getDocsFromServer)
      .mockResolvedValueOnce(snapshot(docs.slice(offset, offset + 26)) as never);
  }
  const ids: string[] = [];
  let cursor: Awaited<ReturnType<typeof loadCampusEventPage>>['nextCursor'] = null;
  do {
    const page = await loadCampusEventPage('pu', cursor);
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toEqual(docs.map((document) => document.id));
  expect(new Set(ids).size).toBe(131);
  expect(getDocsFromServer).toHaveBeenCalledTimes(6);
});

test('root legacy event pages keep the school filter after both school collections are empty', async () => {
  jest
    .mocked(getDocsFromServer)
    .mockResolvedValueOnce(snapshot([]) as never)
    .mockResolvedValueOnce(snapshot([]) as never)
    .mockResolvedValueOnce(
      snapshot([eventDocument('root-event', 'events', { schoolId: 'pu' })]) as never,
    );
  await expect(loadCampusEventPage('pu')).resolves.toMatchObject({
    source: 'legacy-events',
    items: [{ id: 'root-event', source: 'legacy-events' }],
  });
  expect(collection).toHaveBeenLastCalledWith('db', 'events');
  expect(where).toHaveBeenCalledWith('schoolId', '==', 'pu');
});
