import { afterEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniMaterial, type NuniUnit, type NuniWorkspace } from '@campus/shared/src/nuni';
import {
  MATERIAL_SIZE_UNKNOWN,
  courseMaterialHref,
  describeMaterial,
  firstSafeMaterialUrl,
  groupMaterialsByUnit,
  isMaterialNew,
  listReadMaterialIds,
  loadSearchableMaterials,
  markMaterialRead,
  materialSearchScore,
  searchCourseMaterials,
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
    materials: async (id: string) => {
      if (id === other) throw new NuniError(403, 'REQUEST_FAILED');
      return [material()];
    },
  };
  const result = await loadSearchableMaterials(classes, workspaces);
  expect(result.skipped).toBe(1);
  expect(result.truncated).toBe(false);
  expect(result.items).toEqual([
    expect.objectContaining({ courseTitle: '資料庫系統', title: '關聯與主鍵' }),
  ]);
});

it('reuses a today-page seed and does not request those courses again', async () => {
  const seeded = {
    id: material().id,
    workspaceId: course,
    courseTitle: '資料庫系統',
    title: '關聯與主鍵',
    body: '第三正規化',
    unitTitle: '第 03 週',
    createdAt: '2026-10-20T08:00:00.000Z',
  };
  const materials = vi.fn(async (id: string) => {
    if (id === other)
      return [material({ id: 'cwm_22222222-2222-4222-8222-222222222222', title: '設計講義', workspaceId: other })];
    throw new Error(`unexpected ${id}`);
  });
  const result = await loadSearchableMaterials(
    { materials },
    [
      { id: course, title: '資料庫系統', state: 'active', memberRole: 'student' },
      { id: other, title: '設計專題', state: 'active', memberRole: 'student' },
    ],
    { items: [seeded], courseIds: [course], truncated: false },
  );
  expect(materials).toHaveBeenCalledTimes(1);
  expect(materials).toHaveBeenCalledWith(other);
  expect(result.items.map((item) => item.title)).toEqual(['關聯與主鍵', '設計講義']);
});

it('does not invent a complete catalogue when a course read is offline', async () => {
  await expect(
    loadSearchableMaterials(
      {
        materials: async () => {
          throw new TypeError('Failed to fetch');
        },
      },
      [{ id: course, title: '資料庫系統', state: 'active', memberRole: 'student' }],
    ),
  ).rejects.toBeInstanceOf(TypeError);
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
