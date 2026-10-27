'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthGuard';
import { isFirebaseConfigured, signInWithPuStudentId } from '@/features/auth/client';
import {
  collapseInternalPathHash,
  navigateAfterLogin,
  readLoginReturnParam,
  sanitizeInternalPath,
} from '@/lib/navigation';
import styles from '../servicePages.module.css';
import { NuniSignIn } from '@/components/NuniSignIn';
import { platformDestination } from '@/lib/accountDestination';
import { isPublicCampusPath, publicCampusServices } from '@/lib/publicCampusServices';
import { useOptionalSelectedSchool } from '@/components/SelectedSchoolProvider';
import { SchoolLoginHttpError, schoolLoginFailureCopy } from '@/lib/schoolLoginErrorCopy';
import { STUDENT_ID_PREPARING_COPY, useSignInOptions } from '@/lib/signInOptions';

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
  const selection = useOptionalSelectedSchool();
  const selectedSchoolId = selection?.selectedSchoolId ?? null;
  const schoolDirectoryReady = !selection || !selection.loading;
  const importHref = selectedSchoolId && selection?.selectedSchool
    ? `/import?schoolId=${encodeURIComponent(selectedSchoolId)}`
    : '/import';
  const options = useSignInOptions(selectedSchoolId, schoolDirectoryReady);
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
  const schoolRequired = schoolTask && schoolAvailable;
  const hasSchoolIdentity = Boolean(
    user?.uid.startsWith('pu-') && (!selectedSchoolId || selectedSchoolId === 'pu'),
  );
  const schoolUnavailable =
    schoolTask && !options.loading && !options.error && !schoolAvailable;
  // School destinations stay school-only; Google must not appear to fulfill them.
  const hideGoogle = schoolTask;
  const publicDestination = isPublicCampusPath(
    new URL(destination, 'https://campus.local').pathname,
  );
  const guestDestination = publicDestination ? destination : '/#public-services';
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
      const authenticated = selectedSchoolId
        ? await signInWithPuStudentId(
            studentId.trim().toUpperCase(),
            password,
            controller.signal,
            selectedSchoolId,
          )
        : await signInWithPuStudentId(studentId.trim().toUpperCase(), password, controller.signal);
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
            : '不登入也能看校園資訊。需要課程、交流或店家服務時，用 Google 帳號登入。'
      }
    >
      <section className={styles.connectionIntro} aria-label="校務連線方式">
        <div>
          <p className={styles.connectionKicker}>校園資料，一次整理</p>
          <h2>用熟悉的學校帳號，接上自己的課表</h2>
          <p>靜宜大學目前提供學號直接連線；其他學校可以從學校下載或截取資料後自行匯入。兩種方法分開顯示，避免把「可瀏覽校園」誤認為「已取得校務權限」。</p>
        </div>
        <div className={styles.connectionFacts}>
          <span>直接連線：靜宜大學</span>
          <span>檔案匯入：跨校適用</span>
        </div>
      </section>
      <div className={styles.loginLayout}>
        <section className={styles.loginHelp} aria-label="學校帳號登入">
          <div className={styles.methodHeading}>
            <div>
              <span className={styles.methodEyebrow}>學校帳號 · 本人授權</span>
              <h2>學校帳號</h2>
            </div>
            <span className={styles.methodStatus}>{schoolAvailable ? '可連線' : '依校園提供'}</span>
          </div>
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
                  <option key={school.id} value={school.id}>{school.name}</option>
                ))}
              </select>
            </label>
          )}
          {selection?.selectedSchool && (
            <p className={styles.selectedCampus}>目前選擇：{selection.selectedSchool.name}</p>
          )}
          {options.loading ? (
            <p role="status">正在確認登入方式…</p>
          ) : options.error ? (
            <div role="alert">
              <p>暫時無法確認登入方式，請重新連線後再試。</p>
              <button type="button" className="btn" onClick={options.retry}>重新確認登入方式</button>
            </div>
          ) : schoolAvailable ? (
            <>
              <p>
                目前支援靜宜大學 e 校園學號登入，用於讀取本人的課表、成績與校務紀錄。學校帳號驗證不會自動取得教師、課班或平台管理權限。
              </p>
              {schoolRequired && (
                <p>
                  {publicDestination
                    ? '你選擇的個人功能仍使用學校帳號；瀏覽校園資訊不需登入。'
                    : '你要開啟的頁面要用學校帳號登入，Google 帳號不會自動取得校務權限。'}
                </p>
              )}
              <form className={styles.loginForm} onSubmit={login} aria-busy={busy}>
                <p className={styles.formIntro}>使用學校的既有帳號連線，不需要另外申請 Campus One 學號。</p>
                <Input
                  id="student-id"
                  name="studentId"
                  label="學號"
                  value={studentId}
                  onChange={(e) => {
                    setStudentId(e.target.value);
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
                  disabled={busy || platformBusy || schoolLoading}
                />
                {busy && (
                  <p role="status" className={styles.loginProgress}>正在驗證帳號與建立校務資料連線…</p>
                )}
                {error && (
                  <p role="alert" className={styles.errorNotice}>
                    {error}
                  </p>
                )}
                <Button
                  variant="primary"
                  type="submit"
                  fullWidth
                  loading={busy}
                  disabled={busy || platformBusy || schoolLoading || !studentId.trim() || !password}
                >
                  {schoolLoading ? '正在確認學校帳號…' : busy ? '連線中…' : '連線學校帳號'}
                </Button>
              </form>
              <details className={styles.connectionDetails}>
                <summary>連線後能看到哪些資料？</summary>
                <p>靜宜大學目前可使用校務系統連線取得個人課表與成績，其他資料依學校系統當次回應為準。學校帳號驗證不等於取得平台的教師或管理權限。</p>
                <p>密碼會透過加密連線送至驗證服務使用；不會存成個人匯入草稿。忘記密碼請前往學校原本的帳號服務處理。</p>
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
            <p>在校務系統開啟課表或成績列表後，直接複製網頁表格貼上，或匯入從學校下載的 HTML、PDF、CSV 與截圖。先核對預覽再儲存，不必提供學校密碼。</p>
            <Link href={importHref} className="btn">前往資料匯入 <span aria-hidden="true">↗</span></Link>
          </div>
          <div className={styles.helpLinks}>
            <Link href="/privacy">
              了解資料使用方式 <span aria-hidden="true">↗</span>
            </Link>
            <Link href="/terms">
              閱讀使用條款 <span aria-hidden="true">↗</span>
            </Link>
          </div>
          {schoolTask && (
            <Link href="/login" className={styles.backLink}>
              改用一般登入
            </Link>
          )}
          <Link href="/" className={styles.backLink}>
            ← 返回首頁
          </Link>
        </section>
        {!hideGoogle && (
          <NuniSignIn
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
        )}
      </div>
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
            <Link key={service.href} href={service.href}>
              {service.title}
            </Link>
          ))}
        </nav>
      </section>
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
