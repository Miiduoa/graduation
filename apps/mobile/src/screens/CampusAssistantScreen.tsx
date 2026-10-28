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
import type { CampusAgentWriteProposal, CampusAgentWriteTool } from '../features/campusAssistantActions';
import { CampusAgentActionReview } from './CampusAgentActionReview';
import { CampusSenseDashboard } from './CampusSenseDashboard';
import { CampusSenseChangesCard } from './CampusSenseChangesCard';
import { CampusSenseSyncProgress } from './CampusSenseSyncProgress';
import { CampusEvidencePlanCard } from './CampusEvidencePlanCard';
import { CampusLocalReadResults } from './CampusLocalReadResults';
import type { LocalCampusReadResult } from '../services/localCampusToolProtocol';
import type { CampusEvidencePlan, CampusPlanRoute } from '../services/offlineCampusPlanner';
import {
  CAMPUS_SENSE_MAX_AGE_MS,
  refreshCampusSenseSnapshot,
  validCampusSenseSnapshot,
  type CampusSenseSnapshot,
  type CampusSenseProgress,
} from '../services/campusSenseSnapshot';

const SERVICE_AFTER_WRITE: Record<CampusAgentWriteTool, string> = {
  submitLeaveRequest: 'CoursesHome',
  createDormRepairRequest: 'Dormitory',
  reserveSeat: 'Library',
  borrowBook: 'Library',
  renewBook: 'Library',
  returnBook: 'Library',
  reserveWashingMachine: 'Dormitory',
};

const VERIFIED_SERVICE_ROUTES: Record<string, { route: string; label: string }> = {
  '/map': { route: 'MapV2', label: '校園地圖' },
  '/timetable': { route: 'PersonalTimetable', label: '我的課表' },
  '/announcements': { route: '公告總覽', label: '校園公告' },
  '/events': { route: '活動總覽', label: '校園活動' },
  '/classroom': { route: 'CoursesHome', label: '課程與作業' },
  '/grades': { route: 'Grades', label: '成績' },
  '/bus': { route: 'BusV2', label: '公車' },
  '/cafeteria': { route: '餐廳總覽', label: '校園餐廳' },
  '/dormitory': { route: 'Dormitory', label: '宿舍服務' },
  '/library': { route: 'Library', label: '圖書館' },
  '/dms': { route: 'Dms', label: '私訊' },
};

