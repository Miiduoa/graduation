import { afterEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniMaterial, type NuniUnit, type NuniWorkspace } from '@campus/shared/src/nuni';
import {
  MATERIAL_COURSE_BATCH,
  MATERIAL_CURSOR_CYCLE_MESSAGE,
  MATERIAL_SIZE_UNKNOWN,
  continueSearchableMaterials,
  courseMaterialHref,
  describeMaterial,
  emptyCourseMaterialPageProgress,
  firstSafeMaterialUrl,
  groupMaterialsByUnit,
  isMaterialNew,
  listReadMaterialIds,
  loadCourseMaterialsPage,
  loadSearchableMaterials,
  markMaterialRead,
  materialSearchScore,
  mergeMaterialPageProgress,
  restartCourseMaterialsPage,
  restartSearchableMaterials,
  searchCourseMaterials,
  toSearchableMaterial,
} from './courseMaterials';
import { colorContrast } from './webPreferences';

const course = 'cw_11111111-1111-4111-8111-111111111111';
const other = 'cw_22222222-2222-4222-8222-222222222222';
const account = 'pa_11111111-1111-4111-8111-111111111111';
const unit: NuniUnit = {
  id: 'cwu_11111111-1111-4111-8111-111111111111',
  workspaceId: course,
  title: '第 03 週｜資料模型',
  position: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
};
const laterUnit: NuniUnit = {
  id: 'cwu_22222222-2222-4222-8222-222222222222',
  workspaceId: course,
  title: '第 01 週｜導論',
  position: 1,
  createdAt: '2026-09-20T00:00:00.000Z',
};

function material(changes: Partial<NuniMaterial> = {}): NuniMaterial {
  return {
    id: 'cwm_11111111-1111-4111-8111-111111111111',
    workspaceId: course,
    title: '關聯與主鍵',
    body: '閱讀 https://example.test/week3.pdf 後寫觀察',
    unitId: unit.id,
    unitTitle: unit.title,
    createdByPlatformAccountId: account,
    createdAt: '2026-10-20T08:00:00.000Z',
    ...changes,
  };
}

afterEach(() => {
  localStorage.clear();
});

it('infers type from a safe file link and does not invent a file size', () => {
  const described = describeMaterial(material());
  expect(described.kind).toBe('pdf');
  expect(described.kindLabel).toBe('PDF');
  expect(described.sizeLabel).toBe(MATERIAL_SIZE_UNKNOWN);
  expect(described.open).toEqual({
    href: 'https://example.test/week3.pdf',
    label: '下載',
    downloadName: 'week3.pdf',
  });
  expect(firstSafeMaterialUrl('看 javascript:alert(1) 與 https://school.test/note')).toBe(
    'https://school.test/note',
  );
});

it('labels text-only materials by character count and keeps a one-tap read action', () => {
  const described = describeMaterial(material({ body: '本週先讀正規化定義。' }));
  expect(described.kind).toBe('text');
  expect(described.sizeLabel).toBe('約 10 字');
  expect(described.open).toEqual({ href: null, label: '閱讀', downloadName: null });
});

it('groups by teaching week order and keeps unassigned materials visible', () => {
  const loose = material({
    id: 'cwm_33333333-3333-4333-8333-333333333333',
    title: '補充',
    unitId: null,
    unitTitle: null,
  });
  const intro = material({
    id: 'cwm_22222222-2222-4222-8222-222222222222',
    title: '第一週投影片',
    unitId: laterUnit.id,
    unitTitle: laterUnit.title,
    body: 'https://example.test/intro.pptx',
  });
  const groups = groupMaterialsByUnit([material(), loose, intro], [unit, laterUnit]);
  expect(groups.map((group) => group.title)).toEqual(['第 01 週｜導論', '第 03 週｜資料模型', '其他內容']);
  expect(groups[0].materials[0].title).toBe('第一週投影片');
  expect(groups[2].materials[0].title).toBe('補充');
});

