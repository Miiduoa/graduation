'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CLASS_WORKSPACE_HREF,
  DISCOVER_REASON_COPY,
  PasskeyCeremonyCancelled,
  SCHOOL_PROVIDER_LABELS,
  campusOneLoginHref,
  discoverSchool,
  listPlatformProviderKinds,
  loginErrorMessage,
  looksLikeSchoolEmail,
  passkeyAvailable,
  readExistingSession,
  readReturnPath,
  searchSchoolsByName,
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
  const campusLogin = campusOneLoginHref(search);
  const [gate, setGate] = useState<'checking' | 'unsigned'>('checking');
  const [query, setQuery] = useState('');
  const [school, setSchool] = useState<DiscoveredSchool | null>(null);
  const [matches, setMatches] = useState<DiscoveredSchool[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<'campus' | 'find' | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [passkeys, setPasskeys] = useState<boolean | null>(null);
  const generation = useRef(0);
  const queryField = useRef<HTMLInputElement>(null);
  const providers = usableSchoolProviders(school?.providerKinds);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (campusLogin) {
      window.location.replace(campusLogin);
      return;
    }
    const ignore = new AbortController();
    void readExistingSession().then((signedIn) => {
      if (ignore.signal.aborted) return;
      if (signedIn) {
        window.location.replace(returnPath);
        return;
      }
      setGate('unsigned');
    });
    return () => ignore.abort();
  }, [campusLogin, returnPath]);

  useEffect(() => {
    if (campusLogin) return;
    setPasskeys(passkeyAvailable());
  }, [campusLogin]);

  useEffect(() => {
    if (campusLogin) return;
    const ignore = new AbortController();
    void listPlatformProviderKinds()
      .then((kinds) => {
        if (!ignore.signal.aborted) setGoogleReady(kinds.includes('google-consumer'));
      })
      .catch(() => {
        if (!ignore.signal.aborted) setGoogleReady(false);
      });
    return () => ignore.abort();
  }, [campusLogin]);

  useEffect(() => {
    if (asking) queryField.current?.focus();
  }, [asking]);

  async function beginCampusLogin() {
    if (school?.available && school.tenantId && providers[0]) {
      await beginSchoolProvider(providers[0]);
      return;
    }
    setAsking('campus');
    setError(null);
  }

  async function findSchool(event: FormEvent) {
    event.preventDefault();
    const request = ++generation.current;
    setBusy('discover');
    setError(null);
    setSchool(null);
    setMatches([]);
    try {
      const trimmed = query.trim();
      if (asking === 'campus' || looksLikeSchoolEmail(trimmed)) {
        const found = await discoverSchool(trimmed);
        if (request !== generation.current) return;
        setSchool(found);
        if (!found.available) {
          setError(DISCOVER_REASON_COPY[found.reason ?? 'unknown-school'] ?? DISCOVER_REASON_COPY['unknown-school']);
        }
      } else {
        const found = await searchSchoolsByName(trimmed);
        if (request !== generation.current) return;
        const available = found.filter((item) => item.available && item.tenantId);
        if (available.length === 1) setSchool(available[0]);
        else if (available.length > 1) setMatches(available);
        else {
          setError(DISCOVER_REASON_COPY[found[0]?.reason ?? 'unknown-school'] ?? DISCOVER_REASON_COPY['unknown-school']);
        }
      }
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

  if (campusLogin || gate === 'checking') {
    return (
      <div className={styles.page}>
        <main className={styles.main}>
          <h1 className={styles.title}>登入</h1>
          <p className={styles.note} role="status">
            正在確認登入…
          </p>
        </main>
      </div>
    );
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
            <button type="button" className={styles.find} onClick={() => {
              setAsking('find');
              setError(null);
            }}>
              尋找學校
            </button>
            <a href={CLASS_WORKSPACE_HREF}>課班／教學</a>
          </div>
          {asking ? (
            <form className={styles.form} onSubmit={(event) => void findSchool(event)}>
              <label htmlFor="school-query">
                {asking === 'find' ? '學校配發的信箱或校名' : '學校配發的信箱'}
              </label>
              <input
                ref={queryField}
                id="school-query"
                name="query"
                type={asking === 'find' ? 'text' : 'email'}
                inputMode={asking === 'find' ? 'text' : 'email'}
                autoComplete={asking === 'find' ? 'off' : 'email'}
                placeholder={asking === 'find' ? 'name@school.edu.tw 或學校名稱' : 'name@school.edu.tw'}
                value={query}
                disabled={busy !== null && busy !== 'discover'}
                onChange={(event) => {
                  generation.current += 1;
                  setQuery(event.target.value);
                  setSchool(null);
                  setMatches([]);
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
              <button className={`btn primary ${styles.primary}`} disabled={busy !== null || query.trim().length === 0}>
                {busy === 'discover' ? '正在找學校…' : '找到我的學校'}
              </button>
            </form>
          ) : error ? (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          ) : null}
          {matches.length > 1 ? (
            <div className={styles.providers}>
              {matches.map((item) => (
                <button
                  key={item.tenantId}
                  type="button"
                  className={`btn ${styles.provider}`}
                  disabled={busy !== null}
                  onClick={() => {
                    setSchool(item);
                    setMatches([]);
                    setError(null);
                  }}
                >
                  {item.displayName ?? item.tenantId}
                </button>
              ))}
            </div>
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
