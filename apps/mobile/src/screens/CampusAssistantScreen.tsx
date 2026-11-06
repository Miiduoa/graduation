import { AssignmentReplyActions } from './AssignmentReplyActions';
import { LegacyAssignmentReminders } from './LegacyAssignmentReminders';
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { AssistantConversationLayout, type AssistantPanel } from './AssistantConversationLayout';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { NuniCourseworkReply, courseworkReplyTitle } from './NuniCourseworkReply';
import { classCourseworkQuestion, type CourseworkChoice, type CourseworkRequests } from '../features/nuniCourseworkFollowUp';
import { SavedClassReplyCard, savedClassReplyTitle } from './SavedClassReplyCard';
import { resumeOpenedCoursework } from '../features/nuniCourseworkSnapshot';
import { subscribeNuniAssignmentChanges } from '../services/nuniAssignmentChanges';
import type { PlatformTimetableAccess } from '../services/assistantTimetableSource';
import { AssistantClassNowHint } from './AssistantClassNowHint';
import { useAssistantSessionExpiry } from '../state/useAssistantSessionExpiry';
import { useOptionalNuniSession } from '../state/nuniSession';
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
import { CampusAnnouncementRows } from './CampusAnnouncementRows';
import { CampusSenseDashboard } from './CampusSenseDashboard';
import { CampusEvidencePlanCard } from './CampusEvidencePlanCard';
import { CampusPlanComparisonCard } from './CampusPlanComparisonCard';
import { SavedCampusPlansPanel } from './SavedCampusPlansPanel';
import { useSavedCampusPlans } from '../state/useSavedCampusPlans';
import { createSavedCampusPlanSession, subscribeSavedCampusPlanInvalidation } from '../services/savedCampusPlans';
import { CampusLocalReadResults } from './CampusLocalReadResults';
import type { LocalCampusReadResult } from '../services/localCampusToolProtocol';
import type { CampusEvidencePlan, CampusPlanRoute } from '../services/offlineCampusPlanner';
import { compareCampusPlans, type CampusPlanComparison } from '../services/campusPlanComparison';
import {
  CAMPUS_SENSE_MAX_AGE_MS,
  refreshCampusSenseSnapshot,
  validCampusSenseSnapshot,
  type CampusSenseSnapshot,
  type CampusSenseProgress,
} from '../services/campusSenseSnapshot';

const CURRENT_CLASS = '我現在有課嗎？';
const NEXT_CLASS = '下一堂課是什麼？';
const CLASS_ROOM = '在哪間教室？';
const CLASS_END = '幾點下課？';
const CLASS_WORK = '這堂課有什麼作業？';
const TODAY_ANNOUNCEMENTS = '今天發布了哪些校園公告？';
const TODAY_BRIEF = '今天要先處理什麼？';
const WEEK_BRIEF = '依手機課表與授權作業安排接下來七天的學習計畫';

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
  const { user, loading } = useAuth();
  const platform = useOptionalNuniSession();
  const platformRoute = route?.name === 'NuniTimetableAssistant';
  useAssistantSessionExpiry(platformRoute ? platform : null);
  const uid = loading || platform?.loading || platform?.pendingLogout || platform?.error || platform?.session
    ? '' : user?.uid ?? '';
  const { school } = useSchool();
  const session = platform?.loading || platform?.error || platform?.pendingLogout ? null : platform?.session;
  const accountId = session?.platformAccountId;
  const context = session?.context;
  const verifyPlatform = platform?.isSessionCurrent;
  const scope = JSON.stringify([uid, accountId, context, school.id, platformRoute]);
  const active = useRef(scope);
  active.current = scope;
  const platformTimetable = useMemo<PlatformTimetableAccess | undefined>(() =>
    platformRoute && accountId && context && verifyPlatform ? {
      accountId, isCurrent: () => active.current === scope && verifyPlatform(accountId, context),
    } : undefined, [platformRoute, accountId, context, verifyPlatform, scope]);
  const initialScope = useRef(scope);
  const prompt = typeof route?.params?.prompt === 'string' ? route.params.prompt : '';
  return (
    <AssistantConversation
      key={scope}
      uid={uid}
      platformTimetable={platformTimetable}
      platformContext={context}
      courseworkRequests={platformTimetable && context && platform ? {
        request: (path, input) => platform.request(path, context, input),
        bffRequest: (path) => platform.bffRequest(path, context),
      } : undefined}
      schoolId={school.id}
      schoolName={school.name}
      initialPrompt={initialScope.current === scope ? prompt : ''}
      isScopeCurrent={() => active.current === scope}
      navigation={navigation}
    />
  );
}
type AssistantShortcut =
  | { kind: 'brief'; question: string; savedPlanId?: string }
  | { kind: 'coursework'; question: string; choice?: CourseworkChoice }
  | { kind: 'class'; question: typeof CURRENT_CLASS | typeof NEXT_CLASS | typeof CLASS_ROOM | typeof CLASS_END }
  | { kind: 'selection'; question: string; checkedAt: string };

