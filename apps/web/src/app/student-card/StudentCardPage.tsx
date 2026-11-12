'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import QRCode from 'qrcode';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import { SiteShell } from '@/components/SiteShell';
import { getAuth, getDb } from '@/lib/firebase';
import { useOptionalNuniSession } from '@/features/nuni/Session';
import { AccountDemoStudentCard } from './AccountDemoStudentCard';
import { toPublicSchoolId } from '@campus/shared/src/schoolIds';
import {
  getStudentCardService,
  isStudentCardToken,
  maskStudentId,
  STUDENT_CARD_TTL_MS,
} from '@campus/shared/src/studentCard';
import styles from './studentCard.module.css';

type Profile = {
  displayName: string;
  studentId: string;
  department: string;
  schoolId: string;
  role: string;
};
type CardCode = { image: string; studentId: string; expiresAt: number };
type CardState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; profile: Profile | null };

function readProfile(data: Record<string, unknown>): Profile {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 120) : '');
  return {
    displayName: text(data.displayName),
    studentId: text(data.studentId),
    department: text(data.department),
    schoolId: text(data.schoolId || data.primarySchoolId),
    role: text(data.role),
  };
}

function OfficialService({ schoolId }: { schoolId: string | null }) {
  const service = getStudentCardService(schoolId);
  if (!service)
    return (
      <section className={styles.service}>
        <p className={styles.eyebrow}>校方服務</p>
        <h2>使用校方核發的證件</h2>
        <p>門禁、借書與在學證明，請依學校提供的證件與使用規定辦理。</p>
      </section>
    );
  const ios = getStudentCardService(schoolId, 'ios');
  const android = getStudentCardService(schoolId, 'android');
  return (
    <section className={styles.service}>
      <p className={styles.eyebrow}>校方服務</p>
      <h2>{service.name}</h2>
      <p>{service.detail}</p>
      <div className={styles.links}>
        <a className={styles.link} href={service.url} target="_blank" rel="noopener noreferrer">
          開啟校方服務
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M6 18 18 6M6 6h12v12" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </a>
        {ios?.url !== service.url && (
          <a href={ios?.url} target="_blank" rel="noopener noreferrer">
            iPhone 下載
          </a>
        )}
        {android?.url !== service.url && (
          <a href={android?.url} target="_blank" rel="noopener noreferrer">
            Android 下載
          </a>
        )}
      </div>
    </section>
  );
}

export function StudentCardPage() {
  const { user, loading } = useAuth();
  const platform = useOptionalNuniSession();
  const school = useSelectedSchool();
  const schoolId = toPublicSchoolId(school.selectedSchoolId);
  const ready =
    !loading && !platform?.loading && !school.loading && school.catalogStatus === 'ready';
  const platformSession =
    platform && !platform.pendingLogout && !platform.error ? platform.session : null;
  const card =
    !user || user.isAnonymous ? (
      <section className={styles.message}>
        <h2>把學號放進隨身卡片</h2>
        <p>使用學校帳號登入後，可查看個人資料並取得學號驗證碼。</p>
        <Link
          className={styles.button}
          href={'/login?returnUrl=' + encodeURIComponent('/student-card?campus=' + schoolId)}
        >
          登入學校帳號
        </Link>
      </section>
    ) : schoolId ? (
      <AccountCard
        key={user.uid + ':' + schoolId}
        user={user}
        schoolId={schoolId}
        schoolName={school.selectedSchool?.name || '我的學校'}
      />
    ) : null;
  return (
    <SiteShell title="數位學生證" subtitle="需要出示學號時，打開這張卡。" compactHeading>
      <div className={styles.page}>
        {!ready ? (
          <p role="status">正在確認帳號與學校…</p>
        ) : !schoolId || school.requestedUnavailable ? (
          <section className={styles.message}>
            <h2>先選擇你的學校</h2>
            <p>從頁面上方選擇學校，查看你的卡片與校方服務。</p>
          </section>
        ) : platformSession ? (
          <AccountDemoStudentCard
            key={JSON.stringify([
              platformSession.platformAccountId,
              platformSession.context,
              schoolId,
            ])}
            accountId={platformSession.platformAccountId}
            context={platformSession.context}
            schoolId={schoolId}
            fallback={card}
          />
        ) : (
          card
        )}
        {ready && <OfficialService schoolId={schoolId} />}
      </div>
    </SiteShell>
  );
}

