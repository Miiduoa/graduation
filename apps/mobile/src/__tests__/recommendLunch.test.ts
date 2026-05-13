/**
 * @jest-environment node
 *
 * 驗證 recommendLunchCandidates 的均衡飲食守則：
 * - 三類盡量配齊（主食 / 蛋白質 / 蔬菜）
 * - ≤ 1 個炸物
 * - 飲食偏好（素食 / 不要再炸物）有效
 */
import {
  recommendLunchCandidates,
  type LunchMenuRow,
} from '../services/recommendLunch';

const SAMPLE: LunchMenuRow[] = [
  { id: '1', name: '香酥雞排飯', price: 80, category: 'main' },
  { id: '2', name: '炸豬排便當', price: 90, category: 'main' },
  { id: '3', name: '蔬食定食', price: 75, category: 'main' },
  { id: '4', name: '燙青菜', price: 30, category: 'side' },
  { id: '5', name: '滷雞腿便當', price: 85, category: 'main' },
  { id: '6', name: '紅茶', price: 25, category: 'beverage' },
  { id: '7', name: '布丁', price: 35, category: 'dessert' },
  { id: '8', name: '清燉牛肉麵', price: 110, category: 'main' },
  { id: '9', name: '炸雞翅', price: 45, category: 'main' },
];

describe('recommendLunchCandidates 均衡飲食守則', () => {
  test('預設 3 個候選不可全炸（≤ 1 個炸物）', () => {
    const { items } = recommendLunchCandidates(SAMPLE, { maxItems: 3 });
    const fried = items.filter((it) => /炸|酥/.test(it.name)).length;
    expect(fried).toBeLessThanOrEqual(1);
  });

  test('應排除飲料 / 甜點', () => {
    const { items } = recommendLunchCandidates(SAMPLE);
    const names = items.map((it) => it.name);
    expect(names).not.toContain('紅茶');
    expect(names).not.toContain('布丁');
  });

  test('偏好 vegetarian 應只回素食候選', () => {
    const { items } = recommendLunchCandidates(SAMPLE, {
      dietaryPreference: 'vegetarian',
      maxItems: 3,
    });
    items.forEach((it) => {
      expect(it.name).not.toMatch(/雞|豬|牛|魚|蝦|海鮮/);
    });
  });

  test('偏好 no_fried 應排除炸物', () => {
    const { items } = recommendLunchCandidates(SAMPLE, {
      dietaryPreference: 'no_fried',
      maxItems: 5,
    });
    items.forEach((it) => {
      expect(it.name).not.toMatch(/炸|酥/);
    });
  });

  test('coverage 統計應提供三類數量', () => {
    const { coverage } = recommendLunchCandidates(SAMPLE, { maxItems: 3 });
    expect(coverage).toHaveProperty('starch');
    expect(coverage).toHaveProperty('protein');
    expect(coverage).toHaveProperty('veggie');
  });
});
