'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  getCloudNavigationPreview, runCloudNavigationTask,
  type CloudNavigationPreviewResult, type CloudNavigationResult,
} from '@/lib/cloudNavigationClient';
import styles from './CloudNavigationTask.module.css';

type Props = { userId: string; schoolId: string; initialDraft?: string };
type Plan = Extract<CloudNavigationPreviewResult, { status: 'preview' }> & { requestId: string };
type IncompleteResult = Exclude<CloudNavigationResult, { status: 'completed' }>;

function failureMessage(failure: unknown, phase: 'preview' | 'execute'): string {
  const code = (failure as { code?: string } | null)?.code;
  if (code === 'unconfigured') return '雲端導航尚未啟用，請先用校園地圖查詢。';
  if (code === 'session-changed' || code === 'functions/unauthenticated') {
    return '登入狀態已變更，請重新登入並預覽後，再確認規劃。';
  }
  if (code === 'functions/permission-denied') return '目前帳號無法查詢這個校園，請重新確認登入狀態。';
  if (code === 'invalid-response') return '這次回覆未通過檢查，沒有產生導航連結。你可以重試。';
  if (code === 'functions/resource-exhausted') return '目前查詢較多，請稍候再試。你的輸入已保留。';
  return phase === 'preview'
    ? '這次未能讀取公開地點。你的輸入已保留，請重新預覽。'
    : '這次未能取得導航建議。你的輸入已保留，可以稍後重試。';
}

function resultMessage(result: IncompleteResult): string {
  switch (result.reason) {
    case 'not_configured': return '雲端導航尚未啟用，請先用校園地圖查詢。';
    case 'rate_limited': return '目前查詢較多，請稍候再試。你的輸入已保留。';
    case 'timeout': return '這次查詢逾時，尚未取得導航建議。你可以重試。';
    case 'canceled': return '已停止等待。已送出的雲端查詢不一定能立即中止。';
    case 'no_places': return '這個校園目前沒有可用的公開地點資料，請改用校園地圖。';
    case 'ambiguous_places': return '還無法確定起點或終點，請補上完整地點名稱後重新預覽。';
    case 'source_changed': return '地點資料已變更，請重新預覽後再規劃。';
    case 'permission_changed': return '帳號或校園權限已變更，請重新確認登入狀態。';
    case 'invalid_response': return '這次回覆未通過檢查，沒有產生導航連結。你可以重試。';
    default: return '這次未能取得導航建議。你的輸入已保留，可以稍後重試。';
  }
}

function taiwanTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未提供';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

export function CloudNavigationTask(props: Props) {
  // A different account or campus must never inherit consent, results, or pending work.
  return <NavigationSession key={JSON.stringify([props.userId, props.schoolId])} {...props} />;
}

