import {
  MATERIAL_CURSOR_CYCLE_MESSAGE,
  appendMaterialPage,
  emptyMaterialPageProgress,
  filterLoadedMaterials,
  materialMatchesQuery,
  materialSearchStatusCopy,
  normalizeMaterialSearchText,
  visibleLoadedMaterials,
} from '../screens/nuni/materialDiscovery';

const row = (id: string, title = id) => ({
  id,
  title,
  body: `內容 ${id}`,
  unitTitle: `單元 ${id}`,
});

it('normalizes case and full-width text without treating the query as a regex', () => {
  expect(normalizeMaterialSearchText('ＡＢＣ 主鍵')).toBe('abc主鍵');
  expect(materialMatchesQuery(row('1', '關聯與主鍵'), '主鍵')).toBe(true);
  expect(materialMatchesQuery(row('1', '關聯與主鍵'), '.*')).toBe(false);
  expect(materialMatchesQuery({ ...row('1'), body: '第三正規化' }, '正規')).toBe(true);
  expect(materialMatchesQuery({ ...row('1'), unitTitle: '第 03 週' }, '03')).toBe(true);
});

it('filters only already-loaded materials', () => {
  const items = [row('a', '關聯與主鍵'), row('b', '服務設計')];
  expect(filterLoadedMaterials(items, '主鍵').map((item) => item.id)).toEqual(['a']);
  expect(filterLoadedMaterials(items, '  ').map((item) => item.id)).toEqual(['a', 'b']);
});

it('keeps an explicit target visible when search would hide it', () => {
  const items = [row('a', '關聯與主鍵'), row('b', '服務設計')];
  expect(visibleLoadedMaterials(items, '主鍵', 'b').map((item) => item.id)).toEqual(['b', 'a']);
});

it('describes partial versus exhausted search honestly', () => {
  expect(
    materialSearchStatusCopy({
      query: '沒有',
      loadedCount: 50,
      matchCount: 0,
      hasOlder: true,
    }),
  ).toBe('已載入教材中沒有相符結果，還有較早內容');
  expect(
    materialSearchStatusCopy({
      query: '沒有',
      loadedCount: 50,
      matchCount: 0,
      hasOlder: false,
    }),
  ).toBe('目前已載入的教材中沒有符合「沒有」的結果。');
  expect(
    materialSearchStatusCopy({
      query: '主鍵',
      loadedCount: 100,
      matchCount: 2,
      hasOlder: true,
    }),
  ).toBe('已載入 100 筆，符合 2 筆，還有較早內容。');
  expect(
    materialSearchStatusCopy({
      query: '',
      loadedCount: 3,
      matchCount: 3,
      hasOlder: false,
      interrupted: true,
    }),
  ).toBe('已載入 3 筆教材，清單尚未完整。');
});

it('appends with dedupe and stops an A→B→A cursor cycle without faking completion', () => {
  const first = appendMaterialPage(
    emptyMaterialPageProgress<ReturnType<typeof row>>(),
    { materials: [row('1')], nextCursor: 'cursor-a' },
    undefined,
  );
  const second = appendMaterialPage(
    first,
    { materials: [row('1'), row('2')], nextCursor: 'cursor-b' },
    'cursor-a',
  );
  expect(second.items.map((item) => item.id)).toEqual(['1', '2']);
  expect(second.nextCursor).toBe('cursor-b');
  const cycled = appendMaterialPage(
    second,
    { materials: [row('3')], nextCursor: 'cursor-a' },
    'cursor-b',
  );
  expect(cycled.cycleDetected).toBe(true);
  expect(cycled.nextCursor).toBeNull();
  expect(cycled.items.map((item) => item.id)).toEqual(['1', '2', '3']);
  expect(MATERIAL_CURSOR_CYCLE_MESSAGE).toMatch(/請更新教材後再試/);
});

it('treats a self-repeating cursor as a stalled cycle', () => {
  const first = appendMaterialPage(
    emptyMaterialPageProgress<ReturnType<typeof row>>(),
    { materials: [row('1')], nextCursor: 'same' },
    undefined,
  );
  const stuck = appendMaterialPage(first, { materials: [row('2')], nextCursor: 'same' }, 'same');
  expect(stuck.cycleDetected).toBe(true);
  expect(stuck.nextCursor).toBeNull();
  expect(stuck.items).toHaveLength(2);
});
