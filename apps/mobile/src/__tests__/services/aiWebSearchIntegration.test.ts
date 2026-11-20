jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { chatWithCampusAssistant, type AIContext } from '../../services/ai';

const baseContext: AIContext = {
  schoolId: 'tw-pu',
  userId: 'test-user',
  userName: '測試同學',
  announcements: [],
  events: [],
  menus: [],
  pois: [],
  courses: [],
  pendingAssignments: [],
};

describe('AI web search integration', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_AI_PROVIDER = 'offline';
    process.env.EXPO_PUBLIC_AI_ENABLE_WEB_SEARCH = 'true';
    process.env.EXPO_PUBLIC_AI_TEST_FAST = '1';
  });

  it('routes transit questions to grounded online route answers', async () => {
    const response = await chatWithCampusAssistant(
      [{ role: 'user', content: '怎麼去台中車站' }],
      baseContext,
    );

    expect(response.content).toContain('300');
    expect(response.content).toContain('臺中市公車即時動態');
    expect(response.content).toContain('Google Maps');
    expect(response.content).toContain('查詢時間');
  });

  it('does not web-search personal course data', async () => {
    const response = await chatWithCampusAssistant(
      [{ role: 'user', content: '今天有什麼課' }],
      baseContext,
    );

    expect(response.content).toContain('沒有載入課程資料');
    expect(response.content).not.toContain('資料來源：');
  });
});