it('marks new materials within seven days and persists unread on this device only', () => {
  const now = Date.parse('2026-10-23T02:00:00.000Z');
  expect(isMaterialNew('2026-10-20T08:00:00.000Z', now)).toBe(true);
  expect(isMaterialNew('2026-10-01T08:00:00.000Z', now)).toBe(false);
  expect(listReadMaterialIds(account, localStorage).has(material().id)).toBe(false);
  markMaterialRead(account, material().id, localStorage);
  expect(listReadMaterialIds(account, localStorage).has(material().id)).toBe(true);
  expect(listReadMaterialIds('pa_99999999-9999-4999-8999-999999999999', localStorage).size).toBe(0);
});

it('finds materials by keyword, course or week, and tolerates a one-character typo', () => {
  const catalog = [
    {
      id: material().id,
      workspaceId: course,
      courseTitle: '資料庫系統',
      title: '關聯與主鍵',
      body: '第三正規化',
      unitTitle: '第 03 週｜資料模型',
      createdAt: material().createdAt,
    },
    {
      id: 'cwm_22222222-2222-4222-8222-222222222222',
      workspaceId: other,
      courseTitle: '設計專題',
      title: '口試簡報',
      body: 'https://example.test/pitch.pptx',
      unitTitle: '第 08 週',
      createdAt: '2026-10-18T00:00:00.000Z',
    },
  ];
  expect(searchCourseMaterials('主鍵', catalog).map((item) => item.title)).toEqual(['關聯與主鍵']);
  expect(searchCourseMaterials('資料庫 03', catalog).map((item) => item.title)).toEqual(['關聯與主鍵']);
  expect(searchCourseMaterials('關連', catalog).map((item) => item.title)).toEqual(['關聯與主鍵']);
  expect(searchCourseMaterials('口試', catalog).map((item) => item.title)).toEqual(['口試簡報']);
  expect(searchCourseMaterials('沒有這份', catalog)).toEqual([]);
  expect(materialSearchScore('', catalog[0])).toBe(0);
});

function pageMaterial(index: number, workspaceId = course): NuniMaterial {
  const suffix = String(index).padStart(12, '0');
  return material({
    id: `cwm_11111111-1111-4111-8111-${suffix}`,
    workspaceId,
    title: `教材 ${index}`,
    body: `內容 ${index}`,
    createdAt: `2026-09-${String((index % 28) + 1).padStart(2, '0')}T08:00:00.000Z`,
  });
}

it('loads searchable materials from enrolled courses and skips a revoked course without hiding the rest', async () => {
  const workspaces: NuniWorkspace[] = [
    { id: course, title: '資料庫系統', state: 'active', memberRole: 'student' },
    { id: other, title: '設計專題', state: 'active', memberRole: 'student' },
    {
      id: 'cw_33333333-3333-4333-8333-333333333333',
      title: '封存課',
      state: 'archived',
      memberRole: 'student',
    },
  ];
  const classes = {
    materialsPage: async (id: string) => {
      if (id === other) throw new NuniError(403, 'REQUEST_FAILED');
      return { materials: [material()], nextCursor: null };
    },
  };
  const result = await loadSearchableMaterials(classes, workspaces);
  expect(result.skipped).toBe(1);
  expect(result.truncated).toBe(false);
  expect(result.items).toEqual([
    expect.objectContaining({ courseTitle: '資料庫系統', title: '關聯與主鍵' }),
  ]);
});

it('reuses a complete today-page seed and does not request those courses again', async () => {
  const seeded = {
    id: material().id,
    workspaceId: course,
    courseTitle: '資料庫系統',
    title: '關聯與主鍵',
    body: '第三正規化',
    unitTitle: '第 03 週',
    createdAt: '2026-10-20T08:00:00.000Z',
  };
  const materialsPage = vi.fn(async (id: string) => {
    if (id === other)
      return {
        materials: [
          material({
            id: 'cwm_22222222-2222-4222-8222-222222222222',
            title: '設計講義',
            workspaceId: other,
          }),
        ],
        nextCursor: null,
      };
    throw new Error(`unexpected ${id}`);
  });
  const result = await loadSearchableMaterials(
    { materialsPage },
    [
      { id: course, title: '資料庫系統', state: 'active', memberRole: 'student' },
      { id: other, title: '設計專題', state: 'active', memberRole: 'student' },
    ],
    { items: [seeded], courseIds: [course], truncated: false },
  );
  expect(materialsPage).toHaveBeenCalledTimes(1);
  expect(materialsPage).toHaveBeenCalledWith(other, undefined);
  expect(result.items.map((item) => item.title)).toEqual(['關聯與主鍵', '設計講義']);
});

