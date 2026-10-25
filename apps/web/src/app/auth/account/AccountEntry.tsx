'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CLASS_WORKSPACE_HREF,
  DISCOVER_REASON_COPY,
  FIND_SCHOOL_HREF,
  PasskeyCeremonyCancelled,
  SCHOOL_PROVIDER_LABELS,
  discoverSchool,
  listPlatformProviderKinds,
  loginErrorMessage,
  passkeyAvailable,
  readReturnPath,
  signInWithPasskey,
  startGoogleContinue,
  startSchoolProvider,
  usableSchoolProviders,
  type DiscoveredSchool,
} from './legacyLogin';
import styles from './accountEntry.module.css';

type Busy =
  | 'discover'
  | 'google-consumer'
  | 'passkey'
  | 'google-workspace'
  | 'microsoft-entra'
  | 'campus-oidc'
  | null;

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

export function AccountEntry() {
  const search = useSearchParams();
  const returnPath = readReturnPath(search);
  const [email, setEmail] = useState('');
  const [school, setSchool] = useState<DiscoveredSchool | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [askingEmail, setAskingEmail] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [passkeys, setPasskeys] = useState<boolean | null>(null);
  const generation = useRef(0);
  const emailField = useRef<HTMLInputElement>(null);
  const providers = usableSchoolProviders(school?.providerKinds);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  useEffect(() => {
    setPasskeys(passkeyAvailable());
  }, []);

  useEffect(() => {
    const ignore = new AbortController();
    void listPlatformProviderKinds()
      .then((kinds) => {
        if (!ignore.signal.aborted) setGoogleReady(kinds.includes('google-consumer'));
      })
      .catch(() => {
        if (!ignore.signal.aborted) setGoogleReady(false);
      });
    return () => ignore.abort();
  }, []);

  useEffect(() => {
    if (askingEmail) emailField.current?.focus();
  }, [askingEmail]);

  async function beginCampusLogin() {
    if (school?.available && school.tenantId && providers[0]) {
      await beginSchoolProvider(providers[0]);
      return;
    }
    setAskingEmail(true);
    setError(null);
  }

  async function findSchool(event: FormEvent) {
    event.preventDefault();
    const request = ++generation.current;
    setBusy('discover');
    setError(null);
    setSchool(null);
    try {
      const found = await discoverSchool(email);
      if (request !== generation.current) return;
      setSchool(found);
      if (!found.available) setError(DISCOVER_REASON_COPY[found.reason ?? 'unknown-school'] ?? DISCOVER_REASON_COPY['unknown-school']);
    } catch (failure) {
      if (request !== generation.current) return;
      setSchool(null);
      setError(loginErrorMessage(failure, '目前無法確認學校，請稍後再試。'));
    } finally {
      if (request === generation.current) setBusy(null);
    }
  }

  async function beginSchoolProvider(kind: string) {
    if (!school?.tenantId) return;
    setBusy(kind as Busy);
    setError(null);
    try {
      await startSchoolProvider(school.tenantId, kind, returnPath);
    } catch (failure) {
      setBusy(null);
      setError(loginErrorMessage(failure, '目前無法開始登入，請稍後再試。'));
    }
  }

  async function beginGoogle() {
    setBusy('google-consumer');
    setError(null);
    try {
      await startGoogleContinue(returnPath);
    } catch (failure) {
      setBusy(null);
      setError(loginErrorMessage(failure, '目前無法開始 Google 登入，請再試一次或改用校園帳號。'));
    }
  }

  async function beginPasskey() {
    if (!school?.tenantId) return;
    setBusy('passkey');
    setError(null);
    try {
      await signInWithPasskey(school.tenantId, returnPath);
    } catch (failure) {
      if (failure instanceof PasskeyCeremonyCancelled) setError(null);
      else setError(loginErrorMessage(failure, '這次通行金鑰登入沒有完成，請再試一次或改用其他方式。'));
      setBusy(null);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>登入</h1>
        <p className={styles.note}>請用學校核發的帳號登入。</p>
        <section className={styles.actions} aria-label="登入方式">
          <button
            type="button"
            className={`btn primary ${styles.primary}`}
            disabled={busy !== null}
            onClick={() => void beginCampusLogin()}
          >
            {busy && school?.available ? '正在前往…' : '登入校園帳號'}
          </button>
          {googleReady ? (
            <button
              type="button"
              className={`btn ${styles.google}`}
              disabled={busy !== null}
              onClick={() => void beginGoogle()}
            >
              <GoogleMark />
              {busy === 'google-consumer' ? '正在前往 Google…' : '用 Google 繼續'}
            </button>
          ) : null}
          <div className={styles.links}>
            <a className={styles.find} href={FIND_SCHOOL_HREF}>
              尋找學校
            </a>
            <a href={CLASS_WORKSPACE_HREF}>課班／教學</a>
          </div>
          {askingEmail ? (
            <form className={styles.form} onSubmit={(event) => void findSchool(event)}>
              <label htmlFor="school-email">學校配發的信箱</label>
              <input
                ref={emailField}
                id="school-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@school.edu.tw"
                value={email}
                disabled={busy !== null && busy !== 'discover'}
                onChange={(event) => {
                  generation.current += 1;
                  setEmail(event.target.value);
                  setSchool(null);
                  setError(null);
                  setBusy((current) => (current === 'discover' ? null : current));
                }}
                required
              />
              {error ? (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              ) : null}
              <button className={`btn primary ${styles.primary}`} disabled={busy !== null || email.trim().length === 0}>
                {busy === 'discover' ? '正在找學校…' : '找到我的學校'}
              </button>
            </form>
          ) : error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
          {school?.available ? (
            <div className={styles.providers}>
              <h2 className={styles.school}>{school.displayName}</h2>
              {providers.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`btn ${styles.provider}`}
                  disabled={busy !== null}
                  onClick={() => void beginSchoolProvider(kind)}
                >
                  {busy === kind ? '正在前往…' : (SCHOOL_PROVIDER_LABELS[kind] ?? '使用學校原有登入')}
                </button>
              ))}
              {providers.length === 0 ? (
                <p className={styles.error}>學校已經在名錄中，但可安全使用的網站登入方式尚未開放。請先聯絡學校資訊中心。</p>
              ) : null}
              {passkeys === true ? (
                <button
                  type="button"
                  className={`btn ${styles.provider}`}
                  disabled={busy !== null}
                  onClick={() => void beginPasskey()}
                >
                  {busy === 'passkey' ? '請在裝置上完成確認…' : '用通行金鑰登入'}
                </button>
              ) : passkeys === false ? (
                <p className={styles.note}>這個瀏覽器還不支援通行金鑰。你仍然可以用學校帳號登入，其他功能都不受影響。</p>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
      <footer className={styles.footer}>
        <nav aria-label="公開資訊">
          <a href="/privacy">隱私資訊</a>
          <a href="/terms">服務條款</a>
          <a href="/support">使用支援</a>
          <a href="/account-deletion">帳號刪除／停用</a>
        </nav>
      </footer>
    </div>
  );
}
