import { getPuDiningMenuItems } from '../../data/puDiningCatalog';
import {
  generateLocalAnswer,
  getDefaultLearningState,
  getDefaultMemory,
  getToolById,
} from '../../data/puAIAgentData';

const LEGACY_FAKE_DINING_NAMES = ['濟時樓學生餐廳', '伯鐸樓美食街', '思源樓輕食區'];

describe('dining agent data', () => {
  it('uses verified Providence dining options in order parameters', () => {
    const orderTool = getToolById('order_meal');
    const labels =
      orderTool?.parameters
        .find((param) => param.name === 'cafeteria')
        ?.options?.map((option) => option.label) ?? [];

    expect(labels).toEqual(
      expect.arrayContaining(['靜園餐廳', '宜園餐廳', '至善美食廣場一樓', 'OK 便利商店']),
    );
    for (const fakeName of LEGACY_FAKE_DINING_NAMES) {
      expect(labels.join('\n')).not.toContain(fakeName);
    }
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