function AssistantConversation({
  uid,
  platformTimetable,
  platformContext,
  courseworkRequests,
  schoolId,
  schoolName,
  initialPrompt,
  isScopeCurrent,
  navigation,
}: {
  uid: string;
  platformTimetable?: PlatformTimetableAccess;
  platformContext?: string;
  courseworkRequests?: CourseworkRequests;
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
      plan?: CampusEvidencePlan;
      planComparison?: CampusPlanComparison;
      originalPlanId?: string;
      localReads?: LocalCampusReadResult[];
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
  const [panel, setPanel] = useState<AssistantPanel>('chat');
  const [openedSavedPlan, setOpenedSavedPlan] = useState<{ id: string; request: number } | null>(null);
  const chatScroll = useRef<ScrollView>(null);
  const lastRevealed = useRef(-1);
  const [deviceCheck, setDeviceCheck] = useState(0);
  const [error, setError] = useState('');
  const [activeShortcut, setActiveShortcut] = useState<AssistantShortcut | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  const replanInFlight = useRef<AbortController | null>(null);
  const publicServices = resolveSchoolPublicServices(schoolId);
  const canAsk = mode === 'device' || Boolean(uid);
  const timetableOwner = platformTimetable ? `nuni:${platformTimetable.accountId}` : `firebase:${uid}`;
  const lastReply = messages.at(-1);
  const hasClass = !!(lastReply?.savedClassRead ?? lastReply?.courseworkRead?.anchor)?.classes.length;
  const reminderChoice = activeShortcut?.kind === 'coursework' && activeShortcut.choice && 'reminder' in activeShortcut.choice
    ? activeShortcut.choice.reminder : undefined;
  const updatingReminder = reminderChoice === 'confirm' || reminderChoice === 'remove';
  const queryingWork = !!platformTimetable && (activeShortcut?.kind === 'coursework' || (!activeShortcut && !!classCourseworkQuestion(draft, hasClass)));
  const quickActions = platformTimetable ? [] : getMobileQuickActions(draft);
  const currentSense = validCampusSenseSnapshot(sense, { uid, schoolId });
  const latestSense = useRef(currentSense);
  latestSense.current = currentSense;
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
  const changesDuringRead = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!platformTimetable) return;
    return subscribeNuniAssignmentChanges(({ accountId, context, workspaceId, assignmentId }) => {
      if (accountId !== platformTimetable.accountId || context !== platformContext || !platformTimetable.isCurrent()) return;
      changesDuringRead.current?.set(workspaceId, assignmentId);
      setMessages((previous) => previous.map((message) => {
        const read = message.courseworkRead;
        return read?.result.kind === 'assignments' && read.result.workspace.id === workspaceId
          ? { ...message, courseworkRead: { ...read, changedAssignmentId: assignmentId } } : message;
      }));
    });
  }, [platformContext, platformTimetable]);
  const current = () => mounted.current && isScopeCurrent() && (!platformTimetable || platformTimetable.isCurrent());
  const canSavePlans = Boolean(uid) && !platformTimetable;
  const savedPlanScope = useMemo(() => canSavePlans ? { owner: `firebase:${uid}`, schoolId } : null,
    [canSavePlans, uid, schoolId]);
  const savedPlans = useSavedCampusPlans(savedPlanScope, current);
  useEffect(() => subscribeSavedCampusPlanInvalidation(() => {
    if (!mounted.current || !isScopeCurrent()) return;
    replanInFlight.current?.abort();
    setOpenedSavedPlan(null);
    setMessages((previous) => previous.map((message) => {
      if (!message.planComparison) return message;
      const reply = { ...message };
      delete reply.planComparison;
      delete reply.originalPlanId;
      return reply;
    }));
  }), [isScopeCurrent]);
  useEffect(() => {
    if (platformTimetable) return;
    let active = true;
    void getOnDeviceAssistantReadiness().then((state) => {
      if (active && current()) setDeviceStatus(state);
    }).catch(() => {
      if (active && current()) setDeviceStatus(null);
    });
    return () => { active = false; };
  }, [deviceCheck, platformTimetable]);
  const editDraft = (text: string) => {
    if (lock.current) return;
    setDraft(text);
    setError('');
    setActiveShortcut(null);
  };
  const changeMode = (next: CampusAssistantMode) => {
    if (lock.current || syncLock.current || next === mode) return;
    lastRevealed.current = -1;
    setMode(next);
    setPanel('chat');
    setMessages([]);
    setError('');
    setActiveShortcut(null);
  };
  const progressFor = (controller: AbortController) => (progress: CampusSenseProgress) => {
    if (current() && !controller.signal.aborted && inFlight.current === controller) setSyncProgress(progress);
  };
  const cancelledSync = () => {
    setSenseError('已取消這次同步，未套用部分資料。先前摘要仍依原同步時間判定有效性。');
  };
  const syncCampus = async () => {
    if (!uid || lock.current || syncLock.current || !current()) return;
    syncLock.current = true;
    setError('');
    setActiveShortcut(null);
    const controller = new AbortController();
    inFlight.current = controller;
    setSyncBusy(true);
    setSyncProgress(null);
    setSenseError('');
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
        if (controller.signal.aborted) cancelledSync();
        else {
          setSense(null);
          setSenseError('資料同步失敗。請確認帳號、學校權限與網路，再試一次；沒有使用舊資料冒充最新結果。');
        }
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      syncLock.current = false;
      if (current()) {
        setSyncBusy(false);
        setSyncProgress(null);
      }
    }
  };
  const briefPlan = async (question: string, savedPlanId?: string) => {
    if (!uid || lock.current || syncLock.current || !current()) return;
    const original = savedPlanId ? savedPlans.plans.find((saved) => saved.id === savedPlanId) : undefined;
    if (savedPlanId && !original) {
      setError('原計畫已不在清單中，請重新開啟已儲存計畫。');
      return;
    }
    // Sign-out can revoke saved data before the account itself changes.
    const savedSession = original ? createSavedCampusPlanSession(current) : null;
    const planCurrent = () => current() && (!savedSession || savedSession());
    lock.current = true;
    syncLock.current = true;
    setBusy(true);
    setActiveShortcut({ kind: 'brief', question, ...(savedPlanId ? { savedPlanId } : {}) });
    setPanel('chat');
    setSyncBusy(true);
    setSyncProgress(null);
    setError('');
    setSenseError('');
    const controller = new AbortController();
    inFlight.current = controller;
    if (original) replanInFlight.current = controller;
    try {
      let snapshot: CampusSenseSnapshot | null = null;
      try {
        snapshot = await refreshCampusSenseSnapshot({
          scope: { uid, schoolId },
          isCurrent: planCurrent,
          signal: controller.signal,
          onProgress: progressFor(controller),
        });
        if (!planCurrent() || controller.signal.aborted) return;
        setSense(snapshot);
      } catch (syncError) {
        if (!planCurrent()) return;
        if (controller.signal.aborted) { cancelledSync(); return; }
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
      if (!planCurrent() || controller.signal.aborted) return;
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
        isCurrent: planCurrent,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (planCurrent()) {
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
            ...(original && reply.plan ? {
              planComparison: compareCampusPlans(original.plan, reply.plan),
              originalPlanId: original.id,
            } : {}),
            localReads: reply.localReads,
            assignmentRead: reply.assignmentRead,
            savedClassRead: reply.savedClassRead,
            announcementRead: reply.announcementRead,
          },
        ]);
        setActiveShortcut(null);
      }
    } catch {
      if (planCurrent() && !controller.signal.aborted) {
        setError('本機無法完成這次整理。請檢查已儲存課表或免費手機模型。');
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      if (replanInFlight.current === controller) replanInFlight.current = null;
      lock.current = false;
      syncLock.current = false;
      if (current()) {
        if (controller.signal.aborted) setError('已停止這次本地整理。');
        setBusy(false);
        setSyncBusy(false);
        setSyncProgress(null);
      }
    }
  };

  const send = async (shortcut?: Exclude<AssistantShortcut, { kind: 'brief' }>) => {
    const question = shortcut?.question ?? draft.trim();
    if ((!uid && mode === 'campus') || !question || lock.current || syncLock.current || !current()) return;
    if (shortcut?.kind === 'selection' && shortcut.checkedAt !== validCampusSenseSnapshot(sense, { uid, schoolId })?.checkedAt) return;
    lock.current = true;
    setActiveShortcut(shortcut ?? null);
    setBusy(true);
    setError('');
    const controller = new AbortController();
    inFlight.current = controller;
    const duringRead = platformTimetable ? new Map<string, string>() : null;
    changesDuringRead.current = duringRead;
    const asked: CampusAssistantMessage = { role: 'user', content: question };
    const next = [...messages, asked];
    try {
      const reply = await askCampusAssistant({
        scope: { uid, schoolId },
        schoolName,
        ...(platformTimetable ? { platformTimetable, courseworkRequests,
          ...(shortcut?.kind === 'coursework' && { courseworkChoice: shortcut.choice }) } : { senseSnapshot: currentSense }),
        messages: next,
        isCurrent: current,
        mode,
        ...(mode === 'device' ? { signal: controller.signal } : {}),
      });
      const anchor = reply.savedClassRead ?? reply.courseworkRead?.anchor;
      if (platformTimetable && anchor && (anchor.owner !== timetableOwner || anchor.schoolId !== schoolId)) {
        if (current()) setError('無法核對這筆課表，請再查一次。');
        return;
      }
      if (controller.signal.aborted && current()) {
        setError(platformTimetable ? '已取消查詢。' : '已停止本機回答。');
        return;
      }
      if (current()) {
        const read = reply.courseworkRead;
        const changed = read?.result.kind === 'assignments' && duringRead?.get(read.result.workspace.id);
        setMessages((previous) => [
          ...previous, asked,
          {
            role: 'assistant',
            content: reply.content,
            requiresService: reply.hasActions,
            source: reply.source,
            tool: reply.tool,
            route: reply.route,
            plan: reply.plan,
            localReads: reply.localReads,
            assignmentRead: reply.assignmentRead,
            savedClassRead: reply.savedClassRead,
            courseworkRead: read && changed ? { ...read, changedAssignmentId: changed } : read,
            announcementRead: reply.announcementRead,
            proposals: reply.proposals,
          },
        ]);
        if (!shortcut) setDraft('');
        setActiveShortcut(null);
      }
    } catch (failure) {
      if (current()) {
        if (platformTimetable) {
          setError(controller.signal.aborted ? '已取消查詢。' : '暫時無法取得這次查詢，可以再試一次。');
        } else if (failure instanceof OnDeviceAssistantError) {
          if (failure.code === 'model-required') {
            setError('手機尚未下載 AI 模型，請先安裝免費模型。訊息已保留，不會自動改用雲端。');
          } else if (failure.code === 'native-unavailable') {
            setError('目前 App 沒有本地推論引擎。請使用包含 llama.rn 的 iOS／Android 原生版本，Expo Go 不支援。');
          } else if (failure.code === 'model-busy') {
            setError('手機 AI 正在執行其他任務或安裝模型；這次問題已保留，請稍後再送出。');
          } else if (failure.code === 'cancelled') {
            setError('已停止本機回答。');
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
      changesDuringRead.current = null;
      if (inFlight.current === controller) inFlight.current = null;
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  const openAnnouncement = (item: CampusSenseSnapshot['announcements']['items'][number], checkedAt: string) => {
    if (!current() || lock.current || syncLock.current || !item.source) return;
    const verified = validCampusSenseSnapshot(latestSense.current, { uid, schoolId });
    if (verified?.checkedAt !== checkedAt || verified.announcements.status !== 'available') return;
    const source = verified.announcements.items.find((row) => row.source?.kind === item.source?.kind &&
      row.source?.id === item.source?.id && row.title === item.title)?.source;
    if (source) safeNavigate(navigation, '公告詳情', { id: source.id, sourceKind: source.kind, schoolId });
  };
  const scrollToEntry = (event: LayoutChangeEvent) => {
    chatScroll.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - 8), animated: false });
  };
  const revealReply = (index: number, event: LayoutChangeEvent) => {
    if (index !== messages.length - 1 || lastRevealed.current === index || panel !== 'chat') return;
    lastRevealed.current = index;
    scrollToEntry(event);
  };
  const campusTools = platformTimetable ? null : (
    <>
      {canSavePlans ? (
        <SavedCampusPlansPanel
          key={openedSavedPlan?.request ?? 'saved-plans'}
          initialExpandedId={openedSavedPlan?.id}
          plans={savedPlans.plans}
          loading={savedPlans.loading}
          busy={busy || syncBusy || savedPlans.busy}
          error={savedPlans.error}
          onRetry={savedPlans.retry}
          onDelete={(id) => { void savedPlans.remove(id); }}
          onToggleStep={(id, stepId, done) => { void savedPlans.toggle(id, stepId, done); }}
          onReplan={(saved) => { if (current()) void briefPlan(saved.question, saved.id); }}
          onOpenRoute={(route) => {
            if (current() && !lock.current && !syncLock.current) {
              safeNavigate(navigation, VERIFIED_SERVICE_ROUTES[route].route);
            }
          }}
        />
      ) : null}
      <AICard
        title="工作模式"
        badge={mode === 'device' ? '手機內推論' : '校園連線'}
        badgeTone={mode === 'device' ? 'success' : 'ai'}
      >
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <AIButton
              label={mode === 'device' ? '✓ 手機本地 AI · 免費推論' : '手機本地 AI · 免費推論'}
              variant={mode === 'device' ? 'primary' : 'ghost'}
              size="sm"
              style={{ flexGrow: 1, flexBasis: 146 }}
              disabled={busy || syncBusy}
              onPress={() => changeMode('device')}
            />
            <AIButton
              label={mode === 'campus' ? '✓ 校園即時 · 需網路' : '校園即時 · 需網路'}
              variant={mode === 'campus' ? 'primary' : 'ghost'}
              size="sm"
              style={{ flexGrow: 1, flexBasis: 146 }}
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
                查課表、找已同步作業都能直接在手機上完成。可以先問「明天有哪些作業要交？」，再問「那下週呢？」。自由問答需下載免費模型。
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
      <LegacyAssignmentReminders key={`${uid}:${schoolId}`} uid={uid} schoolId={schoolId} snapshot={sense} isCurrent={current} />
      {mode === 'device' ? (
        <CampusSenseDashboard
          snapshot={currentSense}
          expired={Boolean(sense)}
          authenticated={Boolean(uid)}
          busy={busy}
          syncBusy={syncBusy}
          progress={syncProgress}
          error={senseError}
          onCancelSync={() => {
            if (!current() || !syncLock.current) return;
            inFlight.current?.abort();
            cancelledSync();
          }}
          assignmentContext={{ userId: uid, schoolId, isCurrent: current, navigation }}
          onOpenAnnouncement={navigation?.navigate && currentSense
            ? (item) => openAnnouncement(item, currentSense.checkedAt) : undefined}
          onOpenAnnouncements={navigation?.navigate ? () => {
            if (current() && !lock.current && !syncLock.current) safeNavigate(navigation, '公告總覽');
          } : undefined}
          onSync={() => void syncCampus()}
          onBrief={() => void briefPlan(TODAY_BRIEF)}
          onWeekBrief={() => void briefPlan(WEEK_BRIEF)}
          onClear={() => { setSense(null); setSenseError(''); setActiveShortcut(null); setError(''); }}
        />
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
    </>
  );
  return (
    <AssistantConversationLayout
      title={platformTimetable ? '課表助理' : '校園助理'}
      subtitle={schoolName + ' · ' + (platformTimetable ? 'nuni 個人課表' : mode === 'device' ? '手機本地' : '校園連線')}
      panel={panel} onSelect={setPanel} locked={busy || syncBusy} chatScroll={chatScroll}
      onBack={() => {
        inFlight.current?.abort();
        navigation?.goBack?.();
      }}
      tools={campusTools}
      composer={canAsk ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
          paddingVertical: 8, borderTopWidth: 1, borderColor: aiTokens.border }}>
          <TextInput
            accessibilityLabel="詢問校園助理"
            value={draft} maxLength={1600} multiline editable={!busy} onChangeText={editDraft}
            placeholder={platformTimetable ? '問上課時間、教室或作業…' : mode === 'device' ? '問課表、作業…' : '查校園資訊…'}
            placeholderTextColor={aiTokens.muted}
            style={{ flex: 1, minWidth: 0, minHeight: 44, maxHeight: 96, borderWidth: 1,
              borderRadius: 12, borderColor: aiTokens.border, color: aiTokens.text,
              backgroundColor: aiTokens.panel, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }}
          />
          {updatingReminder && busy ? <AIButton label="處理提醒中…" size="sm" disabled /> : busy && mode === 'device' ? (
            <AIButton label={syncBusy ? '取消這次同步' : queryingWork ? '取消作業查詢' : '停止本機回答'} variant="ghost" size="sm"
              onPress={() => inFlight.current?.abort()} />
          ) : (
            <AIButton label={busy ? '正在查詢…' : error && !activeShortcut ? '重試查詢' : '送出問題'}
              size="sm" disabled={busy || syncBusy || !draft.trim()} onPress={() => void send()} />
          )}
        </View>
      ) : null}
    >
      {canSavePlans && savedPlans.plans.length > 0 ? (
        <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
          <AIButton label={`繼續已儲存的計畫（${savedPlans.plans.length}）`} variant="ghost"
            disabled={busy || syncBusy || savedPlans.busy} onPress={() => setPanel('tools')} />
        </View>
      ) : null}
      {!uid && mode === 'campus' && (
        <AICard title="校園即時查詢需要登入">
          <AIButton label="改問手機助理" onPress={() => changeMode('device')} />
        </AICard>
      )}
      {panel === 'chat' && (uid || platformTimetable) && mode === 'device' && messages.length === 0 && !busy && !error && !draft.trim() ? (
        <AICard title={platformTimetable ? '我的上課安排' : '我的課業安排'}>
          <AssistantClassNowHint uid={uid} schoolId={schoolId} platformTimetable={platformTimetable}>
            {(upcoming) => (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {(upcoming ? [NEXT_CLASS, CURRENT_CLASS] as const : [CURRENT_CLASS, NEXT_CLASS] as const).map((question, order) => (
                  <AIButton key={question} label={question === CURRENT_CLASS ? '現在有課嗎？' : '查下一堂課'}
                    variant={order === 0 ? 'primary' : 'ghost'} onPress={() => void send({ kind: 'class', question })} />
                ))}
                {uid ? <>
                  <AIButton label="整理今日重點" variant="ghost" onPress={() => void briefPlan(TODAY_BRIEF)} />
                  <AIButton label="規劃未來七天" variant="ghost" onPress={() => void briefPlan(WEEK_BRIEF)} />
                  <AIButton label={currentSense?.announcements.status === 'available' ? '查今日公告' : '同步並查今日公告'}
                    variant="ghost" onPress={() => void (currentSense?.announcements.status === 'available'
                      ? send({ kind: 'selection', question: TODAY_ANNOUNCEMENTS, checkedAt: currentSense.checkedAt })
                      : briefPlan(TODAY_ANNOUNCEMENTS))} />
                </> : null}
              </View>
            )}
          </AssistantClassNowHint>
        </AICard>
      ) : null}
      {platformTimetable && messages.length === 0 && !draft.trim() && !busy && !error ? (
        <AICard title="我的課表">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <AIButton label="查看完整課表" variant="ghost" onPress={() => current() && safeNavigate(navigation, 'PersonalTimetable')} />
            <AIButton label="匯入課表" variant="ghost" onPress={() => current() && safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' })} />
          </View>
        </AICard>
      ) : null}
      {!platformTimetable && canAsk && messages.length === 0 && !busy && !error ? (
        <AICard title={draft.trim() ? '繼續你的提問' : '想先處理哪件事？'}>
          <Text style={{ color: aiTokens.textSecondary, fontSize: 15, lineHeight: 22 }}>
            {draft.trim() ? '可以修改輸入欄裡的問題，再按送出。'
              : mode === 'device' ? '先選一個問題，或直接輸入。用手機鍵盤的麥克風也能口述。'
              : '先確認要查的內容。送出後，助理會連線查詢。'}
          </Text>
          {!draft.trim() && (
            <View style={{ gap: 6, marginTop: 10 }}>
              {(mode === 'device'
                ? ['請依手機儲存的課表整理學習安排', ...(currentSense ? ['我還有哪些作業待交？'] : []),
                  '幫我把期末報告拆成可以完成的步驟']
                : ['這週有哪些校園活動？', '最近有哪些校園公告？']
              ).map((question) => (
                <AIButton key={question} label={question} variant="ghost" size="sm"
                  style={{ alignSelf: 'stretch' }} onPress={() => editDraft(question)} />
              ))}
            </View>
          )}
        </AICard>
      ) : null}
      {messages.map((message, index) => message.role === 'user' ? (
        <View key={index} style={{ alignSelf: 'flex-end', maxWidth: '85%', marginRight: 16,
          marginVertical: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 16,
          backgroundColor: aiTokens.aiSoft }}>
          <Text style={{ color: aiTokens.textSecondary, fontSize: 12 }}>你的問題</Text>
          <Text selectable style={{ color: aiTokens.text, fontSize: 16, lineHeight: 24 }}>{message.content}</Text>
        </View>
      ) : (
        <View key={index} onLayout={(event) => revealReply(index, event)}>
          <AICard title={message.courseworkRead ? courseworkReplyTitle(message.courseworkRead)
            : message.announcementRead ? '校園公告'
            : message.savedClassRead ? savedClassReplyTitle(message.savedClassRead) : message.localReads?.length ? '手機工具查詢' : message.plan ? '校園行動計畫' : message.tool ? '手機離線工具' : platformTimetable ? '課表助理' : message.source === 'device' ? '手機本地 AI' : '校園即時助理'}>
            {platformTimetable && message.courseworkRead ? (
              <NuniCourseworkReply read={message.courseworkRead} latest={index === messages.length - 1}
                busy={busy || syncBusy}
                onSelect={(choice, label) => void send({ kind: 'coursework', choice, question: label })}
                onAsk={(question) => void send({ kind: 'coursework', question })}
                onRetry={() => void send({ kind: 'coursework', question: CLASS_WORK })}
                onCheckClass={() => void send({ kind: 'class', question: message.courseworkRead?.anchor.currentAt ? CURRENT_CLASS : NEXT_CLASS })}
                onLink={() => current() && safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' })}
                onOpen={(workspaceId, assignmentId) => {
                  if (!current() || !safeNavigate(navigation, 'NuniWorkspace', {
                    tab: 'courses', workspaceId, assignmentId, assistantAccountId: platformTimetable.accountId,
                  })) return;
                  setMessages((previous) => {
                    const entry = previous[index];
                    const read = entry?.courseworkRead;
                    if (read?.result.kind !== 'assignments') return previous;
                    if (index === previous.length - 1) return [...previous.slice(0, index),
                      { ...entry, courseworkRead: { ...read, openedAssignmentId: assignmentId } }];
                    const resumed = resumeOpenedCoursework(previous, read, assignmentId);
                    const item = read.result.assignments.find((row) => row.id === assignmentId);
                    if (!item || !resumed) return previous;
                    return [...previous, { role: 'user', content: `查看作業：${item.title}` },
                      { role: 'assistant', source: 'device', tool: 'saved-timetable',
                        content: resumed.view?.message ?? '請重新核對這份作業。', courseworkRead: resumed }];
                  });
                }} />
            ) : message.savedClassRead ? (
              <SavedClassReplyCard classes={message.savedClassRead.classes} updatedAt={message.savedClassRead.updatedAt} focus={message.savedClassRead.focus}
                currentAt={message.savedClassRead.currentAt}
                disabled={busy || syncBusy || !navigation?.navigate}
                onOpen={(item) => {
                  const read = message.savedClassRead;
                  if (!current() || !read || read.uid !== uid || read.schoolId !== schoolId ||
                      (platformTimetable && read.owner !== timetableOwner)) return;
                  safeNavigate(navigation, 'PersonalTimetable', {
                    schoolId, courseId: item.courseId, date: item.date, term: item.term,
                    startAt: Date.parse(`${item.date}T${item.startTime}:00+08:00`),
                    reminderScope: JSON.stringify({ owner: timetableOwner, schoolId }),
                  });
                }} />
            ) : message.announcementRead ? (
              <View style={{ gap: 10 }}>
                <Text selectable style={{ color: aiTokens.text, lineHeight: 24 }}>{message.announcementRead.summary}</Text>
                <CampusAnnouncementRows items={message.announcementRead.items} disabled={busy || syncBusy}
                  onOpenAnnouncement={navigation?.navigate && currentSense &&
                    message.announcementRead.userId === uid && message.announcementRead.schoolId === schoolId &&
                    message.announcementRead.checkedAt === currentSense.checkedAt
                    ? (item) => openAnnouncement(item, currentSense.checkedAt) : undefined} />
              </View>
            ) : message.localReads?.length ? (
              <CampusLocalReadResults
                results={message.localReads}
                disabled={busy || syncBusy}
                onOpenRoute={(route) => {
                  if (!current()) return;
                  const destination = VERIFIED_SERVICE_ROUTES[route];
                  if (current() && destination) safeNavigate(navigation, destination.route);
                }}
              />
            ) : (
              <Text selectable style={{ color: aiTokens.text, lineHeight: 25 }}>
                {message.plan ? message.plan.overview : message.content}
              </Text>
            )}
            {platformTimetable && index === messages.length - 1 && !!message.savedClassRead?.classes.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <AIButton label="查這堂課的作業" variant="ghost" disabled={busy}
                  onPress={() => void send({ kind: 'coursework', question: CLASS_WORK })} />
                {message.savedClassRead.focus !== 'room' && <AIButton label="在哪間教室？" variant="ghost" disabled={busy}
                  onPress={() => void send({ kind: 'class', question: CLASS_ROOM })} />}
                {message.savedClassRead.focus !== 'time' && <AIButton label="幾點下課？" variant="ghost" disabled={busy}
                  onPress={() => void send({ kind: 'class', question: CLASS_END })} />}
              </View>
            ) : null}
            {platformTimetable && index === messages.length - 1 && !!message.savedClassRead?.classes.length &&
              <Text style={{ color: aiTokens.muted, fontSize: 12, marginTop: 6 }}>作業會連線讀取你在 nuni 修課的資料。</Text>}
            {index === messages.length - 1 && message.assignmentRead && currentSense && (
              <AssignmentReplyActions read={message.assignmentRead} snapshot={currentSense}
                context={{ userId: uid, schoolId, isCurrent: current, navigation }} disabled={busy || syncBusy}
                onAsk={(question) => void send({ kind: 'selection', question, checkedAt: currentSense.checkedAt })} />
            )}
            {message.plan ? (
              <>
                {message.planComparison ? (
                  <CampusPlanComparisonCard
                    comparison={message.planComparison}
                    disabled={busy || syncBusy || savedPlans.busy}
                    onOpenOriginal={message.originalPlanId && savedPlans.plans.some((saved) => saved.id === message.originalPlanId)
                      ? () => {
                        if (!current() || lock.current || syncLock.current || !message.originalPlanId) return;
                        setOpenedSavedPlan((previous) => ({ id: message.originalPlanId!, request: (previous?.request ?? 0) + 1 }));
                        setPanel('tools');
                      } : undefined}
                  />
                ) : null}
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
                  if (current() && destination) safeNavigate(navigation, destination.route);
                }}
                />
                {canSavePlans && messages[index - 1]?.role === 'user' ? (
                  <View style={{ marginTop: 14, gap: 8 }}>
                    {savedPlans.plans.some((saved) => saved.question === messages[index - 1].content.trim() &&
                      saved.plan.checkedAt === message.plan?.checkedAt && saved.plan.content === message.plan.content) ? (
                      <>
                        <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.success, fontSize: 13 }}>計畫已儲存</Text>
                        <AIButton label="查看已儲存計畫" variant="ghost" disabled={busy || syncBusy || savedPlans.busy}
                          onPress={() => setPanel('tools')} />
                      </>
                    ) : (
                      <AIButton label={savedPlans.busy ? '正在儲存計畫…' : '儲存這份計畫'} variant="ghost"
                        disabled={busy || syncBusy || savedPlans.loading || savedPlans.busy}
                        onPress={() => {
                          if (current() && message.plan) void savedPlans.save(messages[index - 1].content, message.plan);
                        }} />
                    )}
                    <Text style={{ color: aiTokens.muted, fontSize: 12, lineHeight: 19 }}>
                      保留這次的安排，之後可回來記錄處理進度。只存於這台手機，登出時清除。
                    </Text>
                    {savedPlans.error ? (
                      <View style={{ gap: 6 }}>
                        <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>{savedPlans.error}</Text>
                        <AIButton label="重新載入計畫" variant="ghost" disabled={savedPlans.busy || savedPlans.loading}
                          onPress={savedPlans.retry} />
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}
            {message.source === 'campus' &&
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
                  onOpenSettings={typeof navigation?.navigate === 'function'
                    ? () => safeNavigate(navigation, 'AssistantPermissions')
                    : undefined}
                />
              ))}
            {!platformTimetable && message.source === 'device' && !message.savedClassRead && (
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
            {platformTimetable && message.route === '/timetable/import' ? (
              <AIButton label="匯入課表" disabled={busy} onPress={() => current() && safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' })} />
            ) : (!message.savedClassRead || !message.savedClassRead.classes.length) && !message.plan && !message.localReads?.length && message.route && (!platformTimetable || message.route === '/timetable') && VERIFIED_SERVICE_ROUTES[message.route] ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {message.savedClassRead?.currentAt && index === messages.length - 1 && (
                  <AIButton label="查下一堂課" disabled={busy || syncBusy}
                    onPress={() => void send({ kind: 'class', question: NEXT_CLASS })} />
                )}
                <AIButton
                  label={'開啟' + VERIFIED_SERVICE_ROUTES[message.route].label}
                  variant="ghost"
                  disabled={busy || syncBusy}
                  onPress={() => {
                    const destination = message.route && VERIFIED_SERVICE_ROUTES[message.route];
                    if (current() && destination) safeNavigate(navigation, destination.route);
                  }}
                />
              </View>
            ) : !platformTimetable && !message.savedClassRead && !message.plan && !message.localReads?.length && index > 0 ? (
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
        </View>
      ))}
      {busy && (
        <View onLayout={scrollToEntry}>
          <AICard title={updatingReminder ? '正在處理作業提醒…' : queryingWork ? '正在核對課程與作業…' : syncBusy ? '正在同步校園資料…' : mode === 'device' ? '手機正在整理回答…' : '正在查詢校園資料…'}>
            <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.text, lineHeight: 22 }}>
              {activeShortcut?.question ?? draft.trim()}
            </Text>
            {syncBusy ? (
              <Text accessibilityLiveRegion="polite" style={{ color: aiTokens.textSecondary, lineHeight: 21 }}>
                {syncProgress?.total != null
                  ? `已核對 ${syncProgress.loaded} / ${syncProgress.total} 筆作業`
                  : '正在核對校園資料的讀取權限…'}
              </Text>
            ) : null}
          </AICard>
        </View>
      )}
      {mode === 'device' && senseError ? (
        <Text accessibilityRole="alert" style={{ marginHorizontal: 16, color: aiTokens.textSecondary }}>{senseError}</Text>
      ) : null}
      {canAsk && quickActions.length > 0 && typeof navigation?.navigate === 'function' ? (
        <View style={{ marginHorizontal: 16, gap: 10, padding: 12, borderRadius: 12, backgroundColor: aiTokens.panel }}>
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
        <View onLayout={scrollToEntry} style={{ marginHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>{error}</Text>
          {activeShortcut && (activeShortcut.kind !== 'selection' || activeShortcut.checkedAt === currentSense?.checkedAt) ? (
            <AIButton label={activeShortcut.kind !== 'brief' ? `重試「${activeShortcut.question}」`
                : activeShortcut.question === TODAY_ANNOUNCEMENTS ? '重新查今日公告'
                : activeShortcut.question === TODAY_BRIEF ? '重新整理今日重點'
                : activeShortcut.question === WEEK_BRIEF ? '重新規劃未來七天' : '重試這次規劃'} variant="ghost"
              disabled={busy || syncBusy}
              onPress={() => void (activeShortcut.kind === 'brief'
                ? briefPlan(activeShortcut.question, activeShortcut.savedPlanId) : send(activeShortcut))} />
          ) : null}
        </View>
      ) : null}
    </AssistantConversationLayout>
  );
}
