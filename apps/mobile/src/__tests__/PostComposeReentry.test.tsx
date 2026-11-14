import React from 'react';
import { Alert, Switch, Text, Pressable } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PostComposeScreen } from '../screens/social/PostComposeScreen';
import MySocialProfileScreen from '../screens/MySocialProfileScreen';
import { rootNavigationRef, rootNavigateNested } from '../app/rootNavigation';
import { createCampusPost } from '../services/feed';

jest.mock('../state/auth', () => ({ useAuth: () => ({ user: { uid: 'alice' } }) }));
jest.mock('../state/school', () => ({
  useSchool: () => ({ selectionReady: true, schoolId: 'pu', school: { id: 'pu', name: '校園' } }),
}));
jest.mock('../firebase', () => ({ isFirebaseMockMode: () => false }));
jest.mock('../services/feed', () => ({ createCampusPost: jest.fn(async () => ({ id: 'new-post' })) }));
jest.mock('../services/boards', () => ({
  listBoards: jest.fn(async () => [{ id: 'general', name: '綜合', defaultAnonymous: true }]),
  CAMPUS_BOARD_TYPE_LABEL: { topic: '主題' },
}));
jest.mock('../services/myPosts', () => ({
  loadOwnCampusPosts: jest.fn(async () => ({ items: [], cursor: null, hasMore: false })),
}));
jest.mock('../services/storage', () => ({ storage: { pickImage: jest.fn() } }));
jest.mock('../services/campusMedia', () => ({ uploadCampusMedia: jest.fn() }));
jest.mock('../services/aliasService', () => ({ getOrCreateBoardAlias: jest.fn(async () => '匿名同學') }));
jest.mock('../services/campusEventBus', () => ({ emitPostCreated: jest.fn() }));
jest.mock('../ui/aiFirst', () => ({
  AIDetailScreen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
function TodayHome() {
  return <Pressable onPress={() => rootNavigateNested('Today', 'PostCompose')}><Text>一般發文</Text></Pressable>;
}
function Today() {
  return <Stack.Navigator screenOptions={{ animation: 'none' }}>
    <Stack.Screen name="TodayHome" component={TodayHome} />
    <Stack.Screen name="PostCompose" component={PostComposeScreen} />
    <Stack.Screen name="CreatorPostCompose" component={PostComposeScreen} />
  </Stack.Navigator>;
}

test('跨分頁從個人頁發文以署名發布，返回一般入口仍保留匿名草稿', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<NavigationContainer ref={rootNavigationRef}>
    <Tabs.Navigator screenOptions={{ animation: 'none', headerShown: false }}>
      <Tabs.Screen name="Today" component={Today} />
      <Tabs.Screen name="我的" component={MySocialProfileScreen} />
    </Tabs.Navigator>
  </NavigationContainer>);
  fireEvent.press(screen.getByText('一般發文'));
  await screen.findByPlaceholderText('一句話描述你的貼文');
  fireEvent.press(await screen.findByText('綜合'));
  fireEvent.changeText(screen.getByPlaceholderText('一句話描述你的貼文'), '原匿名草稿');
  fireEvent.changeText(screen.getByPlaceholderText('想分享什麼？'), '保留原草稿內文');
  expect(screen.UNSAFE_getByType(Switch).props.value).toBe(true);

  act(() => rootNavigationRef.navigate('我的'));
  fireEvent.press(await screen.findByText('發表貼文'));
  await screen.findByText('這篇將以你的帳號署名發表，並顯示在你的個人作品中。');
  expect(screen.getByPlaceholderText('一句話描述你的貼文').props.value).toBe('');
  expect(screen.UNSAFE_getAllByType(Switch).map((node) => node.props.value)).toEqual([true, false]);
  fireEvent.press(await screen.findByText('綜合'));
  expect(screen.UNSAFE_getAllByType(Switch).map((node) => node.props.value)).toEqual([true, false]);
  fireEvent.changeText(screen.getByPlaceholderText('一句話描述你的貼文'), '個人作品');
  fireEvent.changeText(screen.getByPlaceholderText('想分享什麼？'), '署名內文');
  fireEvent.press(screen.getByText('發布'));
  await waitFor(() => expect(createCampusPost).toHaveBeenCalledWith(expect.objectContaining({
    title: '個人作品', anonymous: false, authorUid: 'alice',
  })));

  // Pop only the independent creator route: the original compose instance is still mounted.
  act(() => rootNavigationRef.goBack());
  await screen.findByDisplayValue('原匿名草稿');
  expect(screen.getByDisplayValue('保留原草稿內文')).toBeTruthy();
  expect(screen.getByDisplayValue('general')).toBeTruthy();
  expect(screen.UNSAFE_getByType(Switch).props.value).toBe(true);
  jest.restoreAllMocks();
});