function NavigationSession({ userId, schoolId, initialDraft = '' }: Props) {
  const id = useId();
  const [draft, setDraft] = useState(initialDraft);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [consented, setConsented] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [result, setResult] = useState<CloudNavigationResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retryReadyAt, setRetryReadyAt] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  useEffect(() => {
    if (retryReadyAt === null) return;
    const timer = window.setTimeout(() => setRetryReadyAt(null), Math.max(0, retryReadyAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryReadyAt]);

  useEffect(() => {
    if (plan) previewHeading.current?.focus();
  }, [plan]);

  function stopWaiting() {
    request.current?.abort();
    request.current = null;
    setPending(false);
    setPreviewing(false);
  }

  function changeDraft(value: string) {
    const wasPending = pending;
    stopWaiting();
    setDraft(value);
    setPlan(null);
    setConsented(false);
    setResult(null);
    setSent(false);
    setError('');
    setRetryReadyAt(null);
    setNotice(wasPending ? '已停止等待上一筆查詢。已送出的雲端查詢不一定能立即中止。' : '');
  }

  async function preview(event: FormEvent) {
    event.preventDefault();
    if (request.current) return;
    const query = draft.trim();
    if (!query || query.length > 240) {
      setError(!query ? '請先輸入出發地與目的地。' : '請將輸入縮短至 240 字以內。');
      composer.current?.focus();
      return;
    }
    const previousPlan = plan;
    const controller = new AbortController();
    request.current = controller;
    setPreviewing(true);
    setPlan(null);
    setConsented(false);
    setResult(null);
    setSent(false);
    setError('');
    setNotice('');
    try {
      const response = await getCloudNavigationPreview({ userId, schoolId, query }, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      if (response.schoolId !== schoolId || (response.status === 'preview' && response.query !== query)) {
        setError('校園資料或輸入已變更，請重新預覽。');
        return;
      }
      if (response.status !== 'preview') {
        setResult(response);
        return;
      }
      if (response.places.length < 2) {
        setError('這個校園目前沒有可用的公開地點資料，請改用校園地圖。');
        return;
      }
      setPlan({
        ...response,
        requestId: previousPlan?.query === query && previousPlan.fingerprint === response.fingerprint
          ? previousPlan.requestId : crypto.randomUUID(),
      });
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller) {
        setError(failureMessage(failure, 'preview'));
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPreviewing(false);
      }
    }
  }

  async function run() {
    if (!plan || !plan.cloudReady || !consented || request.current || retryReadyAt !== null) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setSent(true);
    setResult(null);
    setError('');
    setNotice('');
    try {
      const response = await runCloudNavigationTask({
        userId, schoolId, query: plan.query, requestId: plan.requestId,
        consent: { provider: 'groq', version: 1, schoolId, query: plan.query, fingerprint: plan.fingerprint },
      }, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      if (response.schoolId !== schoolId) {
        setError('校園資料已變更，請重新預覽後再規劃。');
        setConsented(false);
        setPlan(null);
        return;
      }
      setResult(response);
      if (response.status !== 'completed') {
        if (response.reason === 'source_changed' || response.reason === 'permission_changed') {
          setConsented(false);
        }
        if (response.reason === 'rate_limited' && response.retryAfterSeconds && response.retryAfterSeconds > 0) {
          setRetryReadyAt(Date.now() + response.retryAfterSeconds * 1000);
        }
      }
    } catch (failure) {
      if (!controller.signal.aborted && request.current === controller) {
        setError(failureMessage(failure, 'execute'));
        const code = (failure as { code?: string } | null)?.code;
        if (code === 'session-changed' || code === 'unconfigured' ||
          code === 'functions/unauthenticated' || code === 'functions/permission-denied') {
          setConsented(false);
          setPlan(null);
        }
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  function cancel() {
    const wasPreviewing = previewing;
    stopWaiting();
    setConsented(false);
    setResult(null);
    setNotice(wasPreviewing
      ? '已停止讀取公開地點。你的輸入已保留。'
      : '已停止等待。已送出的雲端查詢不一定能立即中止。你的輸入已保留。');
    composer.current?.focus();
  }

  const completed = result?.status === 'completed' ? result : null;
  const incomplete = result && result.status !== 'completed' ? result : null;
  const needsNewPreview = incomplete?.reason === 'source_changed' || incomplete?.reason === 'permission_changed';

  return (
    <section className={styles.task} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <h2 id={`${id}-title`}>規劃校園步行路線</h2>
        <p>輸入出發地與目的地，確認內容後，由 Groq 協助辨識校園地點。</p>
      </header>

      <form aria-label="預覽導航查詢" onSubmit={preview} className={styles.composer}>
        <label htmlFor={`${id}-query`}>出發地與目的地</label>
        <textarea
          ref={composer} id={`${id}-query`} value={draft} maxLength={240} rows={3}
          placeholder="例如：從圖書館走到活動中心"
          aria-describedby={`${id}-input-note ${id}-count`}
          onChange={(event) => changeDraft(event.target.value)}
        />
        <div className={styles.inputMeta}>
          <p id={`${id}-input-note`}>請只填地點，不要填入姓名、學號或其他私人資訊。</p>
          <span id={`${id}-count`}>{draft.length}／240 字</span>
        </div>
        <div className={styles.actions}>
          <button type="submit" className={styles.secondary} disabled={pending || previewing}>
            {previewing ? '讀取公開地點…' : '預覽傳送內容'}
          </button>
          {previewing && <button type="button" className={styles.secondary} onClick={cancel}>取消讀取</button>}
        </div>
        {previewing && <p role="status">正在讀取 Campus One 的公開地點資料，尚未傳送至 Groq。</p>}
      </form>

      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}

      {plan && (
        <section className={styles.preview} aria-label="雲端查詢預覽">
          <h3 ref={previewHeading} tabIndex={-1}>確認這次傳送的內容</h3>
          <dl className={styles.facts}>
            <div><dt>雲端服務</dt><dd>Groq（openai/gpt-oss-120b）</dd></div>
            <div><dt>校園代碼</dt><dd>{schoolId}</dd></div>
            <div><dt>你的輸入</dt><dd className={styles.query}>{plan.query}</dd></div>
          </dl>
          <p>會傳送這次的輸入、校園代碼，以及以下地點的名稱、分類與別名，協助辨識起點與終點。</p>
          <details className={styles.places} open>
            <summary>本次提供的公開地點（{plan.places.length} 處）</summary>
            <ul>{plan.places.map((place) => <li key={place.ref}>
              <strong>{place.name}</strong><span>分類：{place.category}</span>
              {place.aliases.length > 0 && <span>別名：{place.aliases.join('、')}</span>}
            </li>)}</ul>
          </details>
          <p className={styles.muted}>不會附加座標、帳號識別碼、課表、作業或對話紀錄。</p>
          <p className={styles.muted}>公開地點查詢時間：<time dateTime={plan.checkedAt}>{taiwanTime(plan.checkedAt)}</time>（臺灣時間）</p>
          <p className={styles.muted}>{plan.sourceUpdatedAt
            ? <>地點資料更新時間：<time dateTime={plan.sourceUpdatedAt}>{taiwanTime(plan.sourceUpdatedAt)}</time>（臺灣時間）</>
            : '地點來源未提供更新時間。'}</p>
          {!plan.cloudReady && <p role="status">雲端導航尚未設定，目前只能預覽，請先用校園地圖查詢。</p>}
          <label className={styles.consent}>
            <input type="checkbox" checked={consented} disabled={pending || needsNewPreview || !plan.cloudReady}
              onChange={(event) => setConsented(event.target.checked)} />
            <span>我同意將上述內容傳送至 Groq，進行這次規劃。</span>
          </label>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={run}
              disabled={!consented || pending || completed !== null || retryReadyAt !== null || needsNewPreview || !plan.cloudReady}>
              {pending ? '正在規劃…' : sent && !completed ? '重試規劃' : '確認規劃'}
            </button>
            {pending && <button type="button" className={styles.secondary} onClick={cancel}>取消等待</button>}
          </div>
          {pending && <div role="status" className={styles.muted}>
            <p>正在查詢，等待導航建議。</p>
            <p>取消會停止本頁等待；已送出的雲端查詢不一定能立即中止。</p>
          </div>}
          {retryReadyAt !== null && <p role="status" className={styles.muted}>
            可於臺灣時間 {taiwanTime(new Date(retryReadyAt).toISOString())} 後重試。
          </p>}
        </section>
      )}

      {incomplete && <div role="alert" className={styles.error}>
        <p>{resultMessage(incomplete)}</p>
        <p className={styles.muted}>查詢時間：<time dateTime={incomplete.checkedAt}>{taiwanTime(incomplete.checkedAt)}</time>（臺灣時間）</p>
      </div>}

      {completed && (
        <section aria-label="導航建議" className={styles.route}>
          <h3>導航建議已備妥</h3>
          <dl className={styles.facts}>
            <div><dt>出發地</dt><dd>{completed.route.from.name}</dd></div>
            <div><dt>目的地</dt><dd>{completed.route.to.name}</dd></div>
          </dl>
          <a className={styles.primary} href={completed.route.navigationUrl} target="_blank" rel="noopener noreferrer">
            開啟 Google 地圖步行導航（另開分頁）
          </a>
          <p className={styles.muted}>查詢時間：<time dateTime={completed.checkedAt}>{taiwanTime(completed.checkedAt)}</time>（臺灣時間）</p>
          <p className={styles.muted}>{completed.sourceUpdatedAt
            ? <>地點資料更新時間：<time dateTime={completed.sourceUpdatedAt}>{taiwanTime(completed.sourceUpdatedAt)}</time>（臺灣時間）。這不是即時路況。</>
            : '地點來源未提供更新時間；這不是即時路況。'}</p>
        </section>
      )}

      {plan && <section aria-label="本頁任務紀錄" className={styles.record} aria-busy={pending}>
        <h3>這次任務</h3>
        <ol>
          <li>已預覽傳送內容。</li>
          <li>{sent ? '已確認規劃。' : '等待你同意並確認。'}</li>
          {sent && <li>{pending ? '正在等待回覆。' : completed ? '已備妥導航連結。' : '尚未取得可用的導航建議。'}</li>}
        </ol>
      </section>}
      <a className={styles.mapLink} href={`/map?campus=${encodeURIComponent(schoolId)}`}>自行開啟校園地圖</a>
    </section>
  );
}