it('continues a truncated seed via materialsPage instead of treating it as complete', async () => {
  const materialsPage = vi.fn(async () => ({
    materials: [material()],
    nextCursor: 'page-2',
  }));
  const result = await loadSearchableMaterials(
    { materialsPage },
    [{ id: course, title: '資料庫系統', state: 'active', memberRole: 'student' }],
    { items: [], courseIds: [], truncated: true },
  );
  expect(materialsPage).toHaveBeenCalledWith(course, undefined);
  expect(result.truncated).toBe(true);
  expect(result.courses[0]?.complete).toBe(false);
  expect(result.courses[0]?.nextCursor).toBe('page-2');
});

it('does not reuse truncated legacy seed courseIds and refetches through materialsPage', async () => {
  const materialsPage = vi.fn(async () => ({
    materials: [material()],
    nextCursor: null,
  }));
  const result = await loadSearchableMaterials(
    { materialsPage },
    [{ id: course, title: '資料庫系統', state: 'active', memberRole: 'student' }],
    {
      items: [
        {
          id: material().id,
          workspaceId: course,
          courseTitle: '資料庫系統',
          title: '過期種子',
          body: '不應直接當成完整目錄',
          unitTitle: null,
          createdAt: material().createdAt,
        },
      ],
      courseIds: [],
      truncated: true,
    },
  );
  expect(materialsPage).toHaveBeenCalledWith(course, undefined);
  expect(result.items.map((item) => item.title)).toEqual(['關聯與主鍵']);
  expect(result.truncated).toBe(false);
  expect(result.courses[0]?.complete).toBe(true);
});
it('pages a 220-item course across five legal materialsPage reads without duplicate rows', async () => {
  const pages = [
    { materials: Array.from({ length: 50 }, (_, i) => pageMaterial(i + 1)), nextCursor: 'p2' },
    { materials: Array.from({ length: 50 }, (_, i) => pageMaterial(i + 51)), nextCursor: 'p3' },
    { materials: Array.from({ length: 50 }, (_, i) => pageMaterial(i + 101)), nextCursor: 'p4' },
    { materials: Array.from({ length: 50 }, (_, i) => pageMaterial(i + 151)), nextCursor: 'p5' },
    { materials: Array.from({ length: 20 }, (_, i) => pageMaterial(i + 201)), nextCursor: null },
  ];
  for (const page of pages) {
    expect(page.materials.length).toBeLessThanOrEqual(50);
  }
  const materialsPage = vi.fn(async (_id: string, cursor?: string) => {
    if (!cursor) return pages[0];
    if (cursor === 'p2') return pages[1];
    if (cursor === 'p3') return pages[2];
    if (cursor === 'p4') return pages[3];
    if (cursor === 'p5') return pages[4];
    throw new Error(`unexpected cursor ${cursor}`);
  });
  let catalog = await loadSearchableMaterials(
    { materialsPage },
    [{ id: course, title: '資料庫系統', state: 'active', memberRole: 'student' }],
  );
  expect(catalog.items).toHaveLength(50);
  expect(catalog.truncated).toBe(true);
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  expect(materialsPage.mock.calls.map(([, cursor]) => cursor)).toEqual([
    undefined,
    'p2',
    'p3',
    'p4',
    'p5',
  ]);
  expect(catalog.truncated).toBe(false);
  expect(catalog.courses[0]?.complete).toBe(true);
  expect(catalog.items).toHaveLength(220);
  expect(new Set(catalog.items.map((item) => item.id)).size).toBe(220);
  const olderHit = searchCourseMaterials('教材 220', catalog.items).find(
    (item) => item.title === '教材 220',
  );
  expect(olderHit?.id).toBe(pageMaterial(220).id);
  expect(courseMaterialHref(course, pageMaterial(220).id)).toContain(
    `#material-${pageMaterial(220).id}`,
  );
});
it('keeps confirmed rows and the retry cursor after a later-page transient failure', async () => {
  const materialsPage = vi
    .fn()
    .mockResolvedValueOnce({ materials: [material()], nextCursor: 'older' })
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce({
      materials: [pageMaterial(2)],
      nextCursor: null,
    });
  let catalog = await loadSearchableMaterials(
    { materialsPage },
    [{ id: course, title: '資料庫系統', state: 'active', memberRole: 'student' }],
  );
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  expect(catalog.items).toHaveLength(1);
  expect(catalog.courses[0]?.nextCursor).toBe('older');
  expect(catalog.partialError).toBeTruthy();
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  expect(catalog.items.map((item) => item.title)).toEqual(['關聯與主鍵', '教材 2']);
  expect(catalog.truncated).toBe(false);
});

