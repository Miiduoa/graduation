'use client';

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { schoolLoginFailureCopy } from '@/lib/schoolLoginErrorCopy';
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

function goAfterLogin(router: { replace: (href: string) => void }, destination: string) {
  navigateAfterLogin((href) => router.replace(href), destination);
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
  const router = useRouter();
  const { user, loading: schoolLoading } = useAuth();
  const selection = useOptionalSelectedSchool();
  const selectedSchoolId = selection?.selectedSchoolId ?? null;
  const schoolDirectoryReady = !selection || !selection.loading;
  const options = useSignInOptions(selectedSchoolId, schoolDirectoryReady);
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const busyRef = useRef<'school' | 'platform' | null>(null);
  const returning = useRef(false);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [platformBusy, setPlatformBusy] = useState(false);
  const [error, setError] = useState('');
  const schoolTask = reconnect || platformDestination(destination) !== destination;
  const schoolAvailable = options.studentId;
  const schoolRequired = schoolTask && schoolAvailable;
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
    if (
      !schoolLoading &&
      !busyRef.current &&
      !returning.current &&
      user &&
      schoolRequired &&
      !reconnect
    ) {
      returning.current = true;
      goAfterLogin(router, destination);
    }
  }, [user, schoolLoading, router, destination, reconnect, schoolRequired]);
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
      goAfterLogin(router, destination);
    } catch (error) {
      if (controller.signal.aborted) return;
      setError(schoolLoginFailureCopy(error));
    } finally {
      if (!controller.signal.aborted) {
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
      <div className={styles.loginLayout}>
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
        <section className={styles.loginHelp} aria-label="學校帳號登入">
          <h2>學校帳號</h2>
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
                讀取個人課表、成績、校務紀錄與既有地圖收藏時使用。目前支援靜宜大學；學生用 e
                校園學號，老師用教職員帳號與密碼登入。
              </p>
              {schoolRequired && (
                <p>
                  {publicDestination
                    ? '你選擇的個人功能仍使用學校帳號；瀏覽校園資訊不需登入。'
                    : '你要開啟的頁面要用學校帳號登入，Google 帳號不會自動取得校務權限。'}
                </p>
              )}
              <form className={styles.loginForm} onSubmit={login} aria-busy={busy}>
                <Input
                  id="student-id"
                  name="studentId"
                  label="學號"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
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
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={busy || platformBusy || schoolLoading}
                />
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
              <p>請輸入你登入 e 校園時使用的資料。若忘記密碼，請透過學校的帳號服務處理。</p>
            </>
          ) : schoolUnavailable ? (
            <p role="status">
              學校帳號登入目前未開放，暫時無法連線這項服務。你原本要開啟的頁面已保留。
            </p>
          ) : (
            <p role="status">{STUDENT_ID_PREPARING_COPY}</p>
          )}
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
