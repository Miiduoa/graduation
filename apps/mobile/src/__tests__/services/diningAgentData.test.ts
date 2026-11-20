import { getPuDiningMenuItems } from '../../data/puDiningCatalog';
import {
  generateLocalAnswer,
  getDefaultLearningState,
  getDefaultMemory,
  getToolById,
} from '../../data/puAIAgentData';

const LEGACY_FAKE_DINING_NAMES = ['濟時樓學生餐廳', '伯鐸樓美食街', '思源樓輕食區'];

describe('dining agent data', () => {
  it('order_meal requires vendorId, itemId, and quantity for backend createOrder', () => {
    const orderTool = getToolById('order_meal');
    const names = orderTool?.parameters.map((p) => p.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(['vendorId', 'itemId', 'quantity']));
    const required = orderTool?.parameters.filter((p) => p.required).map((p) => p.name) ?? [];
    expect(required).toEqual(expect.arrayContaining(['vendorId', 'itemId', 'quantity']));
  });

  it('falls back to the official dining catalog instead of fake cafeteria data', () => {
    const answer =
      generateLocalAnswer(
        '推薦午餐',
        ['dining'],
        {
          courses: [],
          assignments: [],
          menus: [],
          events: [],
          announcements: [],
          pois: [],
          memory: getDefaultMemory('test-user'),
        },
        [],
        getDefaultLearningState(),
      )?.answer ?? '';

    expect(answer).toContain('靜園餐廳');
    for (const fakeName of LEGACY_FAKE_DINING_NAMES) {
      expect(answer).not.toContain(fakeName);
    }
  });

  it('official PU catalog contains only current dining venue names', () => {
    const menuText = getPuDiningMenuItems('pu')
      .map((menu) => `${menu.name} ${menu.cafeteria}`)
      .join('\n');

    expect(menuText).toContain('靜園餐廳');
    expect(menuText).toContain('宜園餐廳');
    for (const fakeName of LEGACY_FAKE_DINING_NAMES) {
      expect(menuText).not.toContain(fakeName);
    }
  });
});
