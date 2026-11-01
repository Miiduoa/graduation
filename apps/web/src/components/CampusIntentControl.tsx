'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import {
  interpretCampusRequest,
  type CampusIntentReason,
  type CampusIntentResult,
} from '@/lib/campusIntentClient';
import styles from './CampusIntentControl.module.css';

type Props = {
  uid: string;
  schoolId: string;
  utterance: string;
  onResult: (result: CampusSemanticResult) => void;
  onReset: () => void;
  onReview?: () => void;
};
const failureText: Record<CampusIntentReason, string> = {
  not_configured: '免費雲端服務尚未設定，可先使用基本捷徑。',
  rate_limited: '目前沒有可用額度或請求太頻繁，請稍後再試。',
  timeout: '這次等候已逾時，尚未取得可核對的結果。',
  provider_error: '雲端服務暫時無法回覆，請稍後再試。',
  invalid_response: '這次回覆無法核對，沒有採用其中的服務建議。',
  permission_changed: '校園權限已變更，請確認目前的學校與登入狀態。',
  account_changed: '帳號狀態已變更，請重新確認登入狀態。',
  canceled: '已停止等待，沒有採用稍後送達的回覆。',
};

function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function CampusIntentControl(props: Props) {
  return (
    <IntentConfirmation
      key={JSON.stringify([props.uid, props.schoolId, props.utterance])}
      {...props}
    />
  );
}

