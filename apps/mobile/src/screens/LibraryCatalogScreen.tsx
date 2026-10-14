/**
 * 全螢幕館藏查詢 — 與「找書」官方館藏同一組 GraphQL（對齊課綱查詢：原生列表 + HTTP）。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { Platform, Text, View } from 'react-native';

import { Screen } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { analytics } from '../services/analytics';
import { LibraryOpacPanel } from './LibraryOpacPanel';
import { theme } from '../ui/theme';
import { useSchool } from '../state/school';
import { getSchoolLibrary } from '@campus/shared/src/libraryDirectory';

export function LibraryCatalogScreen(props: { navigation?: any; route?: any }) {
  const { school } = useSchool();
  const supportsNativeCatalog = getSchoolLibrary(school.id, school.name)?.searchMode === 'pu-webpac';
  const initialQ =
    typeof props.route?.params?.initialQuery === 'string' ? props.route.params.initialQuery : '';

  React.useEffect(() => {
    analytics.logScreenView('LibraryCatalog');
  }, []);

  return (
    <Screen
      title="館藏查詢"
      subtitle="依書名、作者或 ISBN 找書。借閱與預約請前往圖書館網站確認。"
      noPadding
    >
      <View style={{ flex: 1, paddingHorizontal: theme.layout.screenHorizontalPadding }}>
        {supportsNativeCatalog ? (
          <LibraryOpacPanel
            key={school.id}
            variant="fullscreen"
            initialQuery={initialQ}
            bottomInset={TAB_BAR_CONTENT_BOTTOM_PADDING + (Platform.OS === 'ios' ? 8 : 12)}
          />
        ) : (
          <Text style={{ color: theme.colors.muted, paddingVertical: 20 }}>
            目前這所學校尚未接入 App 內的即時館藏查詢。請從圖書館頁面開啟該校官方系統。
          </Text>
        )}
      </View>
    </Screen>
  );
}

export default LibraryCatalogScreen;
