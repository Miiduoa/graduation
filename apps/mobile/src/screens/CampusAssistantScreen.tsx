import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import {
  askCampusAssistant,
  getOnDeviceAssistantReadiness,
  OnDeviceAssistantError,
  type CampusAssistantMessage,
  type CampusAssistantMode,
  type OnDeviceAssistantReadiness,
} from '../features/campusAssistant';
import type { ServiceScreenProps } from './UnavailableFeatureScreen';
import { safeNavigate } from '../utils/safeNavigate';
import { getMobileQuickActions } from '../services/quickCampusActions';

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
    Array<CampusAssistantMessage & { requiresService?: boolean; source?: CampusAssistantMode }>
  >([]);
  const [draft, setDraft] = useState(initialPrompt.slice(0, 1600));
  const [mode, setMode] = useState<CampusAssistantMode>('device');
  const [deviceStatus, setDeviceStatus] = useState<OnDeviceAssistantReadiness | null>(null);
  const [deviceCheck, setDeviceCheck] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const publicServices = resolveSchoolPublicServices(schoolId);
  const quickActions = getMobileQuickActions(draft);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && isScopeCurrent();
  useEffect(() => {
    let active = true;
    void getOnDeviceAssistantReadiness().then((state) => {
      if (active && current()) setDeviceStatus(state);
    }).catch(() => {
      if (active && current()) setDeviceStatus(null);
    });
    return () => { active = false; };
  }, [deviceCheck]);
  const changeMode = (next: CampusAssistantMode) => {
    if (lock.current || next === mode) return;
    setMode(next);
    setMessages([]);
    setError('');
  };
  const send = async () => {
    const question = draft.trim();
    if ((!uid && mode === 'campus') || !question || lock.current || !current()) return;
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
        mode,
      });
      if (current()) {
        setMessages([
          ...next,
          { role: 'assistant', content: reply.content, requiresService: reply.hasActions, source: reply.source },
        ]);
        setDraft('');
      }
    } catch (failure) {
      if (current()) {
        if (failure instanceof OnDeviceAssistantError) {
          if (failure.code === 'model-required') {
            setError('手機尚未下載 AI 模型，請先安裝免費模型。訊息已保留，不會自動改用雲端。');
          } else if (failure.code === 'native-unavailable') {
            setError('目前 App 沒有本地推論引擎。請使用包含 llama.rn 的 iOS／Android 原生版本，Expo Go 不支援。');
          } else if (failure.code === 'session-changed') {
            setError('帳號或學校已變更，這次回覆已捨棄。');
          } else {
            setError('手機模型無法產生回答，請到模型管理頁確認模型是否已啟用。');
          }
        } else {
          setError(mode === 'device'
            ? '手機 AI 暫時無法回覆。請檢查本地模型，內容沒有傳送到雲端。'
            : '校園即時查詢失敗，問題已保留。請確認登入與網路狀態。');
        }
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <AIDetailScreen title="校園助理" onBack={() => navigation?.goBack?.()}>
      <AICard title="選擇 AI 模式">
        <View style={{ gap: 9 }}>
          <AIButton
            label={mode === 'device' ? '✓ 手機本地 AI · 免費推論' : '手機本地 AI · 免費推論'}
            variant="ghost"
            disabled={busy}
            onPress={() => changeMode('device')}
          />
          <AIButton
            label={mode === 'campus' ? '✓ 校園即時 · 需網路' : '校園即時 · 需網路'}
            variant="ghost"
            disabled={busy}
            onPress={() => changeMode('campus')}
          />
          {mode === 'device' ? (
            <>
              <Text style={{ color: aiTokens.muted, lineHeight: 22, fontSize: 13 }}>
                {deviceStatus?.ready
                  ? `模型已下載：${deviceStatus.modelId}。問答會在手機內處理，不會自動傳送到付費 AI API。`
                  : deviceStatus?.reason || '正在檢查本機模型…'}
              </Text>
              <Text style={{ color: aiTokens.muted, lineHeight: 21, fontSize: 12 }}>
                首次安裝需要下載 GGUF 模型；之後可離線問答。本機課表只引用本人已保存的副本，不包含校方即時狀態。
              </Text>
              <AIButton
                label={deviceStatus?.ready ? '管理手機 AI 模型' : '下載／管理免費 AI 模型'}
                variant="ghost"
                disabled={busy}
                onPress={() => safeNavigate(navigation, 'AIModelManager')}
              />
              <AIButton
                label="重新檢查模型狀態"
                variant="ghost"
                disabled={busy}
                onPress={() => setDeviceCheck((value) => value + 1)}
              />
            </>
          ) : (
            <Text style={{ color: aiTokens.muted, lineHeight: 21, fontSize: 13 }}>
              查詢官方校園資料需要網路及帳號權限，可能使用雲端 AI 資源。此模式不是純手機免費推論，也不會自動提交任何交易。
            </Text>
          )}
        </View>
      </AICard>
      <AICard>
        <Text style={{ color: aiTokens.muted, lineHeight: 24 }}>
          {mode === 'device'
            ? `目前瀏覽：${schoolName}。手機 AI 能協助整理文字、規劃任務和建議服務入口；沒有連線時，不能取得即時學校資料或代替你完成申請。`
            : uid
              ? `目前選校：${schoolName}。雲端資料會驗證校籍權限，重要資訊以學校原始資料為準；不會自動送出申請或付款。`
              : `目前瀏覽：${schoolName}。校園即時查詢需先登入。也可以切換成手機本地 AI。`}
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
      {(uid || mode === 'device') && messages.length === 0 && !draft.trim() ? (
        <AICard title="一點就能開始">
          <View style={{ gap: 10 }}>
            <Text style={{ color: aiTokens.muted, lineHeight: 22 }}>
              不需要想完整的提問。點一個問題，確認文字後再送出。
            </Text>
            {[
              '幫我把期末報告拆成可以完成的步驟',
              '請依手機儲存的課表整理學習安排',
              '我要找校園圖書館，應該開啟哪個功能？',
            ].map((question) => (
              <AIButton
                key={question}
                label={question}
                variant="ghost"
                onPress={() => setDraft(question)}
              />
            ))}
          </View>
        </AICard>
      ) : null}
      {messages.map((message, index) => (
        <AICard key={index} title={message.role === 'user' ? '你的問題' : message.source === 'device' ? '手機本地 AI' : '校園即時助理'}>
          <Text selectable style={{ color: aiTokens.text, lineHeight: 25 }}>
            {message.content}
          </Text>
          {message.role === 'assistant' && message.source === 'device' && (
            <Text style={{ color: aiTokens.muted, fontSize: 12, marginTop: 10 }}>
              本機生成 · 未進行校園網路查詢，重要資訊請到正式服務確認
            </Text>
          )}
          {message.role === 'assistant' && index > 0 && (
            <View style={{ marginTop: 12, gap: 8 }}>
              {getMobileQuickActions(messages[index - 1]?.role === 'user' ? messages[index - 1].content : '')
                .slice(0, 3)
                .map((action) => (
                  <AIButton
                    key={action.destination}
                    label={'查看' + action.label}
                    variant="ghost"
                    disabled={busy}
                    onPress={() => safeNavigate(navigation, action.route)}
                  />
                ))}
            </View>
          )}
          {message.requiresService ? (
            <Text style={{ color: aiTokens.muted, lineHeight: 24, marginTop: 12 }}>
              尚未送出任何申請或交易。請到對應服務確認辦理。
            </Text>
          ) : null}
        </AICard>
      ))}
      {(uid || mode === 'device') ? (
        <AICard title={mode === 'device' ? '問手機 AI' : '查詢校園即時資料'}>
          <View style={{ gap: 12 }}>
            <Text style={{ color: aiTokens.muted, lineHeight: 21, fontSize: 13 }}>
              可以用手機鍵盤麥克風口述；辨識結果可先修改。手機 AI 只在本機運算，提交校園服務仍需自己確認。
            </Text>
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
              placeholder={mode === 'device' ? '例如：幫我安排三天的報告進度' : '例如：這週有哪些校園活動？'}
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
            {quickActions.length > 0 && typeof navigation?.navigate === 'function' ? (
              <View style={{ gap: 10, padding: 12, borderRadius: 12, backgroundColor: aiTokens.panel }}>
                <Text style={{ color: aiTokens.text, fontWeight: '700' }}>
                  也可以直接使用對應服務
                </Text>
                {quickActions.map((action) => (
                  <AIButton
                    key={action.destination}
                    label={'前往' + action.label}
                    variant="ghost"
                    disabled={busy}
                    onPress={() => {
                      if (!current()) return;
                      safeNavigate(navigation, action.route);
                    }}
                  />
                ))}
                <Text style={{ color: aiTokens.muted, fontSize: 12 }}>
                  只是開啟頁面，提交或付款仍要自行確認。
                </Text>
              </View>
            ) : null}
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
