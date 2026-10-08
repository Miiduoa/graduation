import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import Constants from 'expo-constants';
import { HomeStack } from '../screens/HomeStack';
import { LearnStack } from '../screens/LearnStack';
import { MeStack } from '../screens/MeStack';
import { MapStack } from '../screens/MapStack';
import { MessagesStack } from '../screens/MessagesStack';
import { ensureLmsV2DemoSignIn } from '../services/lmsV2DemoSignIn';
import { askCampusAssistant } from '../features/campusAssistant';
let mockAuth: any;
const mockAuthContext = React.createContext<any>(null);
let mockSchool = 'pu';
jest.mock('../state/auth', () => ({
  useAuth: () => require('react').useContext(mockAuthContext) ?? mockAuth,
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchool } }) }));
jest.mock('../state/theme', () => ({ useThemeMode: () => ({ mode: 'light' }) }));
jest.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isStudent: true,
    isTeacher: false,
    isAdmin: false,
    displayName: '學生',
  }),
}));
jest.mock('../ui/RouteGuard', () => ({
  RouteGuard: ({ children, requires }: any) => {
    const auth = require('react').useContext(mockAuthContext);
    return requires === 'admin.dashboard' && auth.profile?.role !== 'admin' ? null : children;
  },
}));
jest.mock('../services/lmsV2FeatureFlag', () => ({ isLmsV2Enabled: () => true }));
jest.mock('../services/lmsV2DemoSignIn', () => ({
  ensureLmsV2DemoSignIn: jest.fn().mockResolvedValue({ ok: true }),
}));
jest.mock('../features/courseAdvisor', () => ({
  OFFICIAL_CATALOG_URL: 'https://mypu.pu.edu.tw/Framework/Academic/CourseCatalogSys/',
}));
jest.mock('../features/campusAssistant', () => ({ askCampusAssistant: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../screens/AdminDashboardScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { AdminDashboardScreen: () => React.createElement(Text, null, 'AdminDashboardScreen') };
});
jest.mock('../screens/AICourseAdvisorScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    AICourseAdvisorScreen: () => React.createElement(Text, null, 'AICourseAdvisorScreen'),
  };
});
jest.mock('../screens/AIModelManagerScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'AIModelManagerScreen'),
  };
});
jest.mock('../screens/ARNavigationScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ARNavigationScreen: () => React.createElement(Text, null, 'ARNavigationScreen'),
  };
});
jest.mock('../screens/AcademicOverviewAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'AcademicOverviewAiFirstScreen'),
  };
});
jest.mock('../screens/AcademicScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    AcademicScreen: () => React.createElement(Text, null, 'AcademicScreen'),
  };
});
jest.mock('../screens/AccessibilitySettingsScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    AccessibilitySettingsScreen: () =>
      React.createElement(Text, null, 'AccessibilitySettingsScreen'),
  };
});
jest.mock('../screens/AccessibleRouteScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    AccessibleRouteScreen: () => React.createElement(Text, null, 'AccessibleRouteScreen'),
  };
});
jest.mock('../screens/AccountDeletionScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    AccountDeletionScreen: () => React.createElement(Text, null, 'AccountDeletionScreen'),
  };
});
jest.mock('../screens/AchievementsAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'AchievementsAiFirstScreen'),
  };
});
jest.mock('../screens/AddCourseScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    AddCourseScreen: () => React.createElement(Text, null, 'AddCourseScreen'),
  };
});
jest.mock('../screens/AdminCourseVerifyScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    AdminCourseVerifyScreen: () => React.createElement(Text, null, 'AdminCourseVerifyScreen'),
  };
});
jest.mock('../screens/AnnouncementDetailAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'AnnouncementDetailAiFirstScreen'),
  };
});
jest.mock('../screens/AnnouncementsListAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'AnnouncementsListAiFirstScreen'),
  };
});
jest.mock('../screens/AttendanceAnalyticsScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'AttendanceAnalyticsScreen'),
  };
});
jest.mock('../screens/AttendanceLiveScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'AttendanceLiveScreen'),
  };
});
jest.mock('../screens/AttendanceMultiMethodScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'AttendanceMultiMethodScreen'),
  };
});
jest.mock('../screens/AttendanceScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    AttendanceScreen: () => React.createElement(Text, null, 'AttendanceScreen'),
  };
});
jest.mock('../screens/BugReportScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    BugReportScreen: () => React.createElement(Text, null, 'BugReportScreen'),
  };
});
jest.mock('../screens/BusAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'BusAiFirstScreen') };
});
jest.mock('../screens/BusStopDetailScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    BusStopDetailScreen: () => React.createElement(Text, null, 'BusStopDetailScreen'),
  };
});
jest.mock('../screens/CafeteriaAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CafeteriaAiFirstScreen'),
  };
});
jest.mock('../screens/CampusGameScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    CampusGameScreen: () => React.createElement(Text, null, 'CampusGameScreen'),
  };
});
jest.mock('../screens/CampusGardenScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    CampusGardenScreen: () => React.createElement(Text, null, 'CampusGardenScreen'),
  };
});
jest.mock('../screens/CampusHubScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    CampusHubScreen: () => React.createElement(Text, null, 'CampusHubScreen'),
  };
});
jest.mock('../screens/ChatScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ChatScreen: () => React.createElement(Text, null, 'ChatScreen') };
});
jest.mock('../screens/ClassroomScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ClassroomScreen: () => React.createElement(Text, null, 'ClassroomScreen'),
  };
});
jest.mock('../screens/CommunityScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    CommunityScreen: () => React.createElement(Text, null, 'CommunityScreen'),
  };
});
jest.mock('../screens/CompanionCollectionScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CompanionCollectionScreen'),
  };
});
jest.mock('../screens/CompanionScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'CompanionScreen') };
});
jest.mock('../screens/ConstellationScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'ConstellationScreen'),
  };
});
jest.mock('../screens/CourseCatalogScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    CourseCatalogScreen: () => React.createElement(Text, null, 'CourseCatalogScreen'),
  };
});
jest.mock('../screens/CourseDiscussionScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseDiscussionScreen'),
  };
});
jest.mock('../screens/CourseGradebookScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    CourseGradebookScreen: () => React.createElement(Text, null, 'CourseGradebookScreen'),
  };
});
jest.mock('../screens/CourseHubAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseHubAiFirstScreen'),
  };
});
jest.mock('../screens/CourseHubScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    CourseHubScreen: () => React.createElement(Text, null, 'CourseHubScreen'),
  };
});
jest.mock('../screens/CourseMaterialViewerScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseMaterialViewerScreen'),
  };
});
jest.mock('../screens/CourseModulesScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    CourseModulesScreen: () => React.createElement(Text, null, 'CourseModulesScreen'),
  };
});
jest.mock('../screens/CourseNotesScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'CourseNotesScreen') };
});
jest.mock('../screens/CourseScoresScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'CourseScoresScreen') };
});
jest.mock('../screens/CreditAuditStack', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    CreditAuditStack: () => React.createElement(Text, null, 'CreditAuditStack'),
  };
});
jest.mock('../screens/DataExportScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    DataExportScreen: () => React.createElement(Text, null, 'DataExportScreen'),
  };
});
jest.mock('../screens/DataFlowDebugScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'DataFlowDebugScreen'),
  };
});
jest.mock('../screens/DiscussionThreadDetailScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'DiscussionThreadDetailScreen'),
  };
});
jest.mock('../screens/DmsScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, DmsScreen: () => React.createElement(Text, null, 'DmsScreen') };
});
jest.mock('../screens/EventDetailAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'EventDetailAiFirstScreen'),
  };
});
jest.mock('../screens/EventsListAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'EventsListAiFirstScreen'),
  };
});
jest.mock('../screens/FeedbackScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    FeedbackScreen: () => React.createElement(Text, null, 'FeedbackScreen'),
  };
});
jest.mock('../screens/FollowingListsScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    FollowingListsScreen: () => React.createElement(Text, null, 'FollowingListsScreen'),
  };
});
jest.mock('../screens/FriendSearchScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    FriendSearchScreen: () => React.createElement(Text, null, 'FriendSearchScreen'),
  };
});
jest.mock('../screens/FriendsManageScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    FriendsManageScreen: () => React.createElement(Text, null, 'FriendsManageScreen'),
  };
});
jest.mock('../screens/GlobalSearchScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    GlobalSearchScreen: () => React.createElement(Text, null, 'GlobalSearchScreen'),
  };
});
jest.mock('../screens/GoogleMapsLikeScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    GoogleMapsLikeScreen: () => React.createElement(Text, null, 'GoogleMapsLikeScreen'),
  };
});
jest.mock('../screens/GradesAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'GradesAiFirstScreen'),
  };
});
jest.mock('../screens/GroupAssignmentsScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    GroupAssignmentsScreen: () => React.createElement(Text, null, 'GroupAssignmentsScreen'),
  };
});
jest.mock('../screens/GroupDetailScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    GroupDetailScreen: () => React.createElement(Text, null, 'GroupDetailScreen'),
  };
});
jest.mock('../screens/GroupMembersScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    GroupMembersScreen: () => React.createElement(Text, null, 'GroupMembersScreen'),
  };
});
jest.mock('../screens/GroupPostScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    GroupPostScreen: () => React.createElement(Text, null, 'GroupPostScreen'),
  };
});
jest.mock('../screens/GroupsScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, GroupsScreen: () => React.createElement(Text, null, 'GroupsScreen') };
});
jest.mock('../screens/HealthScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, HealthScreen: () => React.createElement(Text, null, 'HealthScreen') };
});
jest.mock('../screens/HelpScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, HelpScreen: () => React.createElement(Text, null, 'HelpScreen') };
});
jest.mock('../screens/IndoorFloorMapScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    IndoorFloorMapScreen: () => React.createElement(Text, null, 'IndoorFloorMapScreen'),
  };
});
jest.mock('../screens/LanguageSettingsScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    LanguageSettingsScreen: () => React.createElement(Text, null, 'LanguageSettingsScreen'),
  };
});
jest.mock('../screens/LearnAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'LearnAiFirstScreen') };
});
jest.mock('../screens/LibraryAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'LibraryAiFirstScreen'),
  };
});
jest.mock('../screens/LibraryCatalogScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    LibraryCatalogScreen: () => React.createElement(Text, null, 'LibraryCatalogScreen'),
  };
});
jest.mock('../screens/LostFoundDetailScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    LostFoundDetailScreen: () => React.createElement(Text, null, 'LostFoundDetailScreen'),
  };
});
jest.mock('../screens/LostFoundPostScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    LostFoundPostScreen: () => React.createElement(Text, null, 'LostFoundPostScreen'),
  };
});
jest.mock('../screens/LostFoundScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    LostFoundScreen: () => React.createElement(Text, null, 'LostFoundScreen'),
  };
});
jest.mock('../screens/MeAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'MeAiFirstScreen') };
});
jest.mock('../screens/MenuDetailAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'MenuDetailAiFirstScreen'),
  };
});
jest.mock('../screens/MenuSubscriptionScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    MenuSubscriptionScreen: () => React.createElement(Text, null, 'MenuSubscriptionScreen'),
  };
});
jest.mock('../screens/MyAttendanceHistoryScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'MyAttendanceHistoryScreen'),
  };
});
jest.mock('../screens/MyQuizScoresScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'MyQuizScoresScreen') };
});
jest.mock('../screens/NotificationSettingsScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    NotificationSettingsScreen: () => React.createElement(Text, null, 'NotificationSettingsScreen'),
  };
});
jest.mock('../screens/OnBusModeScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    OnBusModeScreen: () => React.createElement(Text, null, 'OnBusModeScreen'),
  };
});
jest.mock('../screens/OrderingScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    OrderingScreen: () => React.createElement(Text, null, 'OrderingScreen'),
  };
});
jest.mock('../screens/PaymentScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    PaymentScreen: () => React.createElement(Text, null, 'PaymentScreen'),
  };
});
jest.mock('../screens/PeerReviewScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    PeerReviewScreen: () => React.createElement(Text, null, 'PeerReviewScreen'),
  };
});
jest.mock('../screens/PeerReviewSubmitScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'PeerReviewSubmitScreen'),
  };
});
jest.mock('../screens/PoiDetailAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'PoiDetailAiFirstScreen'),
  };
});
jest.mock('../screens/PomodoroSessionScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'PomodoroSessionScreen'),
  };
});
jest.mock('../screens/PostLoginDebugScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    PostLoginDebugScreen: () => React.createElement(Text, null, 'PostLoginDebugScreen'),
  };
});
jest.mock('../screens/PrintServiceScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    PrintServiceScreen: () => React.createElement(Text, null, 'PrintServiceScreen'),
  };
});
jest.mock('../screens/ProfileEditAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'ProfileEditAiFirstScreen'),
  };
});
jest.mock('../screens/QRCodeScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, QRCodeScreen: () => React.createElement(Text, null, 'QRCodeScreen') };
});
jest.mock('../screens/QuizCenterAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'QuizCenterAiFirstScreen'),
  };
});
jest.mock('../screens/QuizCenterScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    QuizCenterScreen: () => React.createElement(Text, null, 'QuizCenterScreen'),
  };
});
jest.mock('../screens/QuizTakingScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    QuizTakingScreen: () => React.createElement(Text, null, 'QuizTakingScreen'),
  };
});
jest.mock('../screens/SSOLoginScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    SSOLoginScreen: () => React.createElement(Text, null, 'SSOLoginScreen'),
  };
});
jest.mock('../screens/SettingsAiFirstScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'SettingsAiFirstScreen'),
  };
});
jest.mock('../screens/SmartDashboardScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    SmartDashboardScreen: () => React.createElement(Text, null, 'SmartDashboardScreen'),
  };
});
jest.mock('../screens/StudentTodayScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'StudentTodayScreen') };
});
jest.mock('../screens/SurveyScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'SurveyScreen') };
});
jest.mock('../screens/TeacherGradingScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'TeacherGradingScreen'),
  };
});
jest.mock('../screens/TeacherTodayScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'TeacherTodayScreen') };
});
jest.mock('../screens/ThemePreviewScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemePreviewScreen: () => React.createElement(Text, null, 'ThemePreviewScreen'),
  };
});
jest.mock('../screens/TransportHubScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    TransportHubScreen: () => React.createElement(Text, null, 'TransportHubScreen'),
  };
});
jest.mock('../screens/TripPlannerScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    TripPlannerScreen: () => React.createElement(Text, null, 'TripPlannerScreen'),
  };
});
jest.mock('../screens/UnifiedCalendarScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    UnifiedCalendarScreen: () => React.createElement(Text, null, 'UnifiedCalendarScreen'),
  };
});
jest.mock('../screens/VideoMaterialScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'VideoMaterialScreen'),
  };
});
jest.mock('../screens/WidgetPreviewScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    WidgetPreviewScreen: () => React.createElement(Text, null, 'WidgetPreviewScreen'),
  };
});
jest.mock('../screens/lmsV2/CourseAIAssistantV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseAIAssistantV2Screen'),
  };
});
jest.mock('../screens/lmsV2/CourseAnnouncementsV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseAnnouncementsV2Screen'),
  };
});
jest.mock('../screens/lmsV2/CourseAssignmentDetailV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseAssignmentDetailV2Screen'),
  };
});
jest.mock('../screens/lmsV2/CourseAssignmentsV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseAssignmentsV2Screen'),
  };
});
jest.mock('../screens/lmsV2/CourseForumTopicV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseForumTopicV2Screen'),
  };
});
jest.mock('../screens/lmsV2/CourseForumV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseForumV2Screen'),
  };
});
jest.mock('../screens/lmsV2/CourseGradesV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseGradesV2Screen'),
  };
});
jest.mock('../screens/lmsV2/CourseHubV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'CourseHubV2Screen') };
});
jest.mock('../screens/lmsV2/CourseLiveV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => React.createElement(Text, null, 'CourseLiveV2Screen') };
});
jest.mock('../screens/lmsV2/CourseMaterialsV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseMaterialsV2Screen'),
  };
});
jest.mock('../screens/lmsV2/CourseQuestionBankV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseQuestionBankV2Screen'),
  };
});
jest.mock('../screens/lmsV2/CourseQuizTakingV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseQuizTakingV2Screen'),
  };
});
jest.mock('../screens/lmsV2/CourseQuizzesV2Screen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'CourseQuizzesV2Screen'),
  };
});
jest.mock('../screens/social/BoardDetailScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    BoardDetailScreen: () => React.createElement(Text, null, 'BoardDetailScreen'),
  };
});
jest.mock('../screens/social/PostComposeScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    PostComposeScreen: () => React.createElement(Text, null, 'PostComposeScreen'),
  };
});
jest.mock('../screens/social/PostDetailScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    PostDetailScreen: () => React.createElement(Text, null, 'PostDetailScreen'),
  };
});
jest.mock('../screens/social/StoryComposeScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    StoryComposeScreen: () => React.createElement(Text, null, 'StoryComposeScreen'),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = 'pu';
  mockAuth = {
    user: { uid: 'u1' },
    profile: { uid: 'u1', role: 'student', roleGroup: 'student', schoolId: 'pu' },
    loading: false,
    profileLoading: false,
  };
  Object.assign(Constants.expoConfig!, {
    extra: { appEnv: 'production', enableUniversalDevAccounts: true },
  });
  (askCampusAssistant as jest.Mock).mockResolvedValue({
    content: '這是伺服器核實的回答。',
    hasActions: false,
  });
});
async function mount(Stack: React.ComponentType) {
  const navigation = createNavigationContainerRef<any>();
  const view = render(
    <mockAuthContext.Provider value={{ ...mockAuth }}>
      <NavigationContainer ref={navigation}>
        <Stack />
      </NavigationContainer>
    </mockAuthContext.Provider>,
  );
  await waitFor(() => expect(navigation.isReady()).toBe(true));
  return { view, navigation };
}
test('release AddCourse navigates to real course advice, with no simulated enrollment', async () => {
  const { view, navigation } = await mount(LearnStack);
  act(() => navigation.navigate('AddCourse'));
  expect(view.getByText('查課與加退選')).toBeTruthy();
  expect(view.queryByText('確認加選')).toBeNull();
  fireEvent.press(view.getByText('查詢課程與安排'));
  await waitFor(() => expect(view.getByText('AICourseAdvisorScreen')).toBeTruthy());
  expect(ensureLmsV2DemoSignIn).not.toHaveBeenCalled();
});