it('evicts a course catalogue when a later page is denied', async () => {
  const materialsPage = vi
    .fn()
    .mockResolvedValueOnce({ materials: [material()], nextCursor: 'older' })
    .mockRejectedValueOnce(new NuniError(403, 'REQUEST_FAILED'));
  let catalog = await loadSearchableMaterials(
    { materialsPage },
    [{ id: course, title: '資料庫系統', state: 'active', memberRole: 'student' }],
  );
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  expect(catalog.items).toEqual([]);
  expect(catalog.skipped).toBe(1);
  expect(catalog.courses[0]?.denied).toBe(true);
});

it('stops before the next page request when the session fence cancels', async () => {
  const materialsPage = vi
    .fn()
    .mockResolvedValueOnce({ materials: [material()], nextCursor: 'older' })
    .mockResolvedValueOnce({ materials: [pageMaterial(2)], nextCursor: null });
  const catalog = await loadSearchableMaterials(
    { materialsPage },
    [{ id: course, title: '資料庫系統', state: 'active', memberRole: 'student' }],
  );
  const next = await continueSearchableMaterials(
    { materialsPage },
    catalog,
    { cancelled: () => true },
  );
  expect(materialsPage).toHaveBeenCalledTimes(1);
  expect(next.items).toHaveLength(1);
  expect(next.courses[0]?.nextCursor).toBe('older');
});

it('treats a repeated cursor as stalled incomplete instead of looping or faking complete', () => {
  const first = mergeMaterialPageProgress(
    emptyCourseMaterialPageProgress<NuniMaterial>(),
    { materials: [material()], nextCursor: 'loop-a' },
    undefined,
  );
  const second = mergeMaterialPageProgress(
    first,
    { materials: [pageMaterial(2)], nextCursor: 'loop-a' },
    'loop-a',
  );
  expect(second.complete).toBe(false);
  expect(second.nextCursor).toBeNull();
  expect(second.needsRestart).toBe(true);
  expect(second.error).toBe(MATERIAL_CURSOR_CYCLE_MESSAGE);
  expect(second.items).toHaveLength(2);
});

it('bounds an A→B→A cursor cycle, keeps rows, and recovers via explicit first-page restart', async () => {
  const materialsPage = vi.fn(async (_id: string, cursor?: string) => {
    if (!cursor) {
      if (materialsPage.mock.calls.length <= 1) {
        return { materials: [material()], nextCursor: 'cursor-a' };
      }
      return {
        materials: [material(), pageMaterial(3)],
        nextCursor: 'cursor-fresh',
      };
    }
    if (cursor === 'cursor-a') return { materials: [pageMaterial(2)], nextCursor: 'cursor-b' };
    if (cursor === 'cursor-b') {
      // Legal page payload that reintroduces cursor-a; helper must stall, not loop.
      return { materials: [pageMaterial(4)], nextCursor: 'cursor-a' };
    }
    if (cursor === 'cursor-fresh') {
      return { materials: [pageMaterial(5)], nextCursor: null };
    }
    throw new Error(`unexpected cursor ${cursor}`);
  });
  let catalog = await loadSearchableMaterials(
    { materialsPage },
    [{ id: course, title: '資料庫系統', state: 'active', memberRole: 'student' }],
  );
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  expect(catalog.courses[0]?.needsRestart).toBe(true);
  expect(catalog.courses[0]?.complete).toBe(false);
  expect(catalog.courses[0]?.nextCursor).toBeNull();
  expect(catalog.items).toHaveLength(3);
  expect(materialsPage).toHaveBeenCalledTimes(3);
  const stalled = await continueSearchableMaterials({ materialsPage }, catalog);
  expect(materialsPage).toHaveBeenCalledTimes(3);
  expect(stalled).toEqual(catalog);
  catalog = await restartSearchableMaterials({ materialsPage }, catalog);
  expect(catalog.courses[0]?.needsRestart).toBe(false);
  expect(catalog.courses[0]?.nextCursor).toBe('cursor-fresh');
  expect(catalog.items.map((item) => item.title)).toEqual(['關聯與主鍵', '教材 3']);
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  expect(catalog.courses[0]?.complete).toBe(true);
  expect(catalog.items.map((item) => item.title)).toEqual(['關聯與主鍵', '教材 3', '教材 5']);
  expect(materialsPage.mock.calls.map(([, cursor]) => cursor)).toEqual([
    undefined,
    'cursor-a',
    'cursor-b',
    undefined,
    'cursor-fresh',
  ]);
});