function IntentConfirmation({ uid, schoolId, utterance, onResult, onReset, onReview }: Props) {
  const text = utterance.trim();
  const [phase, setPhase] = useState<'draft' | 'review' | 'pending' | 'complete'>('draft');
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [checkedAt, setCheckedAt] = useState('');
  const active = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const currentId = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const titleId = useId();
  const consentId = useId();
  const invalidText =
    text.length > 400 ||
    Array.from(text).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  const usable = Boolean(uid && /^[A-Za-z0-9_-]{2,40}$/.test(schoolId) && text && !invalidText);

  useEffect(
    () => () => {
      sequence.current += 1;
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  useEffect(() => {
    if (phase === 'review') heading.current?.focus();
  }, [phase]);
  useLayoutEffect(() => {
    if (phase === 'draft' && returnFocus.current) {
      returnFocus.current = false;
      previewButton.current?.focus();
    }
  }, [phase]);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);

  function review() {
    if (!usable) return;
    onReview?.();
    currentId.current = null;
    setAccepted(false);
    setMessage('');
    setFailed(false);
    setCheckedAt('');
    setRemaining(0);
    setPhase('review');
  }
  function cancel() {
    sequence.current += 1;
    active.current?.abort();
    active.current = null;
    currentId.current = null;
    const wasPending = phase === 'pending';
    returnFocus.current = true;
    setPhase('draft');
    setAccepted(false);
    setFailed(false);
    setRemaining(0);
    setCheckedAt('');
    setMessage(
      wasPending
        ? '已停止等待。已送出的伺服器請求可能仍在處理，但這裡不會採用晚到回覆。'
        : '已取消這次傳送，文字仍可修改。',
    );
    onReset();
  }
  async function submit() {
    if (!usable || !accepted || phase !== 'review' || active.current || remaining > 0) return;
    const controller = new AbortController();
    const operation = ++sequence.current;
    active.current = controller;
    setPhase('pending');
    setMessage('正在請 Groq 建議服務入口…');
    setFailed(false);
    try {
      currentId.current ??= requestId();
      const result: CampusIntentResult = await interpretCampusRequest({
        uid,
        schoolId,
        utterance: text,
        requestId: currentId.current,
        consent: {
          version: 1,
          purpose: 'campus-service-entry',
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          schoolId,
          utterance: text,
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted || operation !== sequence.current) return;
      setCheckedAt(result.checkedAt || '');
      if (result.status === 'unavailable') {
        const reason = result.reason || 'invalid_response';
        setMessage(failureText[reason]);
        setRemaining(result.retryAfterSeconds || 0);
        setFailed(true);
        setPhase('review');
        if (reason === 'permission_changed' || reason === 'account_changed') {
          setAccepted(false);
          currentId.current = null;
          onReset();
        }
      } else {
        setPhase('complete');
        setMessage(
          result.status === 'clarify'
            ? '已取得需要補充的問題，請修改文字後重新確認。'
            : '已取得服務入口建議，請自行開啟要使用的服務。',
        );
        onResult(result);
      }
    } catch (error) {
      if (controller.signal.aborted || operation !== sequence.current) return;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const reason =
        code === 'unconfigured'
          ? 'not_configured'
          : code === 'rate-limited'
            ? 'rate_limited'
            : code === 'session-changed'
              ? 'account_changed'
              : code === 'invalid-response'
                ? 'invalid_response'
                : 'provider_error';
      setMessage(failureText[reason]);
      setFailed(true);
      setPhase('review');
      if (reason === 'account_changed') {
        setAccepted(false);
        currentId.current = null;
        onReset();
      }
    } finally {
      if (operation === sequence.current) active.current = null;
    }
  }

  if (!text) return null;
  return (
    <div className={styles.control}>
      <button
        ref={previewButton}
        type="button"
        className={styles.secondary}
        disabled={!usable || phase === 'pending'}
        onClick={() => {
          if (phase === 'complete') onReset();
          review();
        }}
      >
        {phase === 'draft' ? '查看傳送內容' : '重新確認內容'}
      </button>
      {!uid ? (
        <p className={styles.hint}>登入並選擇學校後，才能確認使用雲端建議；基本捷徑仍可使用。</p>
      ) : !/^[A-Za-z0-9_-]{2,40}$/.test(schoolId) ? (
        <p className={styles.hint}>請先選擇學校；目前仍可使用基本捷徑。</p>
      ) : invalidText ? (
        <p role="alert" className={styles.hint}>
          請將文字改為 400 字以內的單行內容，再確認傳送。
        </p>
      ) : null}
      {phase !== 'draft' && (
        <section
          className={styles.disclosure}
          aria-labelledby={titleId}
          aria-busy={phase === 'pending'}
        >
          <h3 ref={heading} id={titleId} tabIndex={-1}>
            確認傳送內容
          </h3>
          <dl>
            <div>
              <dt>供應商</dt>
              <dd>Groq（openai/gpt-oss-120b）</dd>
            </div>
            <div>
              <dt>用途</dt>
              <dd>建議由你開啟的校園服務入口</dd>
            </div>
            <div>
              <dt>校園代碼</dt>
              <dd>{schoolId}</dd>
            </div>
            <div>
              <dt>本次文字</dt>
              <dd className={styles.utterance}>{text}</dd>
            </div>
          </dl>
          <p>
            只傳送上面的文字與校園代碼，不附加帳號識別碼、個人資料、課表、作業或對話紀錄。文字內若有個資，請先自行刪除。
          </p>
          <p>
            這一步不讀取私人紀錄，也不會提交、付款或修改資料。沒有免費額度時會停止，不轉往其他供應商或本機模型。
          </p>
          {phase !== 'complete' && (
            <>
              <label className={styles.consent} htmlFor={consentId}>
                <input
                  id={consentId}
                  type="checkbox"
                  checked={accepted}
                  disabled={phase === 'pending'}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span>我同意將以上文字與校園代碼傳給 Groq</span>
              </label>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!accepted || phase === 'pending' || remaining > 0}
                  onClick={() => void submit()}
                >
                  {phase === 'pending' ? '正在取得建議…' : failed ? '重新傳送' : '確認並找入口'}
                </button>
                <button type="button" className={styles.secondary} onClick={cancel}>
                  {phase === 'pending' ? '停止等待' : '取消'}
                </button>
              </div>
            </>
          )}
          {remaining > 0 && (
            <p className={styles.hint}>請等候 {remaining} 秒後再手動重試，不會自動傳送。</p>
          )}
          {checkedAt && (
            <p className={styles.hint}>
              本站處理時間：
              <time dateTime={checkedAt}>
                {new Date(checkedAt).toLocaleString('zh-TW', {
                  timeZone: 'Asia/Taipei',
                  hour12: false,
                })}
                （台灣時間）
              </time>
              。這不是服務資料的更新時間。
            </p>
          )}
        </section>
      )}
      {message && (
        <p role="status" className={styles.hint}>
          {message}
        </p>
      )}
    </div>
  );
}
