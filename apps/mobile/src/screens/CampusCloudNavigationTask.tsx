import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  createCloudNavigationRequestId,
  getCloudNavigationPreview,
  runCloudNavigationTask,
  type CloudNavigationFailure,
  type CloudNavigationPreview,
  type CloudNavigationResult,
} from '../features/cloudNavigation';
import { AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { safeNavigate } from '../utils/safeNavigate';

type Props = {
  uid: string;
  schoolId: string;
  schoolName: string;
  initialPrompt?: string;
  draft?: string;
  onDraftChange?: (value: string) => void;
  initialRetryReadyAt?: number | null;
  onRateLimited?: (readyAt: number) => void;
  isScopeCurrent: () => boolean;
  navigation?: Parameters<typeof safeNavigate>[0];
  cancelRef?: React.MutableRefObject<(() => void) | null>;
};
type Plan = CloudNavigationPreview & { requestId: string };

function failureMessage(failure: unknown, phase: 'preview' | 'execute'): string {
  const code = (failure as { code?: string } | null)?.code;
  if (code === 'unconfigured') return '雲端導航尚未啟用，請先用校園地圖查詢。';
  if (code === 'session-changed' || code === 'functions/unauthenticated') {
    return '登入狀態已變更，請重新登入並預覽。';
  }
  if (code === 'functions/permission-denied')
    return '目前帳號無法查詢這個校園，請重新確認登入狀態。';
  if (code === 'invalid-response') return '這次回覆未通過檢查，沒有產生導航建議。你可以重試。';
  if (code === 'functions/resource-exhausted') return '目前查詢較多，請稍候再試。你的輸入已保留。';
  return phase === 'preview'
    ? '這次未能讀取公開地點。你的輸入已保留，請重新預覽。'
    : '這次未能取得導航建議。你的輸入已保留，可以稍後重試。';
}

function resultMessage(result: CloudNavigationFailure): string {
  switch (result.reason) {
    case 'not_configured':
      return '雲端導航尚未啟用，請先用校園地圖查詢。';
    case 'rate_limited':
      return '目前查詢較多，請稍候再試。你的輸入已保留。';
    case 'timeout':
      return '這次查詢逾時，尚未取得導航建議。你可以重試。';
    case 'canceled':
      return '已停止等待。已送出的雲端查詢不一定能立即中止。';
    case 'no_places':
      return '這個校園目前沒有可用的公開地點資料，請改用校園地圖。';
    case 'ambiguous_places':
      return '還無法確定起點或終點，請補上完整地點名稱後重新預覽。';
    case 'source_changed':
      return '地點資料已變更，請重新預覽後再規劃。';
    case 'permission_changed':
      return '帳號或校園權限已變更，請重新確認登入狀態並預覽。';
    case 'invalid_response':
      return '這次回覆未通過檢查，沒有產生導航建議。你可以重試。';
    default:
      return '這次未能取得導航建議。你的輸入已保留，可以稍後重試。';
  }
}

function taiwanTime(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function CampusCloudNavigationTask(props: Props) {
  const scope = JSON.stringify([props.uid, props.schoolId]);
  const initialScope = useRef(scope);
  const changedScope = useRef(false);
  if (scope !== initialScope.current) changedScope.current = true;
  return (
    <NavigationSession
      key={scope}
      {...props}
      initialPrompt={changedScope.current ? '' : props.initialPrompt}
    />
  );
}

function NavigationSession({
  uid,
  schoolId,
  schoolName,
  initialPrompt = '',
  draft: controlledDraft,
  onDraftChange,
  initialRetryReadyAt,
  onRateLimited,
  isScopeCurrent,
  navigation,
  cancelRef,
}: Props) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const [localDraft, setDraft] = useState(initialPrompt);
  const draft = controlledDraft ?? localDraft;
  const [plan, updatePlan] = useState<Plan | null>(null);
  const [consented, updateConsented] = useState(false);
  const [phase, setPhase] = useState<'preview' | 'execute' | null>(null);
  const [sent, setSent] = useState(false);
  const [result, updateResult] = useState<CloudNavigationResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retryReadyAt, updateRetryReadyAt] = useState<number | null>(() =>
    typeof initialRetryReadyAt === 'number' && Number.isFinite(initialRetryReadyAt) && initialRetryReadyAt > Date.now()
      ? initialRetryReadyAt : null,
  );
  const request = useRef<AbortController | null>(null);
  const composer = useRef<TextInput>(null);
  const mounted = useRef(true);
  const currentPlan = useRef<Plan | null>(null);
  const currentConsent = useRef(false);
  const currentResult = useRef<CloudNavigationResult | null>(null);
  const currentRetryReadyAt = useRef<number | null>(retryReadyAt);
  const currentScope = useRef(isScopeCurrent);
  currentScope.current = isScopeCurrent;
  const cancelAction = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      currentConsent.current = false;
      request.current?.abort();
      request.current = null;
    };
  }, []);

  useEffect(() => {
    if (!cancelRef) return;
    const stop = () => cancelAction.current();
    cancelRef.current = stop;
    return () => {
      if (cancelRef.current === stop) cancelRef.current = null;
    };
  }, [cancelRef]);

  useEffect(() => {
    if (retryReadyAt === null) return;
    const timer = setTimeout(
      () => {
        currentRetryReadyAt.current = null;
        updateRetryReadyAt(null);
      },
      Math.max(0, retryReadyAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [retryReadyAt]);

  function isCurrent() {
    return !!uid && mounted.current && currentScope.current();
  }
  function setPlan(value: Plan | null) {
    currentPlan.current = value;
    updatePlan(value);
  }
  function setConsented(value: boolean) {
    currentConsent.current = value;
    updateConsented(value);
  }
  function setResult(value: CloudNavigationResult | null) {
    currentResult.current = value;
    updateResult(value);
  }
  function setRetryReadyAt(value: number | null) {
    currentRetryReadyAt.current = value;
    updateRetryReadyAt(value);
  }
  function accepts(controller: AbortController) {
    return isCurrent() && !controller.signal.aborted && request.current === controller;
  }
  function stopWaiting() {
    request.current?.abort();
    request.current = null;
    setPhase(null);
  }
  function changeDraft(value: string) {
    const wasExecuting = phase === 'execute';
    stopWaiting();
    setDraft(value);
    onDraftChange?.(value);
    setPlan(null);
    setConsented(false);
    setResult(null);
    setSent(false);
    setError('');
    setNotice(wasExecuting ? '已停止等待上一筆查詢。已送出的雲端查詢不一定能立即中止。' : '');
  }
  function requireCurrentScope() {
    if (isCurrent()) return true;
    stopWaiting();
    setPlan(null);
    setResult(null);
    setConsented(false);
    setError('帳號或校園已變更，請重新開啟並預覽。');
    return false;
  }
  async function preview() {
    if (request.current || !requireCurrentScope()) return;
    const query = draft.trim();
    if (!query || query.length > 240) {
      setError(!query ? '請先輸入出發地與目的地。' : '請將輸入縮短至 240 字以內。');
      composer.current?.focus();
      return;
    }
    Keyboard.dismiss();
    const previousPlan = plan;
    const controller = new AbortController();
    request.current = controller;
    setPhase('preview');
    setPlan(null);
    setConsented(false);
    setResult(null);
    setSent(false);
    setError('');
    setNotice('');
    try {
      const response = await getCloudNavigationPreview(
        { scope: { uid, schoolId }, query, isCurrent },
        controller.signal,
      );
      if (!accepts(controller)) return;
      if (
        response.schoolId !== schoolId ||
        (response.status === 'preview' && response.query !== query)
      ) {
        setError('校園資料或輸入已變更，請重新預覽。');
        return;
      }
      if (response.status !== 'preview') {
        setResult(response);
        return;
      }
      setPlan({
        ...response,
        requestId:
          previousPlan?.query === query && previousPlan.fingerprint === response.fingerprint
            ? previousPlan.requestId
            : createCloudNavigationRequestId(),
      });
    } catch (failure) {
      if (accepts(controller)) setError(failureMessage(failure, 'preview'));
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (mounted.current) setPhase(null);
      }
    }
  }
  async function run() {
    const activePlan = currentPlan.current;
    if (
      request.current ||
      !requireCurrentScope() ||
      !activePlan ||
      !activePlan.cloudReady ||
      !currentConsent.current ||
      currentResult.current?.status === 'completed' ||
      (currentRetryReadyAt.current !== null && Date.now() < currentRetryReadyAt.current)
    )
      return;
    Keyboard.dismiss();
    const controller = new AbortController();
    request.current = controller;
    setPhase('execute');
    setSent(true);
    setResult(null);
    setError('');
    setNotice('');
    try {
      const response = await runCloudNavigationTask(
        {
          scope: { uid, schoolId },
          query: activePlan.query,
          requestId: activePlan.requestId,
          isCurrent,
          consent: {
            provider: 'groq',
            version: 1,
            schoolId,
            query: activePlan.query,
            fingerprint: activePlan.fingerprint,
          },
        },
        controller.signal,
      );
      if (!accepts(controller)) return;
      if (response.schoolId !== schoolId) {
        setPlan(null);
        setConsented(false);
        setError('校園資料已變更，請重新預覽。');
        return;
      }
      setResult(response);
      if (response.status !== 'completed') {
        if (response.reason === 'source_changed' || response.reason === 'permission_changed') {
          setPlan(null);
          setConsented(false);
        }
        if (response.reason === 'rate_limited' && response.retryAfterSeconds) {
          const readyAt = Date.now() + response.retryAfterSeconds * 1000;
          setRetryReadyAt(readyAt);
          onRateLimited?.(readyAt);
        }
      }
    } catch (failure) {
      if (accepts(controller)) {
        setError(failureMessage(failure, 'execute'));
        const code = (failure as { code?: string } | null)?.code;
        if (
          code === 'session-changed' ||
          code === 'unconfigured' ||
          code === 'functions/unauthenticated' ||
          code === 'functions/permission-denied'
        ) {
          setPlan(null);
          setConsented(false);
        }
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (mounted.current) setPhase(null);
      }
    }
  }
  function cancel(restoreFocus = true) {
    const wasExecuting = phase === 'execute';
    stopWaiting();
    setConsented(false);
    setResult(null);
    setError('');
    setNotice(
      wasExecuting
        ? '已停止等待。已送出的雲端查詢不一定能立即中止。你的輸入已保留。'
        : '已取消這次規劃。你的輸入已保留。',
    );
    if (restoreFocus) composer.current?.focus();
  }
  cancelAction.current = () => cancel(false);
  function toggleConsent() {
    if (
      request.current ||
      !currentPlan.current?.cloudReady ||
      currentResult.current?.status === 'completed' ||
      !requireCurrentScope()
    )
      return;
    setConsented(!currentConsent.current);
  }
  function openMap() {
    if (!mounted.current || !currentScope.current()) return;
    const completed = currentResult.current?.status === 'completed' ? currentResult.current : null;
    if (completed && !requireCurrentScope()) return;
    const params = completed
      ? { schoolId, fromPoiId: completed.route.from.id, toPoiId: completed.route.to.id }
      : { schoolId };
    if (!safeNavigate(navigation, 'MapV2', params, { fallbackMessage: null })) {
      setError('目前無法開啟校園地圖，請返回生活頁後再試。');
    }
  }

  const completed = result?.status === 'completed' ? result : null;
  const incomplete = result && result.status !== 'completed' ? result : null;
  const textStyle = [styles.text, { color: aiTokens.text }];
  const mutedStyle = [styles.text, { color: aiTokens.muted }];
  const headingStyle = [styles.heading, { color: aiTokens.text }];
  const buttonStyle = { alignSelf: 'stretch' as const, justifyContent: 'center' as const };
  return (
    <View style={[styles.root, { paddingHorizontal: aiTokens.space.md }]}>
      <Text accessibilityRole="header" style={headingStyle}>
        規劃校園步行路線
      </Text>
      <Text style={textStyle}>{schoolName} · 確認內容後，由 Groq 協助辨識起點與終點。</Text>
      <Text style={textStyle}>出發地與目的地</Text>
      <TextInput
        ref={composer}
        accessibilityLabel="出發地與目的地"
        multiline
        maxLength={240}
        value={draft}
        onChangeText={changeDraft}
        placeholder="例如：從圖書館走到活動中心"
        placeholderTextColor={aiTokens.muted}
        textAlignVertical="top"
        style={[
          styles.input,
          { color: aiTokens.text, backgroundColor: aiTokens.surface, borderColor: aiTokens.border },
        ]}
      />
      <Text style={mutedStyle}>請只填地點，不要填入姓名、學號或其他私人資訊。</Text>
      <Text style={mutedStyle}>{draft.length}／240 字</Text>
      <AIButton
        label={phase === 'preview' ? '讀取中…' : '預覽傳送內容'}
        variant="ghost"
        style={buttonStyle}
        disabled={phase !== null}
        onPress={preview}
      />
      {phase === 'preview' && (
        <>
          <Text accessibilityLiveRegion="polite" style={mutedStyle}>
            正在讀取 nuni 的公開地點，尚未傳送至 Groq。
          </Text>
          <AIButton label="取消讀取" variant="ghost" style={buttonStyle} onPress={cancel} />
        </>
      )}
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={textStyle}>
          {notice}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={[styles.text, { color: aiTokens.danger }]}>
          {error}
        </Text>
      )}

      {plan && (
        <AICard style={{ marginHorizontal: 0 }}>
          <View style={styles.section}>
            <Text accessibilityRole="header" style={headingStyle}>
              確認這次傳送的內容
            </Text>
            <Text style={textStyle}>雲端服務：Groq</Text>
            <Text style={textStyle}>模型：{plan.model}</Text>
            <Text style={textStyle}>校園代碼：{schoolId}</Text>
            <Text style={textStyle}>你的輸入：{plan.query}</Text>
            <Text style={textStyle}>
              會傳送這次的輸入、校園代碼，以及以下公開地點的候選編號、名稱、分類與別名。
            </Text>
            <Text accessibilityRole="header" style={headingStyle}>
              公開地點（{plan.places.length} 處）
            </Text>
            {plan.places.map((place) => (
              <View key={place.ref} style={[styles.place, { borderColor: aiTokens.border }]}>
                <Text style={textStyle}>
                  候選 {place.ref}：{place.name}
                </Text>
                <Text style={mutedStyle}>分類：{place.category || '未提供'}</Text>
                <Text style={mutedStyle}>
                  別名：{place.aliases.length ? place.aliases.join('、') : '無'}
                </Text>
              </View>
            ))}
            <Text style={mutedStyle}>不會附加座標、帳號識別碼、課表、作業或對話紀錄。</Text>
            <Text style={mutedStyle}>
              公開地點查詢時間：{taiwanTime(plan.checkedAt)}（臺灣時間）
            </Text>
            <Text style={mutedStyle}>
              {plan.sourceUpdatedAt
                ? `地點資料更新時間：${taiwanTime(plan.sourceUpdatedAt)}（臺灣時間）`
                : '地點來源未提供更新時間。'}
            </Text>
            {!plan.cloudReady && (
              <Text accessibilityLiveRegion="polite" style={textStyle}>
                雲端導航尚未設定，目前只能預覽，請先用校園地圖查詢。
              </Text>
            )}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="我同意將上述內容傳送至 Groq，進行這次規劃。"
              aria-checked={consented}
              accessibilityState={{
                checked: consented,
                disabled: phase !== null || !plan.cloudReady || completed !== null,
              }}
              disabled={phase !== null || !plan.cloudReady || completed !== null}
              onPress={toggleConsent}
              {...(Platform.OS === 'web'
                ? {
                    onKeyDown: (event: {
                      key: string;
                      repeat: boolean;
                      preventDefault: () => void;
                    }) => {
                      if (event.key === ' ' || event.key === 'Spacebar') {
                        event.preventDefault();
                        if (!event.repeat) toggleConsent();
                      }
                    },
                  }
                : {})}
              style={[styles.consent, { borderColor: aiTokens.border }]}
            >
              <Text accessible={false} style={[styles.check, { color: aiTokens.text }]}>
                {consented ? '☑' : '☐'}
              </Text>
              <Text style={[...textStyle, styles.consentText]}>
                我同意將上述內容傳送至 Groq，進行這次規劃。
              </Text>
            </Pressable>
            <AIButton
              label={
                phase === 'execute' ? '正在規劃…' : sent && !completed ? '重試規劃' : '確認規劃'
              }
              style={buttonStyle}
              onPress={run}
              disabled={
                !consented ||
                phase !== null ||
                completed !== null ||
                retryReadyAt !== null ||
                !plan.cloudReady
              }
            />
            {!completed && (
              <AIButton
                label={phase === 'execute' ? '取消等待' : '取消規劃'}
                variant="ghost"
                style={buttonStyle}
                onPress={cancel}
              />
            )}
            {phase === 'execute' && (
              <Text accessibilityLiveRegion="polite" style={mutedStyle}>
                正在等待導航建議。取消會停止本頁等待；已送出的雲端查詢不一定能立即中止。
              </Text>
            )}
            {retryReadyAt !== null && (
              <Text accessibilityLiveRegion="polite" style={mutedStyle}>
                可於臺灣時間 {taiwanTime(new Date(retryReadyAt).toISOString())} 後重試。
              </Text>
            )}
          </View>
        </AICard>
      )}

      {incomplete && (
        <View style={styles.section}>
          <Text accessibilityRole="alert" style={[styles.text, { color: aiTokens.danger }]}>
            {resultMessage(incomplete)}
          </Text>
          <Text style={mutedStyle}>查詢時間：{taiwanTime(incomplete.checkedAt)}（臺灣時間）</Text>
        </View>
      )}
      {completed && (
        <AICard style={{ marginHorizontal: 0 }}>
          <View style={styles.section}>
            <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={headingStyle}>
              導航建議已備妥
            </Text>
            <Text style={textStyle}>出發地：{completed.route.from.name}</Text>
            <Text style={textStyle}>目的地：{completed.route.to.name}</Text>
            <Text style={mutedStyle}>查詢時間：{taiwanTime(completed.checkedAt)}（臺灣時間）</Text>
            <Text style={mutedStyle}>
              {completed.sourceUpdatedAt
                ? `地點資料更新時間：${taiwanTime(completed.sourceUpdatedAt)}（臺灣時間）。這不是即時路況。`
                : '地點來源未提供更新時間；這不是即時路況。'}
            </Text>
            <AIButton label="開啟校園地圖" style={buttonStyle} onPress={openMap} />
          </View>
        </AICard>
      )}
      {plan && (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={headingStyle}>
            這次任務
          </Text>
          <Text style={mutedStyle}>已預覽傳送內容。</Text>
          <Text style={mutedStyle}>{sent ? '已確認規劃。' : '等待你同意並確認。'}</Text>
          {sent && (
            <Text accessibilityLiveRegion="polite" style={mutedStyle}>
              {phase === 'execute'
                ? '正在等待回覆。'
                : completed
                  ? '已備妥導航建議。'
                  : '尚未取得可用的導航建議。'}
            </Text>
          )}
        </View>
      )}
      {!completed && (
        <AIButton label="自行查地圖" variant="ghost" style={buttonStyle} onPress={openMap} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12, minWidth: 0 },
  section: { gap: 12, minWidth: 0 },
  text: { fontSize: 15, flexShrink: 1 },
  heading: { fontSize: 19, fontWeight: '700', flexShrink: 1 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 100, fontSize: 17 },
  place: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 6 },
  consent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    minHeight: 44,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  consentText: { flex: 1 },
  check: { fontSize: 20 },
});
