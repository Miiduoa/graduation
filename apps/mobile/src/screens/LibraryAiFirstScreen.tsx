import React, { useRef, useState, useSyncExternalStore, useEffect } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { buildLibrarySearchUrl, getLibraryOpacBaseUrl } from '../services/libraryOpacClient';

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
      navigation={navigation}
    />
  );
}
function LibraryContent({
  scope,
  activeScope,
  schoolId,
  navigation,
}: {
  scope: string;
  activeScope: React.MutableRefObject<string>;
  schoolId: string;
  navigation?: Navigation;
}) {
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = () => mounted.current && activeScope.current === scope;
  const open = async (url: string) => {
    if (!isCurrent() || schoolId !== 'pu') return;
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
      subtitle="找書、查借閱紀錄，安排下一次到館。"
      onBack={() => navigation?.goBack?.()}
    >
      {schoolId !== 'pu' ? (
        <AICard title="學校圖書館">
          <Text style={{ color: aiTokens.muted }}>
            目前尚未提供這所學校的圖書館入口，請從學校官網查詢。
          </Text>
        </AICard>
      ) : (
        <>
          <AICard title="找一本書">
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted }}>依書名、作者或 ISBN 查詢學校館藏。</Text>
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
            </View>
          </AICard>
          <AICard title="我的借閱與續借">
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
                前往圖書館網站登入自己的帳號，查看到期日與可續借項目。是否續借或預約成功，以館方回覆為準。
              </Text>
              <AIButton
                label="開啟我的借閱紀錄"
                onPress={() => void open(`${getLibraryOpacBaseUrl()}personal/`)}
              />
            </View>
          </AICard>
          <AICard title="到館前先看看">
            <View style={{ gap: 12 }}>
              <Text style={{ color: aiTokens.muted }}>
                開放時間與空間使用情況請以館方公告為準。
              </Text>
              <AIButton
                label="開館時間"
                variant="ghost"
                onPress={() => void open('https://library.pu.edu.tw/p/426-1054-32.php?Lang=zh-tw')}
              />
              <AIButton
                label="空間與設備預約"
                variant="ghost"
                onPress={() => void open('https://library.pu.edu.tw/p/426-1054-14.php?Lang=zh-tw')}
              />
              <AIButton
                label="電子資源"
                variant="ghost"
                onPress={() => void open('https://jumper.lib.pu.edu.tw/')}
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
