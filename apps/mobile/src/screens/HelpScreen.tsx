import React, { useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { AIDetailScreen, AICard, AISection, AIRow, AIButton } from '../ui/aiFirst';
import { useTheme } from '../state/theme';
import { getLegalUrl } from '../services/release';
import { isTronClassPuHostedUrl } from '../services/tronClassDataEnabled';
import { linkingOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';

type Props = { navigation?: { goBack?: () => void; navigate?: (screen: string) => void } };
const questions = [
  {
    id: 'login',
    question: '忘記學校帳號密碼怎麼辦？',
    answer: '學校帳號的密碼由校方管理。請使用學校帳號服務重設密碼，或聯絡校方帳號服務窗口。',
  },
  {
    id: 'profile',
    question: '如何修改個人資料？',
    answer:
      '前往「我的」→「個人資料」，可以修改顯示名稱、簡介與電話。學號與系所由帳號資料提供，無法在這裡修改。',
  },
  {
    id: 'notifications',
    question: '如何設定通知？',
    answer:
      '前往「我的」→「通知設定」，調整通知類型與免打擾時段。推播需要在每台裝置分別授權，頁面會顯示註冊結果與設定是否已儲存。',
  },
  {
    id: 'assistant',
    question: '校園助理可以做什麼？',
    answer:
      '登入後可以詢問課程、公告與校園資訊。需要提交申請或付款時，請到對應服務確認辦理。重要的課務資訊，請再向校方確認。',
  },
  {
    id: 'appearance',
    question: '如何切換深色模式？',
    answer: '前往「我的」→「外觀」，選擇淺色或深色。選擇後立即套用，並保留在這台裝置。',
  },
  {
    id: 'data',
    question: '如何匯出資料或刪除帳號？',
    answer:
      '「我的」頁面提供「匯出我的資料」和「刪除帳號」。刪除前請先閱讀資料範圍與確認步驟；需要保留的資料，請先完成匯出。',
  },
];

export function HelpScreen({ navigation }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const keyword = query.trim().toLocaleLowerCase();
  const results = questions.filter((item) =>
    `${item.question} ${item.answer}`.toLocaleLowerCase().includes(keyword),
  );
  const version = Constants.expoConfig?.version;
  const openLegalDocument = async (type: 'privacy' | 'terms') => {
    const url = getLegalUrl(type);
    if (!url) return;
    try {
      const opened = await linkingOpenWithPuTronClassGate(url);
      if (!opened && !isTronClassPuHostedUrl(url))
        Alert.alert('無法開啟網頁', '請確認網路連線後重試。');
    } catch {
      Alert.alert('無法開啟網頁', '請確認網路連線後重試。');
    }
  };
  return (
    <AIDetailScreen title="幫助與回饋" onBack={() => navigation?.goBack?.()}>
      <AICard title="尋找使用說明">
        <TextInput
          accessibilityLabel="搜尋常見問題"
          placeholder="輸入關鍵字，例如通知、帳號"
          placeholderTextColor={theme.colors.muted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          style={{
            ...theme.typography.body,
            minHeight: 48,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderWidth: 1,
            borderRadius: theme.radius.md,
            padding: theme.space.sm,
          }}
        />
      </AICard>
      <AICard title="常見問題">
        <View style={{ gap: theme.space.sm }}>
          {results.length === 0 ? (
            <View style={{ gap: theme.space.sm }}>
              <Text style={{ ...theme.typography.body, color: theme.colors.text }}>
                找不到相關說明
              </Text>
              <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
                換個關鍵字試試，或透過下方的意見回饋告訴我們。
              </Text>
              <AIButton label="清除搜尋" variant="ghost" onPress={() => setQuery('')} />
            </View>
          ) : (
            results.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.question}
                accessibilityState={{ expanded: expanded === item.id }}
                aria-expanded={expanded === item.id}
                onPress={() => setExpanded(expanded === item.id ? null : item.id)}
                style={({ pressed }) => ({
                  minHeight: 48,
                  padding: theme.layout.cardPadding,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: expanded === item.id ? theme.colors.accent : theme.colors.border,
                  backgroundColor:
                    pressed || expanded === item.id
                      ? theme.colors.accentSoft
                      : theme.colors.surface,
                  gap: theme.space.sm,
                })}
              >
                <View style={{ flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' }}>
                  <Text
                    style={{
                      ...theme.typography.body,
                      color: theme.colors.text,
                      fontWeight: '600',
                      flex: 1,
                    }}
                  >
                    {item.question}
                  </Text>
                  <Ionicons
                    name={expanded === item.id ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={theme.colors.muted}
                  />
                </View>
                {expanded === item.id ? (
                  <Text
                    style={{ ...theme.typography.bodySmall, color: theme.colors.textSecondary }}
                  >
                    {item.answer}
                  </Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>
      </AICard>
      <AICard title="需要協助？">
        <View style={{ gap: theme.space.md }}>
          <Text style={{ ...theme.typography.bodySmall, color: theme.colors.muted }}>
            遇到操作問題或有改善建議，可以留下回饋。登入後即可送出，收到後會提供回饋編號。
          </Text>
          <AIButton label="前往意見回饋" onPress={() => navigation?.navigate?.('Feedback')} />
        </View>
      </AICard>
      <AISection title="關於 Campus One">
        {version ? <AIRow title="版本" subtitle={version} static /> : null}
        {(['privacy', 'terms'] as const).map((type) => (
          <AIRow
            key={type}
            title={type === 'privacy' ? '隱私政策' : '服務條款'}
            subtitle={getLegalUrl(type) ? undefined : '目前無法提供連結'}
            disabled={!getLegalUrl(type)}
            onPress={() => void openLegalDocument(type)}
          />
        ))}
      </AISection>
    </AIDetailScreen>
  );
}
