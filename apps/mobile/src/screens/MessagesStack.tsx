import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useThemeMode } from "../state/theme";
import { createStackScreenOptions } from "../ui/navigationTheme";
import { MessagesHomeScreen } from "./MessagesHomeScreen";
import { GroupsScreen } from "./GroupsScreen";
import { GroupDetailScreen } from "./GroupDetailScreen";
import { GroupMembersScreen } from "./GroupMembersScreen";
import { GroupPostScreen } from "./GroupPostScreen";
import { GroupAssignmentsScreen } from "./GroupAssignmentsScreen";
import { AssignmentDetailScreen } from "./AssignmentDetailScreen";
import { DmsScreen } from "./DmsScreen";
import { ChatScreen } from "./ChatScreen";
import { AdminCourseVerifyScreen } from "./AdminCourseVerifyScreen";

const Stack = createNativeStackNavigator<any, undefined>();

export function MessagesStack() {
  useThemeMode();

  return (
    <Stack.Navigator
      id={undefined}
      initialRouteName="MessagesHome"
      screenOptions={createStackScreenOptions()}
    >
      <Stack.Screen name="MessagesHome" component={MessagesHomeScreen} options={{ title: "訊息", headerShown: false }} />
      <Stack.Screen name="Groups" component={GroupsScreen} options={{ title: "群組" }} />
      <Stack.Screen name="GroupDetail" component={GroupDetailScreen} options={{ title: "群組" }} />
      <Stack.Screen name="GroupMembers" component={GroupMembersScreen} options={{ title: "成員" }} />
      <Stack.Screen name="GroupPost" component={GroupPostScreen} options={{ title: "貼文" }} />
      <Stack.Screen name="GroupAssignments" component={GroupAssignmentsScreen} options={{ title: "作業" }} />
      <Stack.Screen name="AssignmentDetail" component={AssignmentDetailScreen} options={{ title: "作業" }} />
      <Stack.Screen name="AdminCourseVerify" component={AdminCourseVerifyScreen} options={{ title: "課程認證" }} />
      <Stack.Screen name="Dms" component={DmsScreen} options={{ title: "私訊" }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={{ title: "對話" }} />
    </Stack.Navigator>
  );
}
