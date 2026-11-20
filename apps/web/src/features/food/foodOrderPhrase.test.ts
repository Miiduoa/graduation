import { expect, it } from 'vitest';
import { NUNI_FOOD_LIMITS, type NuniFoodMenuItem } from '@campus/shared/src/nuniFood';
import { menuFixture } from './foodTestFixtures';
import {
  FOOD_ORDER_PHRASE_MAX_LENGTH,
  parseFoodOrderPhrase,
  previewFoodOrderAddition,
} from '@campus/shared/src/foodOrderPhrase';

function item(
  id: string,
  name: string,
  overrides: Partial<NuniFoodMenuItem> = {},
): NuniFoodMenuItem {
  return { ...menuFixture().sections[0].items[0], id, name, ...overrides };
}
const menu = [item('rice', '雞腿飯'), item('tea', '紅茶'), item('salad', '和風沙拉')];

it.each([
  ['請幫我點一份雞腿飯，紅茶Ｘ２。', 1, 2],
  ['雞腿飯兩份、紅茶', 2, 1],
  ['我要十二份雞腿飯和二十杯紅茶', 12, 20],
  ['雞腿飯 3 盒\n紅茶 × 4', 3, 4],
])('reads all menu items and quantities in %s', (text, rice, tea) => {
  expect(parseFoodOrderPhrase(String(text), menu)).toEqual({
    ok: true,
    lines: [
      { itemId: 'rice', quantity: rice },
      { itemId: 'tea', quantity: tea },
    ],
  });
});

it('uses literal menu names including punctuation and conjunctions', () => {
  const combo = item('combo', 'A+B（餐）');
  expect(parseFoodOrderPhrase('A+B(餐) 和 和風沙拉', [...menu, combo])).toEqual({
    ok: true,
    lines: [
      { itemId: 'combo', quantity: 1 },
      { itemId: 'salad', quantity: 1 },
    ],
  });
});

it.each([
  '',
  '點餐',
  '紅',
  '雞腿飯不要辣',
  '紅茶改三杯',
  '紅茶、幫我付款',
  '取消紅茶',
  '雞腿飯一份、熱狗',
  '雞腿飯、',
  '雞腿飯、、紅茶',
  '紅茶 1.5 份',
  '紅茶零杯',
  '紅茶 x -1',
  '紅茶二十一杯',
  '一份雞腿飯兩份',
  '紅茶、紅茶兩杯',
  '茶'.repeat(FOOD_ORDER_PHRASE_MAX_LENGTH + 1),
])('rejects an unsupported or incomplete draft without returning any lines (%s)', (text) => {
  expect(parseFoodOrderPhrase(text, menu)).toEqual({ ok: false, message: expect.any(String) });
});

it('requires a unique menu match, even if one namesake is unavailable', () => {
  const duplicate = item('other-tea', '紅茶', { available: false });
  expect(parseFoodOrderPhrase('紅茶', [...menu, duplicate]).ok).toBe(false);
  expect(parseFoodOrderPhrase('雞腿飯和紅茶', [...menu, item('combo', '雞腿飯和紅茶')]).ok).toBe(
    false,
  );
});

it('does not guess where a numbered name ends and a quantity starts', () => {
  const names = [item('a', '套餐A'), item('a1', '套餐A1')];
  expect(parseFoodOrderPhrase('套餐A11份', names).ok).toBe(false);
  expect(parseFoodOrderPhrase('套餐A1 x 1', names)).toEqual({
    ok: true,
    lines: [{ itemId: 'a1', quantity: 1 }],
  });
});

it('requires an available item with permission to add it to a quote', () => {
  for (const blocked of [{ available: false }, { allowedActions: [] }]) {
    expect(parseFoodOrderPhrase('紅茶一杯', [item('tea', '紅茶', blocked)])).toMatchObject({
      ok: false,
    });
  }
});

it('checks the quote line limit', () => {
  const dishes = Array.from({ length: NUNI_FOOD_LIMITS.maxQuoteLines + 1 }, (_, i) =>
    item(`r${i}`, `便當${i}`),
  );
  expect(parseFoodOrderPhrase(dishes.map((dish) => dish.name).join('、'), dishes).ok).toBe(false);
  const allowed = dishes.slice(0, NUNI_FOOD_LIMITS.maxQuoteLines);
  expect(parseFoodOrderPhrase(allowed.map((dish) => dish.name).join('、'), allowed).ok).toBe(true);
});

it('returns combined quantities for affected lines and leaves other basket entries alone', () => {
  const basket = new Map([
    ['rice', 1],
    ['salad', 2],
  ]);
  expect(previewFoodOrderAddition('紅茶兩杯、雞腿飯兩份', menu, basket)).toEqual({
    ok: true,
    lines: [
      { itemId: 'tea', name: '紅茶', quantity: 2 },
      { itemId: 'rice', name: '雞腿飯', quantity: 3 },
    ],
  });
  expect([...basket]).toEqual([
    ['rice', 1],
    ['salad', 2],
  ]);
});

it('allows the final serving in a full basket, but never partially returns an overflow', () => {
  const { maxQuantityPerLine, maxQuoteLines } = NUNI_FOOD_LIMITS;
  const basket = new Map(
    Array.from({ length: maxQuoteLines - 1 }, (_, i): [string, number] => [`other-${i}`, 1]),
  );
  basket.set('rice', maxQuantityPerLine - 1);
  expect(previewFoodOrderAddition('雞腿飯', menu, basket)).toEqual({
    ok: true,
    lines: [{ itemId: 'rice', name: '雞腿飯', quantity: maxQuantityPerLine }],
  });
  expect(previewFoodOrderAddition('雞腿飯、紅茶', menu, basket)).toEqual({
    ok: false,
    message: expect.any(String),
  });
  basket.delete('other-0');
  expect(previewFoodOrderAddition('紅茶、雞腿飯兩份', menu, basket)).toEqual({
    ok: false,
    message: expect.any(String),
  });
  expect(basket.has('tea')).toBe(false);
  expect(basket.get('rice')).toBe(maxQuantityPerLine - 1);
});

it.each([0, -1, 0.5, NaN, Infinity])(
  'rejects invalid quantities on touched lines (%s)',
  (quantity) => {
    const basket = new Map([['tea', quantity]]);
    expect(previewFoodOrderAddition('雞腿飯、紅茶', menu, basket).ok).toBe(false);
    expect(previewFoodOrderAddition('雞腿飯', menu, basket).ok).toBe(true);
  },
);

it('requires a menu ID to identify one line before applying its quantity', () => {
  expect(previewFoodOrderAddition('紅茶', [...menu, item('tea', '綠茶')], new Map()).ok).toBe(
    false,
  );
});