function isTransientCampusSyncError(error: unknown): boolean {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; message?: unknown } : {};
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
  if (/permission-denied|unauthenticated|failed-precondition|invalid-argument|session-changed/.test(code + ' ' + message)) {
    return false;
  }
  // Only a clearly transient failure may reuse a still-valid in-memory snapshot.
  return /network|offline|unavailable|deadline-exceeded|timeout|timed out|connection/.test(code + ' ' + message);
}

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
    Array<CampusAssistantMessage & {
      requiresService?: boolean;
      source?: CampusAssistantMode;
      tool?: 'saved-timetable' | 'campus-snapshot' | 'campus-plan' | 'online-required' | 'open-service' | 'local-agent';
      plan?: CampusEvidencePlan;
      localReads?: LocalCampusReadResult[];
      route?: string;
      proposals?: CampusAgentWriteProposal[];
    }>
  >([]);
  const [draft, setDraft] = useState(initialPrompt.slice(0, 1600));
  const [mode, setMode] = useState<CampusAssistantMode>('device');
  const [deviceStatus, setDeviceStatus] = useState<OnDeviceAssistantReadiness | null>(null);
  const [sense, setSense] = useState<CampusSenseSnapshot | null>(null);
  const [, refreshSenseAge] = useState(0);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState<CampusSenseProgress | null>(null);
  const [senseError, setSenseError] = useState('');
  const syncLock = useRef(false);
  const [deviceCheck, setDeviceCheck] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  const publicServices = resolveSchoolPublicServices(schoolId);
  const quickActions = getMobileQuickActions(draft);
  const currentSense = validCampusSenseSnapshot(sense, { uid, schoolId });
  useEffect(() => {
    if (!sense) return;
    const syncedAt = Date.parse(sense.checkedAt);
    if (!Number.isFinite(syncedAt)) return;
    const remaining = Math.max(0, syncedAt + CAMPUS_SENSE_MAX_AGE_MS - Date.now());
    const expiry = setTimeout(() => refreshSenseAge((value) => value + 1), remaining + 50);
    return () => clearTimeout(expiry);
  }, [sense?.checkedAt]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
      inFlight.current = null;
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
    if (lock.current || syncLock.current || next === mode) return;
    setMode(next);
    setMessages([]);
    setError('');
  };
  const progressFor = (controller: AbortController) => (progress: CampusSenseProgress) => {
    if (current() && !controller.signal.aborted && inFlight.current === controller) {
      setSyncProgress(progress);
    }
  };
  const stopSync = () => {
    inFlight.current?.abort();
    setSenseError('已停止同步，不會套用未完成的結果或讀取下一頁；已送出的唯讀請求可能仍在完成。');
  };
  const syncCampus = async () => {
    if (!uid || lock.current || syncLock.current || !current()) return;
    lock.current = true;
    syncLock.current = true;
    setSyncBusy(true);
    setSyncProgress(null);
    setSenseError('');
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const snapshot = await refreshCampusSenseSnapshot({
        scope: { uid, schoolId },
        isCurrent: current,
        signal: controller.signal,
        onProgress: progressFor(controller),
      });
      if (current() && !controller.signal.aborted) setSense(snapshot);
    } catch {
      if (current()) {
        if (controller.signal.aborted) {
          setSenseError('已停止同步；先前摘要仍以原同步時間為準，沒有套用未完成的結果。');
        } else {
          setSense(null);
          setSenseError('資料同步失敗或逾時。請確認帳號、學校權限與網路，再試一次；沒有使用舊資料冒充最新結果。');
        }
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        lock.current = false;
        syncLock.current = false;
        if (current()) {
          setSyncBusy(false);
          setSyncProgress(null);
        }
      }
    }
  };
  const briefPlan = async (question: string) => {
    if (!uid || lock.current || syncLock.current || !current()) return;
    lock.current = true;
    syncLock.current = true;
    setBusy(true);
    setSyncBusy(true);
    setSyncProgress(null);
    setError('');
    setSenseError('');
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      let snapshot: CampusSenseSnapshot | null = null;
      try {
        snapshot = await refreshCampusSenseSnapshot({
          scope: { uid, schoolId },
          isCurrent: current,
          signal: controller.signal,
          onProgress: progressFor(controller),
        });
        if (!current() || controller.signal.aborted) return;
        setSense(snapshot);
      } catch (syncError) {
        if (!current()) return;
        if (controller.signal.aborted) {
          setSenseError('已停止同步與這次整理；沒有套用未完成的資料，也沒有改用雲端 AI。');
          return;
        }
        // A permission or contract failure revokes reliance on any prior summary.
        const transient = isTransientCampusSyncError(syncError);
        snapshot = transient ? validCampusSenseSnapshot(sense, { uid, schoolId }) : null;
        if (!snapshot) setSense(null);
        setSenseError(snapshot
          ? '校園連線失敗，改用先前已授權且未過期的摘要；這不是即時學校狀態。'
          : transient
            ? '校園連線失敗，改用手機已保存的個人課表；作業與公告沒有即時查證。'
            : '校園權限或資料無法驗證，已捨棄校園摘要；僅能使用手機內已保存的個人課表。');
      }
      if (!current() || controller.signal.aborted) return;
      setSyncBusy(false);
      setSyncProgress(null);
      const next: CampusAssistantMessage[] = [
        ...messages, { role: 'user', content: question },
      ];
      // Reuse the phone's deterministic read-only tools before asking its GGUF.
      const reply = await askCampusAssistant({
        scope: { uid, schoolId },
        schoolName,
        senseSnapshot: snapshot,
        messages: next,
        mode: 'device',
        isCurrent: current,
        signal: controller.signal,
      });
      if (controller.signal.aborted && current()) {
        setError('已停止這次本地整理，沒有將取消後的回答加入對話。');
        return;
      }
      if (current()) {
        setMessages([
          ...next,
          {
            role: 'assistant',
            content: reply.content,
            requiresService: reply.hasActions,
            source: reply.source,
            tool: reply.tool,
            route: reply.route,
            plan: reply.plan,
            localReads: reply.localReads,
          },
        ]);
        setDraft('');
      }
    } catch {
      if (current()) {
        if (controller.signal.aborted) {
          setError('已停止這次本地整理；資料不會自動傳送到雲端 AI。');
        } else {
          setError('本機無法完成這次整理。請檢查已儲存課表或免費手機模型；沒有自動將問題傳給雲端 AI。');
        }
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        lock.current = false;
        syncLock.current = false;
        if (current()) {
          setBusy(false);
          setSyncBusy(false);
          setSyncProgress(null);
        }
      }
    }
  };

  const send = async () => {
    const question = draft.trim();
    if ((!uid && mode === 'campus') || !question || lock.current || syncLock.current || !current()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    inFlight.current = controller;
    const next: CampusAssistantMessage[] = [...messages, { role: 'user', content: question }];
    try {
      const reply = await askCampusAssistant({
        scope: { uid, schoolId },
        schoolName,
        senseSnapshot: currentSense,
        messages: next,
        isCurrent: current,
        mode,
        ...(mode === 'device' ? { signal: controller.signal } : {}),
      });
      if (controller.signal.aborted && current()) {
        setError('已停止本機回答，問題仍保留在輸入欄，可修改後重試。');
        return;
      }
      if (current()) {
        setMessages([
          ...next,
          {
            role: 'assistant',
            content: reply.content,
            requiresService: reply.hasActions,
            source: reply.source,
            tool: reply.tool,
            route: reply.route,
            plan: reply.plan,
            localReads: reply.localReads,
            proposals: reply.proposals,
          },
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
          } else if (failure.code === 'model-busy') {
            setError('手機 AI 正在執行其他任務或安裝模型；這次問題已保留，請稍後再送出。');
          } else if (failure.code === 'cancelled') {
            setError('已停止本機回答，問題仍保留在輸入欄，可修改後重試。');
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
      if (inFlight.current === controller) inFlight.current = null;
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <AIDetailScreen title="校園助理" onBack={() => {
      inFlight.current?.abort();
      navigation?.goBack?.();
    }}>
      <AICard
        title="工作模式"
        badge={mode === 'device' ? '手機內推論' : '校園連線'}
        badgeTone={mode === 'device' ? 'success' : 'ai'}
      >
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <AIButton
              label={mode === 'device' ? '✓ 手機本地 AI · 免費推論' : '手機本地 AI · 免費推論'}
              variant={mode === 'device' ? 'primary' : 'ghost'}
              size="sm"
              style={{ flex: 1 }}
              disabled={busy || syncBusy}
              onPress={() => changeMode('device')}
            />
            <AIButton
              label={mode === 'campus' ? '✓ 校園即時 · 需網路' : '校園即時 · 需網路'}
              variant={mode === 'campus' ? 'primary' : 'ghost'}
              size="sm"
              style={{ flex: 1 }}
              disabled={busy || syncBusy}
              onPress={() => changeMode('campus')}
            />
          </View>
          {mode === 'device' ? (
            <>
              <Text style={{ color: aiTokens.muted, lineHeight: 22, fontSize: 13 }}>
                {deviceStatus?.ready
                  ? `模型已下載：${deviceStatus.modelId}。問答會在手機內處理，不會自動傳送到付費 AI API。`
                  : deviceStatus?.reason || '正在檢查本機模型…'}
              </Text>
              <Text style={{ color: aiTokens.muted, lineHeight: 21, fontSize: 12 }}>
                本機課表查詢與服務導覽不需下載模型；自由問答才需要免費 GGUF 模型。本機課表只引用已保存副本，不包含校方即時狀態。
              </Text>
              <AIButton
                label={deviceStatus?.ready ? '管理手機 AI 模型' : '下載／管理免費 AI 模型'}
                variant="ghost"
                disabled={busy || syncBusy}
                onPress={() => safeNavigate(navigation, 'AIModelManager')}
              />
              <AIButton
                label="重新檢查模型狀態"
                variant="ghost"
                disabled={busy || syncBusy}
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
      {mode === 'device' ? (
        <>
          <CampusSenseDashboard
            snapshot={currentSense}
            expired={Boolean(sense)}
            authenticated={Boolean(uid)}
            busy={busy}
            syncBusy={syncBusy}
            error={senseError}
            onSync={() => void syncCampus()}
            onBrief={() => void briefPlan('今天要先處理什麼？')}
            onWeekBrief={() => void briefPlan('依手機課表與授權作業安排接下來七天的學習計畫')}
            onClear={() => { setSense(null); setSenseError(''); }}
          />
          {syncBusy ? <CampusSenseSyncProgress progress={syncProgress} onCancel={stopSync} /> : null}
          <CampusSenseChangesCard snapshot={currentSense} userId={uid} schoolId={schoolId}
            disabled={busy || syncBusy} isCurrent={current} navigation={navigation} />
        </>
      ) : null}
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
              ...(currentSense ? ['今天要先處理什麼？', '我還有哪些作業待交？'] : []),
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
        <AICard key={index} title={message.role === 'user' ? '你的問題' : message.localReads?.length ? '手機工具查詢' : message.plan ? '校園行動計畫' : message.tool ? '手機離線工具' : message.source === 'device' ? '手機本地 AI' : '校園即時助理'}>
          {message.role === 'assistant' && message.localReads?.length ? (
            <CampusLocalReadResults
              results={message.localReads}
              disabled={busy || syncBusy}
              onOpenRoute={(route) => {
                if (!current()) return;
                const destination = VERIFIED_SERVICE_ROUTES[route];
                if (destination) safeNavigate(navigation, destination.route);
              }}
            />
          ) : (
            <Text selectable style={{ color: aiTokens.text, lineHeight: 25 }}>
              {message.plan ? message.plan.overview : message.content}
            </Text>
          )}
          {message.role === 'assistant' && message.plan ? (
            <CampusEvidencePlanCard
              plan={message.plan}
              disabled={busy || syncBusy}
              navigation={navigation}
              reminderContext={{
                userId: uid,
                schoolId,
                snapshot: currentSense,
                isCurrent: current,
              }}
              onOpenRoute={(route: CampusPlanRoute) => {
                if (!current()) return;
                const destination = VERIFIED_SERVICE_ROUTES[route];
                if (destination) safeNavigate(navigation, destination.route);
              }}
            />
          ) : null}
          {message.role === 'assistant' && message.source === 'campus' &&
            index === messages.length - 1 && message.proposals?.map((proposal, proposalIndex) => (
              <CampusAgentActionReview
                key={proposal.agentRunId + ':' + proposal.toolName + ':' + proposalIndex}
                proposal={proposal}
                userId={uid}
                schoolId={schoolId}
                isCurrent={current}
                onOpenService={typeof navigation?.navigate === 'function'
                  ? () => safeNavigate(navigation, SERVICE_AFTER_WRITE[proposal.toolName])
                  : undefined}
              />
            ))}
          {message.role === 'assistant' && message.source === 'device' && (
            <Text style={{ color: aiTokens.muted, fontSize: 12, marginTop: 10 }}>
              {message.tool === 'local-agent'
                ? '手機模型理解需求 · 本機工具核對資料 · 僅執行唯讀查詢'
                : message.tool === 'campus-plan'
                ? '手機端多步驟規劃 · 資料來源與期限已標示 · 未執行任何寫入'
                : message.tool === 'campus-snapshot'
                ? '手機規則計算 · 先前主動同步的授權摘要（非即時結果）'
                : message.tool
                  ? '本機規則／已保存資料 · 未進行雲端推論或即時校園查詢'
                  : '手機模型生成 · 未進行校園網路查詢，重要資訊請到正式服務確認'}
            </Text>
          )}
          {message.role === 'assistant' && !message.plan && !message.localReads?.length && message.route && VERIFIED_SERVICE_ROUTES[message.route] ? (
            <View style={{ marginTop: 12 }}>
              <AIButton
                label={'開啟' + VERIFIED_SERVICE_ROUTES[message.route].label}
                variant="ghost"
                disabled={busy || syncBusy}
                onPress={() => {
                  const destination = message.route && VERIFIED_SERVICE_ROUTES[message.route];
                  if (destination) safeNavigate(navigation, destination.route);
                }}
              />
            </View>
          ) : message.role === 'assistant' && !message.plan && !message.localReads?.length && index > 0 ? (
            <View style={{ marginTop: 12, gap: 8 }}>
              {getMobileQuickActions(messages[index - 1]?.role === 'user' ? messages[index - 1].content : '')
                .slice(0, 3)
                .map((action) => (
                  <AIButton
                    key={action.destination}
                    label={'查看' + action.label}
                    variant="ghost"
                    disabled={busy || syncBusy}
                    onPress={() => safeNavigate(navigation, action.route)}
                  />
                ))}
            </View>
          ) : null}
          {message.requiresService && !message.proposals?.length ? (
            <Text style={{ color: aiTokens.muted, lineHeight: 24, marginTop: 12 }}>
              尚未送出任何申請或交易。請到對應服務確認辦理。
            </Text>
          ) : message.proposals?.length && index < messages.length - 1 ? (
            <Text style={{ color: aiTokens.muted, lineHeight: 22, marginTop: 12 }}>
              這是先前的任務建議。若要確認執行狀態，請到對應服務頁面核對。
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
              editable={!busy && !syncBusy}
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
                    disabled={busy || syncBusy}
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
              disabled={busy || syncBusy || !draft.trim()}
              onPress={() => void send()}
            />
            {busy && mode === 'device' ? (
              <AIButton
                label="停止本機回答"
                variant="ghost"
                onPress={() => inFlight.current?.abort()}
              />
            ) : null}
          </View>
        </AICard>
      ) : null}
    </AIDetailScreen>
  );
}
