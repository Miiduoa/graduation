import { beforeEach, expect, it, vi } from 'vitest';
import { getDocsFromServer } from 'firebase/firestore';
import { isFirebaseConfigured } from '@/lib/firebase';
import { announcementSourceIdsForSchool } from '@campus/shared/src/campusAnnouncements';
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
    constraints?: Array<{ where?: string; value?: string }>;
  }) => {
    const path = String(input?.path || '');
    if (path.includes('announcement-sources')) return snapshot();
    if (
      path === 'announcements' &&
      input?.constraints?.some((item) => item.where === 'sourceId')
    ) {
      throw missingIndexError();
    }
    if (path === `schools/${schoolId}/announcements` || path === 'announcements') return snapshot();
    return snapshot();
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isFirebaseConfigured).mockReturnValue(true);
});

it.each(['ncku', 'ntpu'] as const)(
  'treats a successfully empty %s feed as unpublished even when extras would hit a missing legacy sourceId index',
  async (schoolId) => {
    expect(announcementSourceIdsForSchool(schoolId).length).toBeGreaterThan(0);
    vi.mocked(getDocsFromServer).mockImplementation(productionEmptySchoolRead(schoolId) as never);
    await expect(loadAnnouncementFeed(schoolId)).resolves.toEqual({
      announcements: [],
      sources: [],
      allUnavailable: false,
    });
    expect(getDocsFromServer).toHaveBeenCalledWith(
      expect.objectContaining({ path: `schools/${schoolId}/announcements` }),
    );
    expect(getDocsFromServer).toHaveBeenCalledWith(
      expect.objectContaining({ path: `schools/${schoolId}/announcement-sources` }),
    );
    expect(getDocsFromServer).not.toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'announcements',
        constraints: expect.arrayContaining([
          expect.objectContaining({ where: 'sourceId' }),
        ]),
      }),
    );
  },
);

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