it('treats an invalid cursor 422 as restart-needed and recovers from a fresh first page', async () => {
  const materialsPage = vi
    .fn()
    .mockResolvedValueOnce({ materials: [material()], nextCursor: 'older' })
    .mockRejectedValueOnce(new NuniError(422, 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID'))
    .mockResolvedValueOnce({ materials: [material(), pageMaterial(2)], nextCursor: 'after-restart' })
    .mockResolvedValueOnce({ materials: [pageMaterial(3)], nextCursor: null });
  let catalog = await loadSearchableMaterials(
    { materialsPage },
    [{ id: course, title: '資料庫系統', state: 'active', memberRole: 'student' }],
  );
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  expect(catalog.items).toHaveLength(1);
  expect(catalog.courses[0]?.nextCursor).toBeNull();
  expect(catalog.courses[0]?.needsRestart).toBe(true);
  expect(catalog.partialError).toMatch(/教材頁面已失效/);
  const stuck = await continueSearchableMaterials({ materialsPage }, catalog);
  expect(materialsPage).toHaveBeenCalledTimes(2);
  expect(stuck.courses[0]?.needsRestart).toBe(true);
  catalog = await restartSearchableMaterials({ materialsPage }, catalog);
  expect(catalog.courses[0]?.needsRestart).toBe(false);
  expect(catalog.courses[0]?.nextCursor).toBe('after-restart');
  expect(catalog.items).toHaveLength(2);
  catalog = await continueSearchableMaterials({ materialsPage }, catalog);
  expect(catalog.courses[0]?.complete).toBe(true);
  expect(catalog.items.map((item) => item.title)).toEqual(['關聯與主鍵', '教材 2', '教材 3']);
});

it('does not start the next course batch after a fence cancels mid first-batch', async () => {
  expect(MATERIAL_COURSE_BATCH).toBe(4);
  const workspaces: NuniWorkspace[] = Array.from({ length: 5 }, (_, index) => ({
    id: `cw_${String(index + 1).padStart(8, '1')}-1111-4111-8111-111111111111`,
    title: `課程 ${index + 1}`,
    state: 'active',
    memberRole: 'student',
  }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cancelled = false;
  const materialsPage = vi.fn(async (id: string) => {
    await gate;
    return {
      materials: [pageMaterial(Number(id.slice(3, 4)) || 1, id)],
      nextCursor: null,
    };
  });
  const pending = loadSearchableMaterials({ materialsPage }, workspaces, null, {
    cancelled: () => cancelled,
  });
  await vi.waitFor(() => expect(materialsPage).toHaveBeenCalledTimes(4));
  cancelled = true;
  release();
  const catalog = await pending;
  expect(materialsPage).toHaveBeenCalledTimes(4);
  expect(catalog.items).toEqual([]);
  expect(catalog.courses).toEqual([]);
});

it('does not invent a complete catalogue when a first-page read is offline', async () => {
  await expect(
    loadSearchableMaterials(
      {
        materialsPage: async () => {
          throw new TypeError('Failed to fetch');
        },
      },
      [{ id: course, title: '資料庫系統', state: 'active', memberRole: 'student' }],
    ),
  ).rejects.toBeInstanceOf(TypeError);
});

it('loads a course path page and retries a failed later page without dropping rows', async () => {
  const materialsPage = vi
    .fn()
    .mockResolvedValueOnce({ materials: [material()], nextCursor: 'older' })
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce({ materials: [pageMaterial(2)], nextCursor: null });
  const first = await loadCourseMaterialsPage({ materialsPage }, course, null);
  expect(first).not.toBe('cancelled');
  if (first === 'cancelled') return;
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toBe('older');
  const failed = await loadCourseMaterialsPage({ materialsPage }, course, first);
  expect(failed).not.toBe('cancelled');
  if (failed === 'cancelled') return;
  expect(failed.items).toHaveLength(1);
  expect(failed.nextCursor).toBe('older');
  expect(failed.error).toBeTruthy();
  expect(failed.needsRestart).toBe(false);
  const recovered = await loadCourseMaterialsPage(
    { materialsPage },
    course,
    { ...failed, error: null },
  );
  expect(recovered).not.toBe('cancelled');
  if (recovered === 'cancelled') return;
  expect(recovered.items.map((item) => item.title)).toEqual(['關聯與主鍵', '教材 2']);
  expect(toSearchableMaterial({ id: course, title: '資料庫系統' }, recovered.items[1]).title).toBe(
    '教材 2',
  );
});

it('restarts a path course after an invalid cursor without reusing the broken cursor', async () => {
  const materialsPage = vi
    .fn()
    .mockResolvedValueOnce({ materials: [material()], nextCursor: 'older' })
    .mockRejectedValueOnce(new NuniError(422, 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID'))
    .mockResolvedValueOnce({ materials: [material(), pageMaterial(2)], nextCursor: 'next' })
    .mockResolvedValueOnce({ materials: [pageMaterial(3)], nextCursor: null });
  const first = await loadCourseMaterialsPage({ materialsPage }, course, null);
  expect(first).not.toBe('cancelled');
  if (first === 'cancelled') return;
  const stalled = await loadCourseMaterialsPage({ materialsPage }, course, first);
  expect(stalled).not.toBe('cancelled');
  if (stalled === 'cancelled') return;
  expect(stalled.needsRestart).toBe(true);
  expect(stalled.nextCursor).toBeNull();
  expect(stalled.items).toHaveLength(1);
  const noop = await loadCourseMaterialsPage({ materialsPage }, course, {
    ...stalled,
    error: null,
  });
  expect(materialsPage).toHaveBeenCalledTimes(2);
  expect(noop).toEqual({ ...stalled, error: null });
  const restarted = await restartCourseMaterialsPage({ materialsPage }, course, stalled);
  expect(restarted).not.toBe('cancelled');
  if (restarted === 'cancelled') return;
  expect(restarted.needsRestart).toBe(false);
  expect(restarted.nextCursor).toBe('next');
  expect(restarted.items).toHaveLength(2);
  const finished = await loadCourseMaterialsPage({ materialsPage }, course, restarted);
  expect(finished).not.toBe('cancelled');
  if (finished === 'cancelled') return;
  expect(finished.complete).toBe(true);
  expect(finished.items.map((item) => item.title)).toEqual(['關聯與主鍵', '教材 2', '教材 3']);
});

it('keeps the in-site material landing path', () => {
  expect(courseMaterialHref(course, material().id)).toBe(
    `/classroom/course/${course}#material-${material().id}`,
  );
});

it('keeps OLED black text and brand chips above WCAG AA contrast', () => {
  expect(colorContrast('#f2f3f1', '#000000')).toBeGreaterThanOrEqual(4.5);
  expect(colorContrast('#a5aaa7', '#000000')).toBeGreaterThanOrEqual(4.5);
  expect(colorContrast('#a9c6a3', '#000000')).toBeGreaterThanOrEqual(4.5);
  expect(colorContrast('#f2f3f1', '#111111')).toBeGreaterThanOrEqual(4.5);
});
