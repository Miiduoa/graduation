const allowedScreenDirectFirebaseImports = [
  'apps/mobile/src/screens/AccountDeletionScreen.tsx',
  'apps/mobile/src/screens/AdminCourseVerifyScreen.tsx',
  'apps/mobile/src/screens/CampusGameScreen.tsx',
  'apps/mobile/src/screens/CompanionCollectionScreen.tsx',
  'apps/mobile/src/screens/ConstellationScreen.tsx',
  'apps/mobile/src/screens/AdminDashboardScreen.tsx',
  'apps/mobile/src/screens/BugReportScreen.tsx',
  'apps/mobile/src/screens/ChatScreen.tsx',
  'apps/mobile/src/screens/ClassroomScreen.tsx',
  'apps/mobile/src/screens/DepartmentHubScreen.tsx',
  'apps/mobile/src/screens/DmsScreen.tsx',
  'apps/mobile/src/screens/FollowingListsScreen.tsx',
  'apps/mobile/src/screens/FriendSearchScreen.tsx',
  'apps/mobile/src/screens/FriendsManageScreen.tsx',
  'apps/mobile/src/screens/GlobalSearchScreen.tsx',
  'apps/mobile/src/screens/GroupDetailScreen.tsx',
  'apps/mobile/src/screens/GroupMembersScreen.tsx',
  'apps/mobile/src/screens/GroupPostScreen.tsx',
  'apps/mobile/src/screens/GroupsScreen.tsx',
  'apps/mobile/src/screens/LearningAnalyticsScreen.tsx',
  'apps/mobile/src/screens/PostLoginDebugScreen.tsx',
  'apps/mobile/src/screens/SSOLoginScreen.tsx',
  // social/PostDetailScreen 在 main 上已重做（dcf9e8aa），改用 '../../firebase'
  // 而非 '../firebase'/firebase/firestore，已不符合 test 的 restrictedImportPatterns，
  // 因此從 allowlist 移除以避免 staleAllowlistEntries 為非空。
];

module.exports = {
  allowedScreenDirectFirebaseImports,
};