test.each([
  ['GradeWhatIf', '成績試算尚未開放'],
  ['MonthlySummary', '每月學習回顧尚未開放'],
  ['StudentOrders', '校園訂餐尚未開放'],
  ['VendorRevenueReport', '營運報表尚未開放'],
  ['VendorLoyaltyPush', '顧客通知尚未開放'],
  ['VendorMenuManage', '菜單管理尚未開放'],
  ['StudentRisk', '學習關懷分析尚未開放'],
  ['TeachingEvaluation', '教學評量分析尚未開放'],
  ['AIStudyBuddy', '學習夥伴配對尚未開放'],
  ['LifeRequests', '線上申請尚未開放'],
  ['HomeworkSubmit', '此入口尚未提供線上繳交'],
  ['MistakeRepertoire', '錯題整理尚未開放'],
  ['StudentInbox', '待辦彙整尚未開放'],
  ['AITrustCard', '使用紀錄彙整尚未開放'],
])('release route %s cannot mount the old simulated workflow', async (route, explanation) => {
  const { view, navigation } = await mount(LearnStack);
  act(() => navigation.navigate(route, { courseId: 'demo_c001' }));
  expect(view.getByText(new RegExp(explanation))).toBeTruthy();
  expect(view.getByText('目前可以使用')).toBeTruthy();
  expect(view.queryByText(`${route}Screen`)).toBeNull();
});
test.each([
  'CourseHubV2',
  'CourseMaterialsV2',
  'CourseAssignmentsV2',
  'CourseAssignmentDetailV2',
  'CourseQuizzesV2',
  'CourseQuizTakingV2',
  'CourseForumV2',
  'CourseForumTopicV2',
  'CourseAnnouncementsV2',
  'CourseGradesV2',
  'CourseAIAssistantV2',
  'CourseQuestionBankV2',
  'CourseLiveV2',
])('a direct %s deep link does not bypass the release LMS gate', async (route) => {
  const { view, navigation } = await mount(LearnStack);
  act(() => navigation.navigate(route, { courseId: 'demo-course' }));
  expect(view.getByText(/這項課程功能尚未開放/)).toBeTruthy();
  fireEvent.press(view.getByText('查看我的課程'));
  await waitFor(() => expect(view.getByText('LearnAiFirstScreen')).toBeTruthy());
  expect(ensureLmsV2DemoSignIn).not.toHaveBeenCalled();
});
test('legacy TodayCockpit selects the authenticated live dashboard instead of a synthetic story', async () => {
  const { view, navigation } = await mount(LearnStack);
  act(() => navigation.navigate('TodayCockpit'));
  expect(view.getByText('StudentTodayScreen')).toBeTruthy();
});
test.each([
  'teacher',
  'ta',
  'club_officer',
  'department_head',
  'admin',
  'vendor',
  'staff',
  'alumni',
])('authenticated %s cannot be routed to a fabricated dashboard', async (role) => {
  mockAuth.profile = { ...mockAuth.profile, role, roleGroup: role === 'vendor' ? 'staff' : role };
  const { view } = await mount(HomeStack);
  if (role === 'teacher') expect(view.getByText('TeacherTodayScreen')).toBeTruthy();
  else if (role === 'admin') expect(view.getByText('管理公告與活動')).toBeTruthy();
  else {
    expect(view.getByText(/此身分的工作台尚未開放/)).toBeTruthy();
    expect(view.getByText('查看校方公告')).toBeTruthy();
    expect(view.queryByText('StudentTodayScreen')).toBeNull();
  }
});
test('role comes from the current authenticated profile, never a UID prefix or a prior account', async () => {
  mockAuth.user.uid = 'demo_admin_sys';
  mockAuth.profile.uid = 'demo_admin_sys';
  const { view, navigation } = await mount(HomeStack);
  expect(view.getByText('StudentTodayScreen')).toBeTruthy();
  mockAuth.user = { uid: 'new-user' };
  view.rerender(
    <mockAuthContext.Provider value={{ ...mockAuth }}>
      <NavigationContainer ref={navigation}>
        <HomeStack />
      </NavigationContainer>
    </mockAuthContext.Provider>,
  );
  expect(view.queryByText('StudentTodayScreen')).toBeNull();
  expect(view.getByText(/目前無法確認帳號身分/)).toBeTruthy();
});
test.each(['AIChat', 'AIAgentConsole'])(
  'Home %s sends through the callable chat UI and displays only its reply',
  async (route) => {
    const { view, navigation } = await mount(HomeStack);
    act(() => navigation.navigate(route));
    fireEvent.changeText(view.getByLabelText('詢問校園助理'), '本週有哪些活動？');
    await act(async () => fireEvent.press(view.getByText('送出問題')));
    expect(askCampusAssistant).toHaveBeenCalledTimes(1);
    expect(view.getByText('這是伺服器核實的回答。')).toBeTruthy();
  },
);
test.each(['AIAgentConsole', 'AIAgentObservatory'])(
  'Learn %s uses the same real assistant entry',
  async (route) => {
    const { view, navigation } = await mount(LearnStack);
    act(() => navigation.navigate(route));
    expect(view.getByLabelText('詢問校園助理')).toBeTruthy();
    expect(view.queryByText('AIAgentConsoleScreen')).toBeNull();
  },
);
test.each([
  ['Clubs', '社團申請與名單管理尚未開放'],
  ['Dormitory', '宿舍包裹查詢與線上報修尚未開放'],
])('Map %s cannot submit demo actions', async (route, explanation) => {
  const { view, navigation } = await mount(MapStack);
  act(() => navigation.navigate(route));
  expect(view.getByText(new RegExp(explanation))).toBeTruthy();
});
test.each([
  ['MerchantHub', '商家工作台尚未開放'],
  ['Notifications', '通知彙整尚未開放'],
])('Me %s no longer shows fictitious account data', async (route, explanation) => {
  const { view, navigation } = await mount(MeStack);
  act(() => navigation.navigate(route));
  expect(view.getByText(new RegExp(explanation))).toBeTruthy();
});
test('message landing reaches live private conversations and its old alias has no synthetic people', async () => {
  const { view, navigation } = await mount(MessagesStack);
  expect(view.getByText('開啟私訊')).toBeTruthy();
  fireEvent.press(view.getByText('開啟私訊'));
  await waitFor(() => expect(view.getByText('DmsScreen')).toBeTruthy());
  act(() => navigation.navigate('MessagesHome'));
  expect(view.getByText('開啟群組')).toBeTruthy();
  expect(view.queryByText('林助教')).toBeNull();
  fireEvent.press(view.getByText('開啟群組'));
  await waitFor(() => expect(view.getByText('GroupsScreen')).toBeTruthy());
});
test('assignment deep links never mount the simulated submission page', async () => {
  const { view, navigation } = await mount(MessagesStack);
  act(() => navigation.navigate('AssignmentDetail', { assignmentId: 'A001', groupId: 'G001' }));
  expect(view.getByText(/此作業入口尚未提供線上繳交/)).toBeTruthy();
  expect(view.queryByText('提交作業')).toBeNull();
});

test.each([MeStack, LearnStack])(
  'real admin management remains reachable behind its permission guard',
  async (Stack) => {
    const { view, navigation } = await mount(Stack);
    act(() => navigation.navigate('AdminDashboard'));
    expect(view.queryByText('AdminDashboardScreen')).toBeNull();
    mockAuth.profile = { ...mockAuth.profile, role: 'admin', roleGroup: 'admin' };
    view.rerender(
      <mockAuthContext.Provider value={{ ...mockAuth }}>
        <NavigationContainer ref={navigation}>
          <Stack />
        </NavigationContainer>
      </mockAuthContext.Provider>,
    );
    expect(view.getByText('AdminDashboardScreen')).toBeTruthy();
  },
);
