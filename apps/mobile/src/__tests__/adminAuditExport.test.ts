import { getDocs, orderBy, startAfter } from 'firebase/firestore';
import {
  ADMIN_LOG_EXPORT_MAX_ROWS,
  buildAdminCsv,
  describeAdminLogExportScope,
  escapeAdminCsvValue,
  fetchAdminLogsPaged,
} from '../services/adminAuditExport';

jest.mock('firebase/firestore', () => ({
  collection: (_: unknown, ...path: string[]) => path.join('/'),
  documentId: () => '__name__',
  query: (...args: unknown[]) => args,
  orderBy: jest.fn((field, direction) => ({ order: field, direction })),
  startAfter: jest.fn((document) => ({ after: document })),
  limit: (size: number) => ({ limit: size }),
  getDocs: jest.fn(),
}));

const row = (id: string, createdAt: number) => ({
  id,
  data: () => ({
    action: id,
    details: `=CMD|${id}`,
    actorEmail: `${id}@example.test`,
    createdAt,
  }),
});

beforeEach(() => jest.clearAllMocks());

test('CSV escapes quotes/commas and neutralizes formula injection', () => {
  const csv = buildAdminCsv(
    ['id', 'details'],
    [
      ['a1', '=1+1'],
      ['a2', '+cmd'],
      ['a3', '-2'],
      ['a4', '@sum'],
      ['a5', '陳,"同學"'],
    ],
  );
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(escapeAdminCsvValue('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  expect(csv).toContain('"\'=1+1"');
  expect(csv).toContain('"\'+cmd"');
  expect(csv).toContain('"\'-2"');
  expect(csv).toContain('"\'@sum"');
  expect(csv).toContain('"陳,""同學"""');
});

test('loaded-scope copy never claims full history', () => {
  expect(describeAdminLogExportScope({ kind: 'loaded_filtered', count: 20 })).toContain(
    '不是全校完整歷史',
  );
  expect(
    describeAdminLogExportScope({
      kind: 'school_paged',
      fetched: 2000,
      complete: false,
      capped: true,
    }),
  ).toContain('安全上限');
  expect(
    describeAdminLogExportScope({
      kind: 'school_paged',
      fetched: 12,
      complete: true,
      capped: false,
    }),
  ).toContain('全部分頁結果');
});

test('paged export walks multiple pages and stops at the safety cap', async () => {
  const first = Array.from({ length: 50 }, (_, index) => row(`log-${index}`, 100 - index));
  const second = Array.from({ length: 30 }, (_, index) => row(`log-${50 + index}`, 49 - index));
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: first })
    .mockResolvedValueOnce({ docs: second });

  const result = await fetchAdminLogsPaged({
    db: {} as never,
    schoolId: 'pu',
    pageSize: 50,
    maxRows: 80,
  });

  expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  expect(orderBy).toHaveBeenCalledWith('__name__', 'desc');
  expect(startAfter).toHaveBeenCalledWith(first[49]);
  expect(result.rows).toHaveLength(80);
  expect(result.capped).toBe(true);
  expect(result.complete).toBe(false);
  expect(new Set(result.rows.map((item) => item.id)).size).toBe(80);
});

test('paged export dedupes overlapping ids across pages', async () => {
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: [row('a', 3), row('b', 2)] })
    .mockResolvedValueOnce({ docs: [row('b', 2), row('c', 1)] })
    .mockResolvedValueOnce({ docs: [] });
  const result = await fetchAdminLogsPaged({
    db: {} as never,
    schoolId: 'pu',
    pageSize: 2,
    maxRows: 10,
  });
  expect(result.rows.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  expect(result.complete).toBe(true);
});

test('paged export marks completion when the final page is short', async () => {
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: [row('a', 3), row('b', 2)] })
    .mockResolvedValueOnce({ docs: [row('c', 1)] });
  const result = await fetchAdminLogsPaged({
    db: {} as never,
    schoolId: 'pu',
    pageSize: 2,
    maxRows: ADMIN_LOG_EXPORT_MAX_ROWS,
  });
  expect(result.rows.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  expect(result.complete).toBe(true);
  expect(result.capped).toBe(false);
});

test('paged export aborts without pretending the file is complete', async () => {
  const controller = new AbortController();
  (getDocs as jest.Mock).mockImplementationOnce(async () => {
    controller.abort();
    return { docs: [row('a', 1), row('b', 0)] };
  });
  await expect(
    fetchAdminLogsPaged({
      db: {} as never,
      schoolId: 'pu',
      pageSize: 2,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

test('equal createdAt ties keep a documentId DESC order cursor', async () => {
  const same = 99;
  // With createdAt DESC + __name__ DESC, equal timestamps page as z → y → x.
  (getDocs as jest.Mock)
    .mockResolvedValueOnce({ docs: [row('z', same), row('y', same)] })
    .mockResolvedValueOnce({ docs: [row('x', same)] });
  const result = await fetchAdminLogsPaged({
    db: {} as never,
    schoolId: 'pu',
    pageSize: 2,
  });
  expect(orderBy).toHaveBeenCalledWith('__name__', 'desc');
  expect(startAfter).toHaveBeenCalledWith(expect.objectContaining({ id: 'y' }));
  expect(result.rows.map((item) => item.id)).toEqual(['z', 'y', 'x']);
  expect(result.complete).toBe(true);
});