function AccountCard({
  user,
  schoolId,
  schoolName,
}: {
  user: User;
  schoolId: string;
  schoolName: string;
}) {
  const [state, setState] = useState<CardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const db = getDb();
        if (!db) throw new Error('Profile unavailable');
        const result = await getDocFromServer(doc(db, 'users', user.uid));
        if (active && getAuth()?.currentUser?.uid === user.uid)
          setState({
            status: 'ready',
            profile: result.exists() ? readProfile(result.data()) : null,
          });
      } catch {
        if (active) setState({ status: 'error' });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [user.uid, attempt]);

  if (state.status === 'loading')
    return (
      <section className={styles.message} role="status">
        正在讀取學生證資料…
      </section>
    );
  if (state.status === 'error')
    return (
      <section className={styles.message} role="alert">
        <h2>暫時無法讀取卡片</h2>
        <p>請確認網路連線後再試一次。</p>
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
  const profile = state.profile;
  if (!profile)
    return (
      <section className={styles.message}>
        <h2>補上你的學生資料</h2>
        <p>目前尚未取得個人檔案，可先到帳號設定確認。</p>
        <Link className={styles.link} href="/settings">
          開啟帳號設定
        </Link>
      </section>
    );
  if (toPublicSchoolId(profile.schoolId) !== schoolId)
    return (
      <section className={styles.message}>
        <h2>請切回帳號所屬學校</h2>
        <p>這張卡片的學校與目前瀏覽的學校不同。從上方切換學校後即可查看。</p>
      </section>
    );
  if (profile.role !== 'student')
    return (
      <section className={styles.message}>
        <h2>學生帳號專用</h2>
        <p>數位學生證提供學生帳號使用。其他校園身分可開啟下方校方服務。</p>
      </section>
    );
  return (
    <Wallet
      key={profile.studentId}
      user={user}
      profile={profile}
      schoolId={schoolId}
      schoolName={schoolName}
    />
  );
}

function Wallet({
  user,
  profile,
  schoolId,
  schoolName,
}: {
  user: User;
  profile: Profile;
  schoolId: string;
  schoolName: string;
}) {
  const [presentation, setPresentation] = useState<'number' | 'code' | null>(null);
  const studentId = profile.studentId;
  const hideNumber = (value: string) =>
    studentId ? value.replaceAll(studentId, maskStudentId(studentId)) : value;
  const demo = /^(demo|test)-/.test(user.uid) || user.email?.endsWith('@test.campus-one.local');
  return (
    <>
      <div className={styles.wallet}>
        <article className={styles.card} aria-label="學生證個人資料">
          <div className={styles.cardHeader}>
            <strong>nuni</strong>
            <span>數位學生證</span>
          </div>
          <h2>{schoolName}</h2>
          <div className={styles.identity}>
            <div className={styles.monogram} aria-hidden="true">
              {Array.from(hideNumber(profile.displayName) || '學')[0]}
            </div>
            <div>
              <p className={styles.name}>{hideNumber(profile.displayName) || '我的學生證'}</p>
              <p className={styles.department}>
                {hideNumber(profile.department) || '系所尚未填寫'}
              </p>
            </div>
          </div>
          <div className={styles.cardBottom}>
            <div>
              <span>學號</span>
              <p>{maskStudentId(studentId) || '尚未填寫'}</p>
            </div>
            <span className={styles.source}>個人檔案</span>
          </div>
        </article>
        <div className={styles.actions}>
          <button className={styles.button} disabled={demo} onClick={() => setPresentation('code')}>
            取得驗證碼
          </button>
          <button
            className={styles.secondary}
            disabled={!studentId}
            onClick={() => setPresentation('number')}
          >
            出示學號
          </button>
        </div>
        <p className={styles.note}>
          {demo
            ? '此帳號為示範資料。'
            : '卡面來自你的個人檔案。驗證碼會另外向學校登入資料核對學號。'}
        </p>
        <p className={styles.edit}>
          <Link href="/settings">更新個人資料</Link>
        </p>
      </div>
      <aside className={styles.guide}>
        <p className={styles.eyebrow}>出示時</p>
        <h2>需要的時候，才顯示</h2>
        <ol>
          <li>
            <strong>取得一組限時驗證碼</strong>
            <span>由校園登入資料提供學號，有效時間為 60 秒。</span>
          </li>
          <li>
            <strong>讓對方掃碼核對</strong>
            <span>對方只會看到學校與學號末四碼，每組限用一次。</span>
          </li>
          <li>
            <strong>完成後收起卡片</strong>
            <span>切換視窗或離開頁面時，顯示的學號會自動收起。</span>
          </li>
        </ol>
      </aside>
      {presentation && (
        <Presentation
          key={presentation}
          user={user}
          schoolId={schoolId}
          schoolName={schoolName}
          studentId={studentId}
          mode={presentation}
          onClose={() => setPresentation(null)}
        />
      )}
    </>
  );
}

