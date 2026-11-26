/**
 * School-aware catalog route. Providence has an integrated OPAC client;
 * other universities use their verified official catalog entry points.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  buildOfficialLibraryCatalogUrl,
  getOfficialLibrary,
  hasVerifiedCatalogSearch,
} from '@campus/shared/src/officialLibraries';
import { Screen } from '../ui/components';
import { AIDetailHeader } from '../ui/aiFirst';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { analytics } from '../services/analytics';
import { LibraryWebsiteFallback } from './LibraryWebsiteFallback';
import { LibraryOpacPanel } from './LibraryOpacPanel';
import { useSchool } from '../state/school';
import { theme } from '../ui/theme';

export function LibraryCatalogScreen(props: {
  navigation?: { goBack: () => void; canGoBack: () => boolean };
  route?: { params?: { initialQuery?: string; autoSearch?: boolean } };
}) {
  const initialQ =
    typeof props.route?.params?.initialQuery === 'string' ? props.route.params.initialQuery : '';
  const { school, selection, selectionReady } = useSchool();
  const schoolId = selectionReady ? (selection.schoolId ?? '') : '';
  const scope = JSON.stringify([schoolId, school.name]);
  const initialScope = useRef<string | null>(null);
  if (selectionReady && initialScope.current === null) initialScope.current = scope;
  else if (initialScope.current !== null && initialScope.current !== scope)
    initialScope.current = '';

  React.useEffect(() => {
    analytics.logScreenView('LibraryCatalog');
  }, []);

  return (
    <Screen noPadding>
      <AIDetailHeader
        title="館藏查詢"
        subtitle={schoolId === 'pu' ? '靜宜大學蓋夏圖書館' : '學校官方館藏'}
        onBack={props.navigation?.canGoBack() ? props.navigation.goBack : undefined}
      />
      <ScopedCatalog
        key={scope}
        schoolId={schoolId}
        schoolName={school.name}
        initialQ={scope === initialScope.current ? initialQ : ''}
        autoSearch={scope === initialScope.current && props.route?.params?.autoSearch === true}
      />
    </Screen>
  );
}

function ScopedCatalog({
  schoolId,
  schoolName,
  initialQ,
  autoSearch,
}: {
  schoolId: string;
  schoolName: string;
  initialQ: string;
  autoSearch: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const library = getOfficialLibrary(schoolId, schoolName);
  const verifiedSearch = hasVerifiedCatalogSearch(library);

  if (schoolId !== 'pu') {
    return (
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.layout.screenHorizontalPadding,
          paddingTop: 8,
          paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING,
        }}
      >
        <Text
          style={{
            color: theme.colors.muted,
            fontSize: 13,
            fontWeight: '600',
            letterSpacing: 0.4,
          }}
        >
          學校官方館藏
        </Text>
        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.text,
            fontSize: 20,
            lineHeight: 28,
            fontWeight: '700',
            marginTop: 8,
          }}
        >
          {library?.name ?? '此校圖書館尚未接通'}
        </Text>
        {library ? (
          <Text style={{ color: theme.colors.textSecondary, lineHeight: 22, marginTop: 8 }}>
            到{library.name}的官方館藏網站查詢書目與借閱狀態。
          </Text>
        ) : (
          <View style={{ marginTop: 8 }}>
            <LibraryWebsiteFallback schoolId={schoolId} schoolName={schoolName} />
          </View>
        )}
        {library ? (
          <View
            style={{
              marginTop: 20,
              paddingTop: 20,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.separator,
            }}
          >
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`開啟${library.name}官方館藏`}
              onPress={() => {
                if (!active.current) return;
                setFailed(false);
                const searchUrl =
                  buildOfficialLibraryCatalogUrl(schoolId, initialQ, 'FullText', schoolName) ??
                  library.catalogUrl;
                void Linking.openURL(searchUrl).catch(() => {
                  if (active.current) setFailed(true);
                });
              }}
              style={({ pressed }) => ({
                minHeight: 48,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: theme.radius.sm,
                backgroundColor: pressed ? theme.colors.accentHover : theme.colors.accent,
                paddingHorizontal: 16,
              })}
            >
              <Text style={{ color: theme.colors.onAccent, fontWeight: '700' }}>
                {verifiedSearch && initialQ.trim() ? '搜尋本校館藏' : '開啟學校官方館藏'}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {failed ? (
          <Text
            accessibilityRole="alert"
            style={{ color: theme.colors.danger, lineHeight: 22, marginTop: 12 }}
          >
            無法開啟館藏網站，請確認網路連線後再試。
          </Text>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, paddingHorizontal: theme.layout.screenHorizontalPadding }}>
      <LibraryOpacPanel
        variant="fullscreen"
        key={JSON.stringify([initialQ, autoSearch])}
        initialQuery={initialQ}
        autoSearch={autoSearch}
        bottomInset={TAB_BAR_CONTENT_BOTTOM_PADDING + (Platform.OS === 'ios' ? 8 : 12)}
      />
    </View>
  );
}

export default LibraryCatalogScreen;
