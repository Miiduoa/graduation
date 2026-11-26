'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AccountRoleLinks } from '@/components/AccountRoleLinks';
import { SiteShell } from '@/components/SiteShell';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useSearchParams } from 'next/navigation';
import {
  getSchoolTronClassEntry,
  TRONCLASS_LOGIN_DIRECTORY,
} from '@campus/shared/src/schoolLearningPlatforms';
import { isPuEcampusDataFetchEnabled } from '@campus/shared/src/puEcampusDataPolicy';
import { isPuTeacherAccount } from '@/lib/server/puIdentity';
import { useAuth } from '@/components/AuthGuard';
import { isEmulatorTestEnv, isFirebaseConfigured, signInWithPuStudentId } from '@/features/auth/client';
import {
  collapseInternalPathHash,
  navigateAfterLogin,
  readLoginReturnParam,
  sanitizeInternalPath,
} from '@/lib/navigation';
import styles from '../servicePages.module.css';
import loginStyles from './login.module.css';
import { NuniSignIn } from '@/components/NuniSignIn';
import { useNuniSession } from '@/features/nuni/Session';
import { platformDestination } from '@/lib/accountDestination';
import { isPublicCampusPath, publicCampusServices } from '@/lib/publicCampusServices';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { SchoolLoginHttpError, schoolLoginFailureCopy } from '@/lib/schoolLoginErrorCopy';
import { STUDENT_ID_PREPARING_COPY, useSignInOptions } from '@/lib/signInOptions';
import {
  buildCampusNavigationSearch,
  campusServiceHref,
  useCampusNavigationSearch,
} from '@/lib/campusNavigation';

function loginDestination(value: string | null): string {
  const safe = collapseInternalPathHash(
    sanitizeInternalPath(value && value.length <= 1200 ? value : null),
  );
  try {
    const path = decodeURIComponent(new URL(safe, 'https://campus.local').pathname).replace(
      /\/+$/,
      '',
    );
    if (
      ['/login', '/classroom/login', '/admin/login', '/sso-callback'].includes(path) ||
      /^\/(?:auth|api|_next)(?:\/|$)/.test(path)
    )
      return '/';
    return safe;
  } catch {
    return '/';
  }
}

function goAfterLogin(destination: string) {
  // App Router 的 router.replace 在登入後帳號／校園狀態更新時可能被取消，
  // 回到「/」時可見 /?_rsc 中斷、畫面停在 /login。改以整頁導向離開登入頁。
  navigateAfterLogin((href) => window.location.replace(href), destination);
}

