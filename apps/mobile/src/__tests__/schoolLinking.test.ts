import { getPathFromState } from '@react-navigation/native';
import { schoolLinking } from '../app/schoolLinking';
import { preAuthLinking } from '../app/preAuthLinking';

jest.unmock('@react-navigation/native');
jest.mock('expo-linking', () => ({ createURL: () => 'campus://' }));

const exchangePaths = [
  ['community', 'CampusSocialScreen', undefined],
  ['board/board-1', 'BoardDetail', { boardId: 'board-1' }],
  ['post/new', 'PostCompose', undefined],
  ['post/post-1', 'PostDetail', { postId: 'post-1' }],
  ['story/new', 'StoryCompose', undefined],
  ['community/member/member-1', 'CreatorProfile', { memberUid: 'member-1' }],
  ['notifications', 'Notifications', undefined],
] as const;

test.each(exchangePaths)('既有 %s 路徑開啟交流並可返回收件匣', (path, screen, params) => {
  const state = schoolLinking.getStateFromPath?.(path, schoolLinking.config);
  expect(state).toBeDefined();
  const tab = state!.routes[0];
  expect(tab.name).toBe('訊息');
  expect(tab.state?.routes.map((route) => route.name)).toEqual(['Inbox', screen]);
  expect(tab.state?.index).toBe(1);
  expect(tab.state?.routes[1].params).toEqual(params);
  // The tab ownership changes without changing any previously shared URI path.
  expect(getPathFromState(state!, schoolLinking.config)).toBe(`/${path}`);
});

test('發文深層連結保留看板參數，且不誤解成 postId=new 或公開作者草稿', () => {
  const state = schoolLinking.getStateFromPath?.(
    'post/new?boardId=campus-board&boardName=%E6%A0%A1%E5%9C%92%E6%9D%BF',
    schoolLinking.config,
  );
  const route = state?.routes[0].state?.routes[1];
  expect(route?.name).toBe('PostCompose');
  expect(route?.params).toEqual({ boardId: 'campus-board', boardName: '校園板' });
});

test.each(exchangePaths)('未連線學校帳號的路由仍不開放 %s', (path) => {
  expect(preAuthLinking.getStateFromPath?.(path, preAuthLinking.config)).toBeUndefined();
});

test.each([
  ['home', 'Today', 'TodayHome'],
  ['announcement/notice-1', 'Today', '公告詳情'],
  ['event/event-1', 'Today', '活動詳情'],
  ['personal-timetable', '學習', 'PersonalTimetable'],
  ['map', '校園', 'Map'],
  ['profile', '我的', 'MeHome'],
  ['notification-settings', '我的', 'NotificationSettings'],
  ['sso-login', '我的', 'SSOLogin'],
] as const)('其餘既有 %s 路徑保持原本分區', (path, tabName, screen) => {
  const state = schoolLinking.getStateFromPath?.(path, schoolLinking.config);
  expect(state?.routes[0].name).toBe(tabName);
  const stack = state?.routes[0].state;
  expect(stack?.routes[stack.index ?? 0].name).toBe(screen);
});

test('同一個職涯連結在學校容器返回生活，在訪客容器返回公開入口', () => {
  const path = 'career?schoolId=ncku';
  const school = schoolLinking.getStateFromPath?.(path, schoolLinking.config);
  expect(school?.routes[0]).toMatchObject({
    name: '校園',
    state: {
      index: 1,
      routes: [{ name: 'CampusHome' }, { name: 'Career', params: { schoolId: 'ncku' } }],
    },
  });
  expect(getPathFromState(school!, schoolLinking.config)).toBe(`/${path}`);

  const guest = preAuthLinking.getStateFromPath?.(path, preAuthLinking.config);
  expect(guest).toMatchObject({
    index: 1,
    routes: [{ name: 'LoginLanding' }, { name: 'Career', params: { schoolId: 'ncku' } }],
  });
  expect(getPathFromState(guest!, preAuthLinking.config)).toBe(`/${path}`);
});

test('抽出配置後，舊店家入口仍只保留校園提示並轉平台餐飲', () => {
  const state = schoolLinking.getStateFromPath?.(
    'shops?schoolId=pu&role=admin&tab=merchant&returnUrl=%2Fadmin',
    schoolLinking.config,
  );
  expect(state?.routes[0].name).toBe('我的');
  const stack = state?.routes[0].state;
  expect(stack?.routes[0].name).toBe('MeHome');
  expect(stack?.routes[stack.index ?? 0]).toMatchObject({
    name: 'NuniWorkspace',
    params: { tab: 'food', schoolId: 'pu' },
  });
  expect(stack?.routes[stack.index ?? 0].params).toEqual({ tab: 'food', schoolId: 'pu' });
});
