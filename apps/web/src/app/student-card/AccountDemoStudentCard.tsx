'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { parseAccountDemoSnapshot, type AccountDemoSnapshot } from '@campus/shared/src/accountDemo';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import { maskStudentId, STUDENT_CARD_TTL_MS } from '@campus/shared/src/studentCard';
import { browserRequest } from '@/features/nuni/Session';
import styles from './studentCard.module.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; demo: AccountDemoSnapshot | null };
type Presentation = { mode: 'number' | 'code'; demo: AccountDemoSnapshot };

function readCardResult(result: unknown, accountId: string): AccountDemoSnapshot | null {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !('demo' in result))
    throw new Error('Invalid account demonstration');
  const demo = result.demo === null ? null : parseAccountDemoSnapshot(result.demo);
  if (demo && demo.accountId !== accountId) throw new Error('Account changed');
  return demo;
}

/** Mounted with an account/context/school key, so an old request can never restore another card. */
export function AccountDemoStudentCard({
  accountId,
  context,
  schoolId,
  fallback,
}: {
  accountId: string;
  context: string;
  schoolId: string;
  fallback: ReactNode;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [preparing, setPreparing] = useState(false);
  const mounted = useRef(false);
  const presentationGeneration = useRef(0);
  const presentationLock = useRef(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const demo = readCardResult(await browserRequest('account-demo', context), accountId);
        if (active) {
          setNow(Date.now());
          setState({ status: 'ready', demo });
        }
      } catch {
        if (active) setState({ status: 'error' });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [accountId, context, attempt]);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const dismiss = () => {
      presentationGeneration.current += 1;
      presentationLock.current = false;
      setPreparing(false);
      setPresentation(null);
    };
    const refresh = () => {
      dismiss();
      if (document.hidden) return;
      setState({ status: 'loading' });
      setAttempt((value) => value + 1);
    };
    window.addEventListener('blur', dismiss);
    window.addEventListener('pagehide', dismiss);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      mounted.current = false;
      presentationGeneration.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('pagehide', dismiss);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  async function present(mode: Presentation['mode']) {
    if (presentationLock.current || state.status !== 'ready' || !state.demo || document.hidden)
      return;
    presentationLock.current = true;
    const current = ++presentationGeneration.current;
    const isCurrent = () => mounted.current && current === presentationGeneration.current;
    setPreparing(true);
    setPresentation(null);
    try {
      // Every new presentation revalidates the server session and the current card permission.
      const fresh = readCardResult(await browserRequest('account-demo', context), accountId);
      if (!isCurrent()) return;
      setNow(Date.now());
      setState({ status: 'ready', demo: fresh });
      if (
        !fresh ||
        !fresh.permissions.studentCard ||
        Date.parse(fresh.expiresAt) <= Date.now() ||
        toPublicSchoolId(fresh.profile.schoolId) !== schoolId ||
        document.hidden
      )
        return;
      setPresentation({ mode, demo: fresh });
    } catch {
      if (isCurrent()) setState({ status: 'error' });
    } finally {
      if (isCurrent()) {
        presentationLock.current = false;
        setPreparing(false);
      }
    }
  }

  if (state.status === 'loading') {
    return (
      <section className={styles.message} role="status">
        正在讀取帳號學生證…
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <section className={styles.message} role="alert">
        <h2>暫時無法讀取展示學生證</h2>
        <p>請確認網路連線後重新讀取。</p>
        <button
          className={styles.button}
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        >
          重新讀取
        </button>
      </section>
    );
  }
  const demo = state.demo;
  if (!demo) return fallback;
  const expired = Date.parse(demo.expiresAt) <= now;
  const sameSchool = toPublicSchoolId(demo.profile.schoolId) === schoolId;
  if (expired || !demo.permissions.studentCard || !sameSchool) {
    return (
      <section className={styles.message}>
        <h2>
          {expired ? '展示資料已到期' : !sameSchool ? '請切回展示帳號的學校' : '學生證展示尚未開啟'}
        </h2>
        <p>
          {!sameSchool && !expired
            ? `這張展示學生證屬於${demo.profile.schoolName}，從上方切換學校後即可查看。`
            : '到設定頁確認學生證的開啟狀態。'}
        </p>
        <Link
          className={styles.link}
          href={`/settings?campus=${encodeURIComponent(toPublicSchoolId(demo.profile.schoolId) || demo.profile.schoolId)}&section=platform#account-demo-permissions`}
        >
          學生證設定
        </Link>
      </section>
    );
  }
  return (
    <>
      <DemoWallet key={demo.revision} demo={demo} preparing={preparing} onPresent={present} />
      {presentation && (
        <DemoPresentation
          key={presentation.mode}
          demo={presentation.demo}
          mode={presentation.mode}
          onClose={() => setPresentation(null)}
        />
      )}
    </>
  );
}

function DemoWallet({
  demo,
  preparing,
  onPresent,
}: {
  demo: AccountDemoSnapshot;
  preparing: boolean;
  onPresent: (mode: Presentation['mode']) => Promise<void>;
}) {
  const { profile } = demo;
  const hideNumber = (text: string) =>
    text.replaceAll(profile.studentId, maskStudentId(profile.studentId));
  return (
    <>
      <div className={styles.wallet}>
        <article className={styles.card} aria-label="展示學生證">
          <div className={styles.cardHeader}>
            <strong>nuni</strong>
            <span>展示學生證</span>
          </div>
          <h2>{profile.schoolName}</h2>
          <div className={styles.identity}>
            <div className={styles.monogram} aria-hidden="true">
              {Array.from(hideNumber(profile.displayName))[0]}
            </div>
            <div>
              <p className={styles.name}>{hideNumber(profile.displayName)}</p>
              <p className={styles.department}>{hideNumber(profile.department)}</p>
            </div>
          </div>
          <div className={styles.cardBottom}>
            <div>
              <span>展示學號</span>
              <p>{maskStudentId(profile.studentId)}</p>
            </div>
            <span className={styles.source}>DEMO</span>
          </div>
        </article>
        <div className={styles.actions}>
          <button
            className={styles.button}
            disabled={preparing}
            onClick={() => void onPresent('code')}
          >
            出示展示 QR Code
          </button>
          <button
            className={styles.secondary}
            disabled={preparing}
            onClick={() => void onPresent('number')}
          >
            出示學號
          </button>
        </div>
        {preparing && (
          <p className={styles.note} role="status">
            正在確認學生證使用權限…
          </p>
        )}
        <p className={styles.note}>這張卡使用你的帳號展示資料，出示後會在 60 秒內自動收起。</p>
        <p className={styles.edit}>
          <Link
            href={`/settings?campus=${encodeURIComponent(toPublicSchoolId(profile.schoolId) || profile.schoolId)}&section=platform#account-demo-permissions`}
          >
            學生證設定
          </Link>
        </p>
      </div>
      <aside className={styles.guide}>
        <p className={styles.eyebrow}>學生證展示</p>
        <h2>從卡面到出示，一次走完</h2>
        <ol>
          <li>
            <strong>打開自己的卡片</strong>
            <span>姓名、系所與展示學號跟著目前登入的帳號。</span>
          </li>
          <li>
            <strong>出示學號或展示 QR Code</strong>
            <span>QR Code 帶有獨立的展示標記，卡面清楚標示 DEMO。</span>
          </li>
          <li>
            <strong>完成後收起</strong>
            <span>離開頁面、切換視窗或時間到，完整學號會自動隱藏。</span>
          </li>
        </ol>
      </aside>
    </>
  );
}

function DemoPresentation({
  demo,
  mode,
  onClose,
}: {
  demo: AccountDemoSnapshot;
  mode: 'number' | 'code';
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  const [expiresAt] = useState(() =>
    Math.min(Date.parse(demo.expiresAt), Date.now() + STUDENT_CARD_TTL_MS),
  );
  const [now, setNow] = useState(Date.now);
  const [image, setImage] = useState('');
  const [error, setError] = useState(false);
  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (remaining === 0) close.current();
  }, [remaining]);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const dismiss = () => close.current();
    const visibility = () => {
      if (document.hidden) dismiss();
    };
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    const deadline = window.setTimeout(dismiss, Math.max(0, expiresAt - Date.now()));
    window.addEventListener('blur', dismiss);
    window.addEventListener('pagehide', dismiss);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(deadline);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('pagehide', dismiss);
      document.removeEventListener('visibilitychange', visibility);
      element.close();
    };
  }, [expiresAt]);

  useEffect(() => {
    if (mode !== 'code') return;
    let active = true;
    // A dedicated marker prevents this payload from ever being a real student-card credential.
    const payload = `nuni-demo-card:v1:${demo.profile.schoolId}:${demo.profile.studentId}:${expiresAt}`;
    void QRCode.toDataURL(payload, {
      width: 512,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#102D24', light: '#FFFFFF' },
    })
      .then((value) => {
        if (active && expiresAt > Date.now()) setImage(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [demo.profile.schoolId, demo.profile.studentId, expiresAt, mode]);

  return (
    <dialog
      ref={dialog}
      className={styles.presentation}
      aria-labelledby="demo-presentation-title"
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
    >
      <div className={styles.sheet}>
        <span className={styles.sheetBrand}>nuni</span>
        <p className={styles.sheetSchool}>{demo.profile.schoolName}</p>
        <h2 id="demo-presentation-title">
          展示學生證 · {mode === 'code' ? 'QR Code' : '出示學號'}
        </h2>
        {error ? (
          <p className={styles.sheetNote} role="alert">
            QR Code 尚未載入，請收起後再試。
          </p>
        ) : mode === 'code' && !image ? (
          <p className={styles.sheetNote} role="status">
            正在準備展示 QR Code…
          </p>
        ) : (
          remaining > 0 && (
            <>
              {image && (
                <img
                  className={styles.qr}
                  src={image}
                  alt="DEMO 展示學生證 QR Code"
                  width={256}
                  height={256}
                />
              )}
              <p className={styles.number}>{demo.profile.studentId}</p>
              <p className={styles.sheetNote}>展示資料 · DEMO</p>
              <p className={styles.timer} aria-label={`剩餘 ${remaining} 秒`}>
                {remaining} 秒後自動收起
              </p>
            </>
          )
        )}
        <button className={styles.close} onClick={() => close.current()} autoFocus>
          收起學生證
        </button>
      </div>
    </dialog>
  );
}
