import { beforeEach, expect, it, vi } from 'vitest';
import { getDocsFromServer } from 'firebase/firestore';
import { isFirebaseConfigured } from '@/lib/firebase';
import { loadAnnouncementFeed } from './publicAnnouncements';

vi.mock('@/lib/firebase', () => ({ getDb: () => ({}), isFirebaseConfigured: vi.fn(() => true) }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  orderBy: (field: string, direction: string) => ({ orderBy: field, direction }),
  limit: (count: number) => ({ limit: count }),
  where: (field: string, operator: string, value: string) => ({ where: field, operator, value }),
  query: (collection: object, ...constraints: object[]) => ({ ...collection, constraints }),
  getDocsFromServer: vi.fn(),
  getDocFromServer: vi.fn(),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
}));

function snapshot(...docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  return { empty: docs.length === 0, docs };
}
function missingIndexError() {
  return Object.assign(new Error('The query requires an index.'), { code: 'failed-precondition' });
}
function productionEmptySchoolRead(schoolId: string) {
  return async (input: {
    path?: string;
    constraints?: Array<{ where?: string; value?: string; orderBy?: string }>;
  }) => {
    const path = String(input?.path || '');
    if (path.includes('announcement-sources')) return snapshot();
    if (path === `schools/${schoolId}/announcements`) return snapshot();
    if (path === 'announcements') throw missingIndexError();
    return snapshot();
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isFirebaseConfigured).mockReturnValue(true);
});

it.each(['ncku', 'ntpu', 'feu', 'mmc'] as const)(
  'keeps a successfully empty %s feed when the school-scoped legacy fallback lacks an index',
  async (schoolId) => {
    vi.mocked(getDocsFromServer).mockImplementation(productionEmptySchoolRead(schoolId) as never);
    await expect(loadAnnouncementFeed(schoolId)).resolves.toEqual({
      announcements: [],
      sources: [],
      allUnavailable: false,
    });
    expect(getDocsFromServer).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `schools/${schoolId}/announcements`,
        constraints: expect.arrayContaining([
          expect.objectContaining({ orderBy: 'publishedAt', direction: 'desc' }),
        ]),
      }),
    );
    expect(getDocsFromServer).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'announcements',
        constraints: expect.arrayContaining([
          { where: 'schoolId', operator: '==', value: schoolId },
          { orderBy: 'publishedAt', direction: 'desc' },
        ]),
      }),
    );
  },
);

it('drops fallback rows that belong to another school', async () => {
  vi.mocked(getDocsFromServer).mockImplementation((async (input: { path?: string }) => {
    const path = String(input?.path || '');
    if (path.includes('announcement-sources')) return snapshot();
    if (path === 'schools/ncku/announcements') return snapshot();
    return snapshot({
      id: 'ntu-1',
      data: () => ({ title: '臺大稿', schoolId: 'ntu', publishedAt: '2026-10-08T00:00:00.000Z' }),
    });
  }) as never);
  await expect(loadAnnouncementFeed('ncku')).resolves.toEqual({
    announcements: [],
    sources: [],
    allUnavailable: false,
  });
});

it.each(['ncku', 'ntpu'] as const)(
  'still rejects %s when the canonical dated query actually fails',
  async (schoolId) => {
    vi.mocked(getDocsFromServer).mockRejectedValueOnce(missingIndexError());
    await expect(loadAnnouncementFeed(schoolId)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(getDocsFromServer).toHaveBeenCalledTimes(1);
  },
);
