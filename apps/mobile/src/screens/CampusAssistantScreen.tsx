import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { askCampusAssistant, type CampusAssistantMessage } from '../features/campusAssistant';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';

export function CampusAssistantScreen({ navigation, route }: ServiceScreenProps) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { user } = useAuth();
  const { school } = useSchool();
  const scope = JSON.stringify([user?.uid, school.id]);
  const active = useRef(scope);
  active.current = scope;
  const initialScope = useRef(scope);
  const prompt = typeof route?.params?.prompt === 'string' ? route.params.prompt : '';
  return (
    <AssistantConversation
      key={scope}
      uid={user?.uid ?? ''}
      schoolId={school.id}
      schoolName={school.name}
      initialPrompt={initialScope.current === scope ? prompt : ''}
      isScopeCurrent={() => active.current === scope}
      navigation={navigation}
    />
  );
}
function AssistantConversation({
  uid,
  schoolId,
  schoolName,
  initialPrompt,
  isScopeCurrent,
  navigation,
}: {
  uid: string;
  schoolId: string;
  schoolName: string;
  initialPrompt: string;
  isScopeCurrent: () => boolean;
  navigation: ServiceScreenProps['navigation'];
}) {
  const [messages, setMessages] = useState<
    Array<CampusAssistantMessage & { requiresService?: boolean }>
  >([]);
  const [draft, setDraft] = useState(initialPrompt.slice(0, 1600));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const publicServices = resolveSchoolPublicServices(schoolId);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && isScopeCurrent();
  const send = async () => {
    const question = draft.trim();
    if (!uid || !question || lock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const next: CampusAssistantMessage[] = [...messages, { role: 'user', content: question }];
    try {
      const reply = await askCampusAssistant({
        scope: { uid, schoolId },
        schoolName,
        messages: next,
        isCurrent: current,
      });
      if (current()) {
        setMessages([
          ...next,
          { role: 'assistant', content: reply.content, requiresService: reply.hasActions },
        ]);
        setDraft('');
      }
    } catch {
      if (current()) setError('目前無法取得回覆，問題已保留。請確認登入狀態與網路後重試。');
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <AIDetailScreen title="校園助理" onBack={() => navigation?.goBack?.()}>
      <AICard>
        <Text style={{ color: aiTokens.muted, lineHeight: 24 }}>
          {uid
            ? `目前選校：${schoolName}。可以詢問該校課程、公告與校園資訊；回覆不會套用其他學校資料。需要提交申請或付款時，請前往對應服務確認辦理。`
            : `目前選校：${schoolName}。請先登入，再詢問這所學校的課程、公告與校園資訊。`}
        </Text>
        {publicServices?.services.courses ? (
          <View style={{ marginTop: 12, gap: 8 }}>
            <AIButton
              label={`開啟${publicServices.services.courses.label}`}
              variant="ghost"
              onPress={() => {
                void Linking.openURL(publicServices.services.courses.url).catch(() => {
                  if (current()) setLinkError('無法開啟校方課程查詢頁，請稍後再試。');
                });
              }}
            />
            {linkError ? (
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                {linkError}
              </Text>
            ) : null}
          </View>
        ) : null}
      </AICard>
      {messages.map((message, index) => (
        <AICard key={index} title={message.role === 'user' ? '你的問題' : '校園助理'}>
          <Text selectable style={{ color: aiTokens.text, lineHeight: 25 }}>
            {message.content}
          </Text>
          {message.requiresService ? (
            <Text style={{ color: aiTokens.muted, lineHeight: 24, marginTop: 12 }}>
              尚未送出任何申請或交易。請到對應服務確認辦理。
            </Text>
          ) : null}
        </AICard>
      ))}
      {uid ? (
        <AICard title="想查詢什麼？">
          <View style={{ gap: 12 }}>
            <TextInput
              accessibilityLabel="詢問校園助理"
              value={draft}
              maxLength={1600}
              multiline
              editable={!busy}
              onChangeText={(value) => {
                if (!lock.current) {
                  setDraft(value);
                  setError('');
                }
              }}
              placeholder="例如：這週有哪些校園活動？"
              placeholderTextColor={aiTokens.muted}
              style={{
                color: aiTokens.text,
                borderColor: aiTokens.border,
                borderWidth: 1,
                borderRadius: 12,
                minHeight: 96,
                padding: 12,
                textAlignVertical: 'top',
              }}
            />
            {error ? (
              <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>
                {error}
              </Text>
            ) : null}
            <AIButton
              label={busy ? '正在查詢…' : error ? '重試查詢' : '送出問題'}
              disabled={busy || !draft.trim()}
              onPress={() => void send()}
            />
          </View>
        </AICard>
      ) : null}
    </AIDetailScreen>
  );
}
