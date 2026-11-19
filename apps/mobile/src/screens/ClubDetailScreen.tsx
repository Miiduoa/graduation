import React, { useSyncExternalStore } from 'react';
import { ScrollView, Text } from 'react-native';
import { Screen } from '../ui/components';
import { theme, getThemeVersion, subscribeToTheme } from '../ui/theme';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { ClubPortal } from './ClubPortal';

/** Reuse the authorized club portal while keeping the life directory in the back stack. */
export function ClubDetailScreen({ route }: { route?: { params?: { groupId?: string } } }) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school, selectionReady } = useSchool();
  const groupId = route?.params?.groupId;
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        {user?.uid &&
        school.id &&
        selectionReady !== false &&
        typeof groupId === 'string' &&
        groupId.trim() ? (
          <ClubPortal
            key={JSON.stringify([user.uid, school.id, groupId])}
            uid={user.uid}
            schoolId={school.id}
            groupId={groupId}
          />
        ) : (
          <Text style={{ color: theme.colors.text, lineHeight: 22 }}>
            {user?.uid ? '請返回社團目錄，選擇要查看的社團。' : '登入學校帳號後查看社團資料。'}
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}
