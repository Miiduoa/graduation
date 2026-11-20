/**
 * School-aware catalog route. Providence has an integrated OPAC client;
 * other universities use their verified official catalog entry points.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import {
  buildOfficialLibraryCatalogUrl,
  getOfficialLibrary,
  hasVerifiedCatalogSearch,
} from '@campus/shared/src/officialLibraries';
import { Screen } from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { analytics } from '../services/analytics';
import { LibraryWebsiteFallback } from './LibraryWebsiteFallback';
import { LibraryOpacPanel } from './LibraryOpacPanel';
import { useSchool } from '../state/school';
import { theme } from '../ui/theme';

export function LibraryCatalogScreen(props: { navigation?: any; route?: any }) {
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
    <ScopedCatalog
      key={scope}
      schoolId={schoolId}
      schoolName={school.name}
      initialQ={scope === initialScope.current ? initialQ : ''}
    />
  );
}

function ScopedCatalog({
  schoolId,
  schoolName,
  initialQ,
}: {
  schoolId: string;
  schoolName: string;
  initialQ: string;
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
      <Screen title="館藏查詢" subtitle="前往目前所選校園的圖書館" noPadding>
        <View style={{ padding: theme.layout.screenHorizontalPadding, gap: 16 }}>
          <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>
            {library?.name ?? '此校圖書館尚未接通'}
          </Text>
          {library ? (
            <Text style={{ color: theme.colors.muted, lineHeight: 22 }}>
              到{library.name}的官方館藏網站查詢書目與借閱狀態。
            </Text>
          ) : (
            <LibraryWebsiteFallback schoolId={schoolId} schoolName={schoolName} />
          )}
          {library ? (
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
              style={{
                minHeight: 48,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: 12,
                backgroundColor: theme.colors.accent,
                paddingHorizontal: 16,
              }}
            >
              <Text style={{ color: theme.colors.onAccent, fontWeight: '700' }}>
                {verifiedSearch && initialQ.trim() ? '搜尋本校館藏' : '開啟學校官方館藏'}
              </Text>
            </Pressable>
          ) : null}
          {failed ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
              無法開啟館藏網站，請確認網路連線後再試。
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
