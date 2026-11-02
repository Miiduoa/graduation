import HomeworkSubmitScreen from './HomeworkSubmitScreen';
import { MessagesLandingScreen } from './MessagesLandingScreen';
/* eslint-disable */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useThemeMode } from '../state/theme';
import { createStackScreenOptions } from '../ui/navigationTheme';
// 訊息 Tab 主入口（舊版 InboxScreen / MessagesHomeScreen /
// AssignmentDetailScreen 已下架）
import { GroupsScreen } from './GroupsScreen';
import { GroupDetailScreen } from './GroupDetailScreen';
import { GroupMembersScreen } from './GroupMembersScreen';
import { GroupPostScreen } from './GroupPostScreen';
import { GroupAssignmentsScreen } from './GroupAssignmentsScreen';
import { DmsScreen } from './DmsScreen';
import { FriendSearchScreen } from './FriendSearchScreen';
import { FriendsManageScreen } from './FriendsManageScreen';
import { FollowingListsScreen } from './FollowingListsScreen';
import { ChatScreen } from './ChatScreen';
import { AdminCourseVerifyScreen } from './AdminCourseVerifyScreen';
import { RouteGuard } from '../ui/RouteGuard';

const Stack = createNativeStackNavigator<any, undefined>();

function GuardedMessagesAdminCourseVerify(props: any) {
  return (
    <RouteGuard requires="admin.course_verify">
      <AdminCourseVerifyScreen {...props} />
    </RouteGuard>
  );
}

export function MessagesStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="Inbox"
      screenOptions={createStackScreenOptions()}
    >
      {/* landing 換新版 */}
      <Stack.Screen
        name="Inbox"
        component={MessagesLandingScreen}
        options={{ title: '訊息', headerShown: false }}
      />
      <Stack.Screen
        name="MessagesHome"
        component={MessagesLandingScreen}
        options={{ title: '訊息', headerShown: false }}
      />
      <Stack.Screen name="Groups" component={GroupsScreen} options={{ title: '群組' }} />
      <Stack.Screen name="GroupDetail" component={GroupDetailScreen} options={{ title: '群組' }} />
      <Stack.Screen
        name="GroupMembers"
        component={GroupMembersScreen}
        options={{ title: '成員' }}
      />
      <Stack.Screen name="GroupPost" component={GroupPostScreen} options={{ title: '貼文' }} />
      <Stack.Screen
        name="GroupAssignments"
        component={GroupAssignmentsScreen}
        options={{ title: '作業' }}
      />
      <Stack.Screen
        name="AssignmentDetail"
        component={HomeworkSubmitScreen}
        options={{ title: '作業', headerShown: false }}
      />
      <Stack.Screen
        name="AdminCourseVerify"
        component={GuardedMessagesAdminCourseVerify}
        options={{ title: '課程認證' }}
      />
      <Stack.Screen name="Dms" component={DmsScreen} options={{ title: '私訊' }} />
      <Stack.Screen
        name="FriendsManage"
        component={FriendsManageScreen}
        options={{ title: '好友與邀請' }}
      />
      <Stack.Screen
        name="FriendSearch"
        component={FriendSearchScreen}
        options={{ title: '搜尋／加好友' }}
      />
      <Stack.Screen
        name="FollowingLists"
        component={FollowingListsScreen}
        options={{ title: '追蹤與粉絲' }}
      />
      {/* 單則送出中／未確認／失敗與重試由 ChatScreen + messagingInboxModel 處理，不在此重構。 */}
      <Stack.Screen name="Chat" component={ChatScreen} options={{ title: '對話' }} />
    </Stack.Navigator>
  );
}