function LoginForm({
  destination,
  reconnect,
  issue,
}: {
  destination: string;
  reconnect: boolean;
  issue: boolean;
}) {
  const { user, loading: schoolLoading } = useAuth();
  const platformAuth = useNuniSession();
  const selection = useOptionalSelectedSchool();
  const params = useSearchParams();
  const campusSearch = useCampusNavigationSearch(params);
  const selectedSchoolId = selection?.selectedSchoolId ?? null;
  const schoolDirectoryReady = !selection || !selection.loading;
  const navigationSearch = selection?.requestedUnavailable
    ? buildCampusNavigationSearch(params)
    : campusSearch;
  const href = (path: string) => campusServiceHref(path, navigationSearch);
  const importHref = href('/import');
  const options = useSignInOptions(selectedSchoolId, schoolDirectoryReady, 'school');
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const busyRef = useRef<'school' | 'platform' | null>(null);
  const returning = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [platformBusy, setPlatformBusy] = useState(false);
  const [error, setError] = useState('');
  const previousSchoolId = useRef(selectedSchoolId);
  const schoolTask = reconnect || platformDestination(destination) !== destination;
  const schoolAvailable = options.studentId;
  const puStudentPaused = schoolAvailable && (!selectedSchoolId || selectedSchoolId === 'pu') &&
    !isPuEcampusDataFetchEnabled();
  const acceptsAccount = !puStudentPaused || isPuTeacherAccount(studentId.trim());
  const localEmulator = process.env.NODE_ENV === 'development' && isEmulatorTestEnv();
  const schoolRequired = schoolTask && schoolAvailable;
  const hasSchoolIdentity = Boolean(
    user?.uid.startsWith('pu-') && (!selectedSchoolId || selectedSchoolId === 'pu'),
  );
  const schoolUnavailable = schoolTask && !options.loading && !options.error && !schoolAvailable;
  // School destinations stay school-only; Google must not appear to fulfill them.
  const hideGoogle = schoolTask;
  const taskPath = new URL(destination, 'https://campus.local').pathname;
  const confirmedSchool =
    selectedSchoolId &&
    schoolDirectoryReady &&
    selection?.catalogStatus === 'ready' &&
    !selection.requestedUnavailable &&
    selection.selectedSchool?.id === selectedSchoolId
      ? selection.selectedSchool
      : null;
  // Prioritize an available campus only for a confirmed signed-out general entry.
  // Existing accounts and unfinished platform recovery keep their own route first.
  const schoolFirst =
    !schoolTask &&
    taskPath === '/' &&
    !platformAuth.session &&
    !platformAuth.loading &&
    !platformAuth.error &&
    !platformAuth.pendingLogout &&
    !!confirmedSchool &&
    !options.loading &&
    !options.error &&
    schoolAvailable &&
    !puStudentPaused;
  const officialLms = confirmedSchool
    ? getSchoolTronClassEntry(confirmedSchool.id, confirmedSchool.name)
    : null;
  let schoolHeading = '需要校務資料時再連線';
  if (puStudentPaused) schoolHeading = officialLms ? '校方課程平台與教師登入' : '靜宜教師登入';
  else if (schoolTask) schoolHeading = '確認你的學校帳號';
  else if (schoolFirst) schoolHeading = '使用學校帳號開始';
  else if (officialLms) schoolHeading = '前往學校課程平台';
  const publicDestination = isPublicCampusPath(taskPath);
  const merchantTask =
    !reconnect && ['/merchant', '/merchant/apply', '/merchant/workspace'].includes(taskPath);
  const directoryDestination = href('/search');
  const guestDestination = publicDestination ? destination : directoryDestination;
  useEffect(() => {
    const restore = () => {
      if (busyRef.current === 'platform') {
        busyRef.current = null;
        setPlatformBusy(false);
      }
    };
    window.addEventListener('pageshow', restore);
    return () => {
      request.current?.abort();
      window.removeEventListener('pageshow', restore);
    };
  }, []);
  useEffect(() => {
    // 登入成功後帳號作用域會重讀校園偏好，目錄會短暫未就緒並清空 selectedSchoolId。
    // 那不是使用者改選校園，不能中斷正在進行的學號登入或登入後導頁。
    if (!schoolDirectoryReady) return;
    if (previousSchoolId.current === selectedSchoolId) return;
    previousSchoolId.current = selectedSchoolId;
    if (returning.current) return;
    request.current?.abort();
    request.current = null;
    if (busyRef.current === 'school') {
      busyRef.current = null;
      setBusy(false);
    }
    setStudentId('');
    setPassword('');
    setError('');
  }, [selectedSchoolId, schoolDirectoryReady]);
  useEffect(() => {
    if (
      !schoolLoading &&
      !busyRef.current &&
      !returning.current &&
      hasSchoolIdentity &&
      schoolRequired &&
      !reconnect
    ) {
      returning.current = true;
      goAfterLogin(destination);
    }
  }, [hasSchoolIdentity, schoolLoading, destination, reconnect, schoolRequired]);
  async function login(event: FormEvent) {
    event.preventDefault();
    if (!acceptsAccount) return;
    await runSchoolLogin(studentId.trim().toUpperCase(), password);
  }
  async function runSchoolLogin(account: string, secret: string, targetSchoolId = selectedSchoolId) {
    if (busyRef.current || returning.current || schoolLoading || !schoolAvailable) return;
    setError('');
    if (!isFirebaseConfigured()) {
      setError('登入服務尚未連線，請稍後再試。');
      return;
    }
    busyRef.current = 'school';
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const authenticated = targetSchoolId
        ? await signInWithPuStudentId(
            account,
            secret,
            controller.signal,
            targetSchoolId,
          )
        : await signInWithPuStudentId(account, secret, controller.signal);
      if (controller.signal.aborted) return;
      if (!authenticated) throw new Error('登入服務尚未連線。');
      setPassword('');
      returning.current = true;
      goAfterLogin(destination);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SchoolLoginHttpError && error.status === 401) setPassword('');
      setError(schoolLoginFailureCopy(error));
    } finally {
      if (!controller.signal.aborted && !returning.current) {
        busyRef.current = null;
        setBusy(false);
      }
    }
  }
  if (merchantTask) {
    return (
      <SiteShell
        title="店家帳號登入"
        subtitle="第一次使用可透過 Google 建立帳號。已申請店家請用原帳號登入。"
      >
        <div className={loginStyles.flow}>
          <div className={`${styles.loginLayout} ${loginStyles.methods}`}>
            <NuniSignIn returnUrl={destination} issue={issue} />
          </div>
          <Link href={href('/login')} className={styles.backLink}>
            查看其他身分入口
          </Link>
        </div>
      </SiteShell>
    );
  }
  const platformSignIn = !hideGoogle ? (
    <NuniSignIn
      key="platform-sign-in"
      returnUrl={destination}
      issue={issue}
      disabled={busy}
      onStart={() => {
        if (busyRef.current) return false;
        busyRef.current = 'platform';
        setPlatformBusy(true);
        return true;
      }}
    />
  ) : null;
  const schoolSignIn = (
    <details
      key="school-sign-in"
      className={`${styles.loginHelp} ${styles.schoolConnection}`}
      aria-label="學校帳號登入"
      open={schoolTask || schoolFirst}
    >
      <summary>
        <div className={styles.methodHeading}>
          <div>
            <span className={styles.methodEyebrow}>學校帳號 · 本人授權</span>
            <h2>{schoolHeading}</h2>
          </div>
          <span className={styles.methodStatus}>{puStudentPaused ? '學生校務登入暫停' : '依服務開放'}</span>
        </div>
      </summary>
      {(selection?.schools?.length ?? 0) > 0 && (
        <label className={styles.schoolPicker} htmlFor="login-school">
          <span>選擇學校</span>
          <select
            id="login-school"
            value={selectedSchoolId ?? ''}
            onChange={(event) => selection?.selectSchool(event.target.value || null)}
            disabled={busy || platformBusy || schoolLoading || !schoolDirectoryReady}
          >
            <option value="">全部校園／未指定</option>
            {selection?.schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {selection?.selectedSchool && (
        <p className={styles.selectedCampus}>目前選擇：{selection.selectedSchool.name}</p>
      )}
      {officialLms && (
        <p className={styles.formIntro}>
          <a
            href={officialLms.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            前往 {officialLms.label} <span aria-hidden="true">↗</span>
          </a>
          <br />
          在校方網站登入即可查看自己的課程。課程資料不會自動同步到 nuni。
        </p>
      )}
      {options.loading ? (
        <p role="status">正在確認登入方式…</p>
      ) : options.error ? (
        <div role="alert">
          <p>暫時無法確認登入方式，請重新連線後再試。</p>
          <button type="button" className="btn" onClick={options.retry}>
            重新確認登入方式
          </button>
        </div>
      ) : schoolAvailable ? (
        <>
          <p>
            {puStudentPaused
              ? '靜宜學生的 E 校園登入已暫停。你仍可匯入自己的課表與成績。教師可用校方教師帳號，透過玩課雲驗證身分。'
              : '使用所選學校的帳號驗證身分。課程平台與其他校務資料會依各來源的授權及連線狀態取得。'}
          </p>
          {schoolRequired && (
            <p>
              {publicDestination
                ? '你選擇的個人功能仍使用學校帳號；瀏覽校園資訊不需登入。'
                : '你要開啟的頁面要用學校帳號登入，Google 帳號不會自動取得校務權限。'}
            </p>
          )}
          <form className={styles.loginForm} onSubmit={login} aria-busy={busy}>
            <p className={styles.formIntro}>
              {puStudentPaused
                ? '輸入校方教師帳號後，再輸入密碼。'
                : '輸入學號與密碼，完成後返回原本的頁面。'}
            </p>
            <Input
              id="student-id"
              name="studentId"
              label={puStudentPaused ? '教師帳號' : '學號'}
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                if (puStudentPaused && !isPuTeacherAccount(e.target.value.trim())) setPassword('');
                setError('');
              }}
              maxLength={64}
              required
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy || platformBusy || schoolLoading}
            />
            <Input
              id="password"
              name="password"
              label="密碼"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              required
              autoComplete="current-password"
              disabled={busy || platformBusy || schoolLoading || !acceptsAccount}
            />
            {busy && (
              <p role="status" className={styles.loginProgress}>
                {puStudentPaused ? '正在驗證教師帳號…' : '正在驗證帳號與建立校務資料連線…'}
              </p>
            )}
            {error && !localEmulator && (
              <p role="alert" className={styles.errorNotice}>
                {error}
              </p>
            )}
            <Button
              variant="primary"
              type="submit"
              fullWidth
              loading={busy}
              disabled={
                busy || platformBusy || schoolLoading || !acceptsAccount || !studentId.trim() || !password
              }
            >
              {schoolLoading ? '正在確認學校帳號…' : busy ? '連線中…' : puStudentPaused ? '使用教師帳號登入' : '連線學校帳號'}
            </Button>
          </form>
          <details className={styles.connectionDetails}>
            <summary>連線後能看到哪些資料？</summary>
            <p>
              {puStudentPaused
                ? '教學課程依校方提供的授課紀錄顯示。學生課表、歷年成績與學分紀錄目前暫停讀取。'
                : '依學校當次提供的資料查看個人紀錄。課程成員、教師與平台管理權限會分別確認。'}
            </p>
            <p>
              密碼會透過加密連線送至驗證服務使用；不會存成個人匯入草稿。忘記密碼請前往學校原本的帳號服務處理。
            </p>
          </details>
        </>
      ) : schoolUnavailable ? (
        <p role="status">
          學校帳號登入目前未開放，暫時無法連線這項服務。你原本要開啟的頁面已保留。
        </p>
      ) : (
        <p role="status">{STUDENT_ID_PREPARING_COPY}</p>
      )}
      <div className={styles.importRoute}>
        <span className={styles.methodEyebrow}>另一種方式 · 各校適用</span>
        <h3>不使用學號，也能匯入課表</h3>
        <p>可自行匯入課表、成績與活動</p>
        <p>
          在校務系統開啟課表或成績列表後，直接複製網頁表格貼上，或匯入從學校下載的
          HTML、PDF、CSV 與截圖。先核對預覽再儲存，不必提供學校密碼。
        </p>
        <Link href={importHref} className="btn">
          前往資料匯入 <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <div className={styles.helpLinks}>
        <Link href={href('/privacy')}>
          了解資料使用方式 <span aria-hidden="true">↗</span>
        </Link>
        <Link href={href('/terms')}>
          閱讀使用條款 <span aria-hidden="true">↗</span>
        </Link>
      </div>
      {schoolTask && (
        <Link href={href('/login')} className={styles.backLink}>
          改用一般登入
        </Link>
      )}
      <Link href={href('/')} className={styles.backLink}>
        ← 返回首頁
      </Link>
    </details>
  );
  return (
    <SiteShell
      title={
        reconnect && user && schoolAvailable
          ? '重新連線學校帳號'
          : schoolTask
            ? '連線學校帳號'
            : '登入'
      }
      subtitle={
        schoolRequired
          ? '驗證學校帳號後，返回你原本的頁面。'
          : schoolTask
            ? '這個頁面要用學校帳號，Google 帳號無法代替。'
            : schoolFirst
              ? '先驗證你的學校帳號，或使用 Google 帳號進入平台。目前兩種登入仍分別運作。'
              : '不登入也能看校園資訊。需要課程、交流或店家服務時，用 Google 帳號登入。'
      }
    >
      <div className={loginStyles.flow}>
        {localEmulator && <section className={styles.stateCard} aria-label="本機測試登入">
          <h2>本機測試環境</h2>
          <p>使用隔離的測試學生帳號登入 nuni。下一頁連接 TronClass 時，再另外輸入你本人的學校帳密。</p>
          <Button type="button" variant="primary" loading={busy}
            disabled={busy || platformBusy || schoolLoading || !schoolAvailable || options.loading || options.error}
            onClick={() => {
              if (!localEmulator) return;
              // gitleaks:allow Public Auth emulator fixture; never a school credential.
              void runSchoolLogin('S0000001', 'campus-test-1234', 'pu');
            }}>
            使用本機測試學生甲
          </Button>
          {error && <p role="alert" className={styles.errorNotice}>{error}</p>}
        </section>}
        {!schoolTask && destination !== '/' && (
          <p className={loginStyles.continuation}>登入後會回到你原本的頁面，接著完成剛才的事。</p>
        )}
        <div className={`${styles.loginLayout} ${loginStyles.methods}`}>
          {schoolFirst ? [schoolSignIn, platformSignIn] : [platformSignIn, schoolSignIn]}
        </div>
        {!schoolTask && (
          <p className={loginStyles.continuation}>
            <a
              className={styles.backLink}
              href={TRONCLASS_LOGIN_DIRECTORY.url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              {TRONCLASS_LOGIN_DIRECTORY.label} <span aria-hidden="true">↗</span>
            </a>
            {TRONCLASS_LOGIN_DIRECTORY.description}
          </p>
        )}
        {!schoolTask && <AccountRoleLinks showSchool />}
        <section className={styles.guestAccess} aria-labelledby="guest-access-title">
          <div>
            <h2 id="guest-access-title">先瀏覽校園資訊</h2>
            <p>地圖、公車、公開公告、餐廳與圖書館入口不需登入。資料是否提供，依各校來源為準。</p>
          </div>
          <Link href={guestDestination} className="btn">
            不登入，繼續瀏覽
          </Link>
          <nav aria-label="不需登入的校園服務">
            {publicCampusServices.map((service) => (
              <Link key={service.href} href={href(service.href)}>
                {service.title}
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </SiteShell>
  );
}
function LoginRoute() {
  const params = useSearchParams();
  const destination = loginDestination(readLoginReturnParam(params));
  const reconnect = params.get('reconnect') === 'school';
  return (
    <LoginForm
      key={`${destination}:${reconnect}`}
      destination={destination}
      reconnect={reconnect}
      issue={params.has('issue')}
    />
  );
}
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <SiteShell title="登入">
          <p role="status" className={styles.loading}>
            正在載入登入表單…
          </p>
        </SiteShell>
      }
    >
      <LoginRoute />
    </Suspense>
  );
}
