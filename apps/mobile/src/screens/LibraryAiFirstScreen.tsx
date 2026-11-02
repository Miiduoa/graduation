import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  buildOfficialLibraryCatalogUrl,
  getOfficialLibrary,
  getOfficialLibraryCatalogQueryMaxLength,
  hasVerifiedCatalogSearch,
} from '@campus/shared/src/officialLibraries';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';

type Navigation = {
  goBack?: () => void;
  navigate?: (screen: string, params?: { initialQuery: string }) => void;
};

export default function LibraryAiFirstScreen({ navigation }: { navigation?: Navigation }) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  return (
    <LibraryContent
      key={scope}
      scope={scope}
      activeScope={activeScope}
      schoolId={school.id}
      schoolName={school.name}
      navigation={navigation}
    />
  );
}

function LibraryContent({
  scope,
  activeScope,
  schoolId,
  schoolName,
  navigation,
}: {
  scope: string;
  activeScope: React.MutableRefObject<string>;
  schoolId: string;
  schoolName: string;
  navigation?: Navigation;
}) {
  const library = getOfficialLibrary(schoolId, schoolName);
  const verifiedSearch = hasVerifiedCatalogSearch(library);
  const queryMaxLength = getOfficialLibraryCatalogQueryMaxLength(library);
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isCurrent = () => mounted.current && activeScope.current === scope;

  const open = async (url: string) => {
    if (!isCurrent() || !library) return;
    setError('');
    try {
      await Linking.openURL(url);
    } catch {
      if (isCurrent()) setError('無法開啟圖書館網頁，請確認網路連線後重試。');
    }
  };

  const searchOfficialCatalog = async () => {
    if (!isCurrent() || !library || !keyword.trim()) return;
    if (library.catalogSearch === 'pu-webpac') {
      if (navigation?.navigate) {
        navigation.navigate('LibraryCatalog', { initialQuery: keyword.trim() });
      } else {
        const url = buildOfficialLibraryCatalogUrl(schoolId, keyword, 'FullText', schoolName);
        if (url) await open(url);
      }
      return;
    }
    if (verifiedSearch) {
      const url = buildOfficialLibraryCatalogUrl(schoolId, keyword, 'FullText', schoolName);
      if (url) await open(url);
      return;
    }
    try {
      await Clipboard.setStringAsync(keyword.trim());
      if (isCurrent()) setNotice('已複製關鍵字，請貼到圖書館網站的搜尋欄位。');
    } catch {
      if (isCurrent()) setNotice('請在學校圖書館網站自行輸入關鍵字。');
    }
    await open(library.catalogUrl);
  };

  return (
    <AIDetailScreen
      title="圖書館"
      subtitle="找書、查借閱紀錄，安排下一次到館。"
      onBack={() => navigation?.goBack?.()}
    >
      {!library ? (
        <AICard title="學校圖書館">
          <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
            目前尚未提供這所學校的圖書館入口。未核對到校方官方網站前，不會帶你到其他學校的館藏。
          </Text>
        </AICard>
      ) : (
        <>
          <AICard title={library.name}>
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                {library.catalogSearch === 'pu-webpac'
                  ? '依書名、作者或 ISBN 查詢學校館藏。'
                  : verifiedSearch
                    ? '輸入關鍵字即可直接開啟這所學校的官方館藏結果；是否可借請以館方系統為準。'
                    : '這個入口不會自動帶入關鍵字。開啟後請將關鍵字貼到館藏網站的搜尋欄位；是否可借請以館方系統為準。'}
              </Text>
              <TextInput
                accessibilityLabel="館藏關鍵字"
                placeholder="書名、作者或 ISBN"
                placeholderTextColor={aiTokens.muted}
                value={keyword}
                maxLength={queryMaxLength}
                onChangeText={(value) => { setKeyword(value); setNotice(''); }}
                style={{
                  color: aiTokens.text,
                  borderColor: aiTokens.border,
                  borderWidth: 1,
                  borderRadius: 12,
                  padding: 12,
                  minHeight: 48,
                }}
              />
              {library.catalogQueryMaxLength ? (
                <Text style={{ color: aiTokens.muted, lineHeight: 20 }}>
                  此校官方館藏關鍵字上限為 {library.catalogQueryMaxLength} 字。
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <AIButton
                  label={library.catalogSearch === 'pu-webpac'
                    ? '查詢館藏'
                    : verifiedSearch
                      ? '開啟官方館藏結果'
                      : '複製關鍵字並開啟館藏網站'}
                  style={{ maxWidth: '100%', flexDirection: 'column', alignItems: 'stretch' }}
                  disabled={!keyword.trim()}
                  onPress={() => void searchOfficialCatalog()}
                />
                {library.catalogSearch === 'pu-webpac' || !verifiedSearch ? (
                  <AIButton
                    label={library.catalogSearch === 'pu-webpac' ? '開啟官方館藏結果' : '開啟館藏網站'}
                    variant="ghost"
                    style={{ maxWidth: '100%', flexDirection: 'column', alignItems: 'stretch' }}
                    disabled={library.catalogSearch === 'pu-webpac' && !keyword.trim()}
                    onPress={() => {
                      const url = library.catalogSearch === 'pu-webpac'
                        ? buildOfficialLibraryCatalogUrl(schoolId, keyword, 'FullText', schoolName)
                        : library.catalogUrl;
                      if (url) void open(url);
                    }}
                  />
                ) : null}
              </View>
              {notice ? (
                <Text accessibilityRole="text" style={{ color: aiTokens.muted, lineHeight: 20 }}>
                  {notice}
                </Text>
              ) : null}
            </View>
          </AICard>
          <AICard title="我的借閱與續借">
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                前往這所學校圖書館的網站登入，查看到期日與可續借項目。續借是否成功以館方回覆為準。
              </Text>
              <AIButton
                label={library.accountUrl ? '開啟我的借閱紀錄' : '前往圖書館官網登入'}
                onPress={() => void open(library.accountUrl ?? library.websiteUrl)}
              />
            </View>
          </AICard>
          <AICard title="到館前先看看">
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted }}>
                開放時間與空間使用情況請以校方公告為準。
              </Text>
              <AIButton
                label="開館時間"
                variant="ghost"
                onPress={() => void open(library.hoursUrl ?? library.websiteUrl)}
              />
              {library.spacesUrl ? (
                <AIButton
                  label="空間與設備預約"
                  variant="ghost"
                  onPress={() => void open(library.spacesUrl!)}
                />
              ) : null}
              {library.electronicResourcesUrl ? (
                <AIButton
                  label="電子資源"
                  variant="ghost"
                  onPress={() => void open(library.electronicResourcesUrl!)}
                />
              ) : null}
              <AIButton
                label="圖書館官網"
                variant="ghost"
                onPress={() => void open(library.websiteUrl)}
              />
            </View>
          </AICard>
          {error ? (
            <AICard>
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                {error}
              </Text>
            </AICard>
          ) : null}
        </>
      )}
    </AIDetailScreen>
  );
}
