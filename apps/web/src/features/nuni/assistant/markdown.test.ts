import { expect, it } from 'vitest';
import { extractDueItems, parseBlocks, parseDueItem, parseInline } from './markdown';

it('renders bold and headings without leftover markdown markers', () => {
  const blocks = parseBlocks('## 待繳作業\n這週 **最急** 的是樹與圖。');
  expect(blocks[0]).toMatchObject({ type: 'h', level: 2 });
  expect(JSON.stringify(blocks)).not.toContain('**');
  expect(JSON.stringify(blocks)).not.toContain('##');
  const inline = parseInline('請看 **粗體** 與 *斜體*');
  expect(inline).toEqual([
    { type: 'text', value: '請看 ' },
    { type: 'strong', children: [{ type: 'text', value: '粗體' }] },
    { type: 'text', value: ' 與 ' },
    { type: 'em', children: [{ type: 'text', value: '斜體' }] },
  ]);
});

it('turns bare campus paths into internal links instead of leftover /clubs text', () => {
  const inline = parseInline('社團消息請到 /clubs 查看，點餐在 /food?tenant=a。');
  expect(inline.some((n) => n.type === 'link' && n.href === '/clubs' && n.path)).toBe(true);
  expect(inline.some((n) => n.type === 'link' && String(n.href).startsWith('/food'))).toBe(true);
  expect(inline.filter((n) => n.type === 'text').every((n) => !n.value.includes('/clubs'))).toBe(
    true,
  );
});

it('keeps markdown link labels and rejects javascript urls', () => {
  const inline = parseInline('[社團](/clubs) 與 [壞](javascript:alert(1))');
  expect(inline).toContainEqual({ type: 'link', href: '/clubs', label: '社團', path: true });
  expect(JSON.stringify(inline)).toContain('javascript:alert(1)');
  expect(inline.some((n) => n.type === 'link' && n.href.startsWith('javascript'))).toBe(false);
});

it('parses assignment lines with course name and due time', () => {
  expect(parseDueItem('- 樹與圖作業（資訊課程）截止 2026-11-05T23:59:00+08:00')).toMatchObject({
    title: '樹與圖作業',
    course: '資訊課程',
  });
  expect(parseDueItem('程式練習11/7要交')?.title).toBe('程式練習');
  const items = extractDueItems(
    '模擬：樹與圖作業11/5最急，程式練習11/7要交；已交報告不列待辦。',
  );
  expect(items.map((i) => i.title)).toEqual(['樹與圖作業', '程式練習']);
});

it('parses lists and quoted lines as blocks', () => {
  const blocks = parseBlocks('- 第一項\n- 第二項\n\n> 附註');
  expect(blocks[0]?.type).toBe('ul');
  expect(blocks[1]?.type).toBe('quote');
});
