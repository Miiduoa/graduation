/**
 * 靜宜館藏使用 WebPac 原生查詢。其他學校只導向各自官方圖書館；
 * 未接入的館藏不得由靜宜查詢結果代替。
 */
import React, { useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';

import { Screen } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { analytics } from '../services/analytics';
import { LibraryOpacPanel } from './LibraryOpacPanel';
import { theme } from '../ui/theme';
import { useSchool } from '../state/school';
import { getOfficialCampusLibrary } from '@campus/shared/src/libraryDirectory';

export function LibraryCatalogScreen(props: {
  navigation?: unknown;
  route?: { params?: { initialQuery?: unknown } };
}) {
  const { school } = useSchool();
  const [openError, setOpenError] = useState(false);
  const initialQ =
    typeof props.route?.params?.initialQuery === 'string' ? props.route.params.initialQuery : '';
  const library = getOfficialCampusLibrary(school.id);

  React.useEffect(() => {
    analytics.logScreenView('LibraryCatalog');
  }, []);

  if (school.id !== 'pu') {
    return (
      <Screen
        title="館藏查詢"
        subtitle={`${school.name} · 以館方資料為準`}
        noPadding
      >
        <View style={{ paddingHorizontal: theme.layout.screenHorizontalPadding, paddingVertical: 20, gap: 16 }}>
          <Text style={{ color: theme.colors.text, lineHeight: 24 }}>
            {library
              ? '這所學校尚未開放 App 內直接查館藏，請前往該校圖書館網站搜尋、查看可借狀態或登入借閱帳戶。'
              : '尚未確認這所學校的館藏查詢網站。請從學校官方網站查詢，不會顯示其他學校的館藏。'}
          </Text>
          {library ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`前往${library.name}官方網站`}
              onPress={() => {
                setOpenError(false);
                void Linking.openURL(library.catalogUrl ?? library.websiteUrl).catch(() =>
                  setOpenError(true),
                );
              }}
              style={{
                minHeight: 48,
                padding: 12,
                borderRadius: 12,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>
                開啟${library.name} ↗
              </Text>
            </Pressable>
          ) : null}
          {openError ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
              無法開啟圖書館網站，請確認網路連線後重試。
            </Text>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      title="館藏查詢"
      subtitle="依書名、作者或 ISBN 找書。借閱與預約請前往圖書館網站確認。"
      noPadding
    >
      <View style={{ flex: 1, paddingHorizontal: theme.layout.screenHorizontalPadding }}>
        <LibraryOpacPanel
          variant="fullscreen"
          initialQuery={initialQ}
          bottomInset={TAB_BAR_CONTENT_BOTTOM_PADDING + (Platform.OS === 'ios' ? 8 : 12)}
        />
      </View>
    </Screen>
  );
}

export default LibraryCatalogScreen;