function Presentation({
  user,
  schoolId,
  schoolName,
  studentId,
  mode,
  onClose,
}: {
  user: User;
  schoolId: string;
  schoolName: string;
  studentId: string;
  mode: 'number' | 'code';
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  const [code, setCode] = useState<CardCode | null>(null);
  const [error, setError] = useState('');
  const [started] = useState(Date.now);
  const [now, setNow] = useState(started);
  const expiresAt = code?.expiresAt ?? started + STUDENT_CARD_TTL_MS;
  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));

  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    function dismiss() {
      close.current();
    }
    function visibility() {
      if (document.hidden) dismiss();
    }
    window.addEventListener('blur', dismiss);
    window.addEventListener('pagehide', dismiss);
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('pagehide', dismiss);
      document.removeEventListener('visibilitychange', visibility);
      element.close();
    };
  }, []);
  useEffect(() => {
    if (remaining === 0) close.current();
  }, [remaining]);

  useEffect(() => {
    if (mode !== 'code') return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setError('連線逾時，請收起後再試一次。');
    }, 15000);
    async function issue() {
      try {
        const bearer = await user.getIdToken();
        if (controller.signal.aborted || getAuth()?.currentUser?.uid !== user.uid) return;
        const response = await fetch('/api/student-card/present', {
          method: 'POST',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
          body: JSON.stringify({ schoolId }),
        });
        if (controller.signal.aborted || getAuth()?.currentUser?.uid !== user.uid) return;
        if (!response.ok) {
          const message =
            response.status === 401
              ? '請重新登入學校帳號，再取得驗證碼。'
              : response.status === 403
                ? '這個帳號目前沒有可核對的校園學號，請使用校方證件。'
                : response.status === 429
                  ? '申請次數過於頻繁，請稍候再試。'
                  : '暫時無法取得驗證碼，請稍後再試。';
          throw new Error(message);
        }
        const result = await response.json();
        if (controller.signal.aborted || getAuth()?.currentUser?.uid !== user.uid) return;
        if (
          !isStudentCardToken(result.token) ||
          typeof result.studentId !== 'string' ||
          !result.studentId.trim() ||
          !Number.isSafeInteger(result.expiresAt) ||
          result.expiresAt <= Date.now() ||
          result.expiresAt > Date.now() + STUDENT_CARD_TTL_MS + 5000
        )
          throw new Error('驗證碼無法使用，請重新取得。');
        const image = await QRCode.toDataURL(
          window.location.origin + '/student-card/verify#' + result.token,
          {
            width: 512,
            margin: 4,
            errorCorrectionLevel: 'M',
            color: { dark: '#102D24', light: '#FFFFFF' },
          },
        );
        if (!controller.signal.aborted && getAuth()?.currentUser?.uid === user.uid) {
          setNow(Date.now());
          setCode({ image, studentId: result.studentId, expiresAt: result.expiresAt });
        }
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : '連線中斷，請收起後再試。');
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void issue();
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [mode, user, schoolId]);

  return (
    <dialog
      ref={dialog}
      className={styles.presentation}
      aria-labelledby="presentation-title"
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
    >
      <div className={styles.sheet}>
        <span className={styles.sheetBrand}>nuni</span>
        <p className={styles.sheetSchool}>{schoolName}</p>
        <h2 id="presentation-title">{mode === 'code' ? '學號核對' : '出示學號'}</h2>
        {error ? (
          <p className={styles.sheetNote} role="alert">
            {error}
          </p>
        ) : mode === 'code' && !code ? (
          <p className={styles.sheetNote} role="status">
            正在取得驗證碼…
          </p>
        ) : (
          <>
            {code && (
              <img
                className={styles.qr}
                src={code.image}
                alt="供現場核對學號的限時 QR Code"
                width={256}
                height={256}
              />
            )}
            <p className={styles.number}>{code?.studentId || studentId}</p>
            <p className={styles.sheetNote}>
              {code ? '掃碼核對學校與學號末四碼，每組限用一次。' : '資料來自個人檔案'}
            </p>
            <p className={styles.timer} aria-label={'剩餘 ' + remaining + ' 秒'}>
              {remaining} 秒後自動收起
            </p>
          </>
        )}
        <button className={styles.close} onClick={() => close.current()} autoFocus>
          收起學生證
        </button>
      </div>
    </dialog>
  );
}
