import React, { useRef, useState, useSyncExternalStore, useEffect } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { getSchoolLibrary } from '@campus/shared/src/libraryDirectory';
import { buildLibrarySearchUrl } from '../services/libraryOpacClient';

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
  schoolName?: string;
  navigation?: Navigation;
}) {
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const library = getSchoolLibrary(schoolId, schoolName);
  const hasNativeSearch = library?.searchMode === 'pu-webpac';

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

  return (
    <AIDetailScreen
      title="圖書館"
      subtitle="查看目前學校的館藏、借閱與開館資訊。"
      onBack={() => navigation?.goBack?.()}
    >
      {!library ? (
        <AICard title="學校圖書館">
          <Text style={{ color: aiTokens.muted }}>
            目前尚未提供這所學校核對完成的圖書館入口。請從學校官網查詢，這裡不會顯示別校的館藏或借閱紀錄。
          </Text>
        </AICard>
      ) : (
        <>
          <AICard title={hasNativeSearch ? '找一本書' : '官方館藏查詢'}>
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted }}>
                {hasNativeSearch
                  ? '依書名、作者或 ISBN 查詢學校館藏。'
                  : library.name + '：請在官方館藏系統搜尋書名、作者或 ISBN。'}
              </Text>
              {hasNativeSearch ? (
                <>
                  <TextInput
                    accessibilityLabel="館藏關鍵字"
                    placeholder="書名、作者或 ISBN"
                    placeholderTextColor={aiTokens.muted}
                    value={keyword}
                    maxLength={200}
                    onChangeText={setKeyword}
                    style={{
                      color: aiTokens.text,
                      borderColor: aiTokens.border,
                      borderWidth: 1,
                      borderRadius: 12,
                      padding: 12,
                      minHeight: 48,
                    }}
                  />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    <AIButton
                      label="查詢館藏"
                      disabled={!keyword.trim()}
                      onPress={() => {
                        if (!isCurrent()) return;
                        if (navigation?.navigate)
                          navigation.navigate('LibraryCatalog', { initialQuery: keyword.trim() });
                        else void open(buildLibrarySearchUrl(keyword));
                      }}
                    />
                    <AIButton
                      label="在圖書館網站搜尋"
                      variant="ghost"
                      disabled={!keyword.trim()}
                      onPress={() => void open(buildLibrarySearchUrl(keyword))}
                    />
                  </View>
                </>
              ) : (
                <AIButton
                  label={library.catalog ? '開啟官方館藏目錄' : '開啟圖書館查詢網站'}
                  onPress={() => void open(library.catalog || library.homepage)}
                />
              )}
            </View>
          </AICard>
          <AICard title="我的借閱與續借">
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                前往這所學校的圖書館網站登入自己的帳號，查看到期日與可續借項目。實際借閱和預約狀態以館方回覆為準。
              </Text>
              <AIButton
                label={library.personal ? '開啟我的借閱紀錄' : '開啟官方讀者服務入口'}
                onPress={() => void open(library.personal || library.homepage)}
              />
            </View>
          </AICard>
          <AICard title="到館前先看看">
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted }}>
                開放時間與空間使用情況請以館方公告為準。
              </Text>
              <AIButton
                label="圖書館官方網站"
                variant="ghost"
                onPress={() => void open(library.homepage)}
              />
              {library.hours ? (
                <AIButton
                  label="開館時間"
                  variant="ghost"
                  onPress={() => void open(library.hours!)}
                />
              ) : null}
              {library.reservation ? (
                <AIButton
                  label="空間與設備預約"
                  variant="ghost"
                  onPress={() => void open(library.reservation!)}
                />
              ) : null}
              {library.electronic ? (
                <AIButton
                  label="電子資源"
                  variant="ghost"
                  onPress={() => void open(library.electronic!)}
                />
              ) : null}
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
