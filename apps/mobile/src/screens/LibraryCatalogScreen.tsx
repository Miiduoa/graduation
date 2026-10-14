/**
 * School-aware catalog route. Providence has an integrated OPAC client;
 * other universities use their verified official catalog entry points.
 */
import React from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { getOfficialLibrary } from '@campus/shared/src/officialLibraries';
import { Screen } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { analytics } from '../services/analytics';
import { LibraryOpacPanel } from './LibraryOpacPanel';
import { useSchool } from '../state/school';
import { theme } from '../ui/theme';

export function LibraryCatalogScreen(props: { navigation?: any; route?: any }) {
  const initialQ =
    typeof props.route?.params?.initialQuery === 'string' ? props.route.params.initialQuery : '';
  const { school } = useSchool();
  const library = getOfficialLibrary(school.id);

  React.useEffect(() => {
    analytics.logScreenView('LibraryCatalog');
  }, []);

  if (school.id !== 'pu') {
    return (
      <Screen title="館藏查詢" subtitle="前往目前所選校園的圖書館" noPadding>
        <View style={{ padding: theme.layout.screenHorizontalPadding, gap: 16 }}>
          <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>
            {library?.name ?? '此校圖書館尚未接通'}
          </Text>
          <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
            {library
              ? '這所學校有自己的館藏系統，請在官方網站搜尋並確認館藏狀態。此處不會顯示靜宜大學的書目。'
              : '目前尚未確認這所學校的官方館藏入口，因此不會套用其他校園的書目資料。'}
          </Text>
          {library ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(library.catalogUrl).catch(() => {})}
              style={{
                minHeight: 48,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 12,
                backgroundColor: theme.colors.accent,
                paddingHorizontal: 16,
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                開啟學校官方館藏
              </Text>
            </Pressable>
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
