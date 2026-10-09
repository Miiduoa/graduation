'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { browserRequest } from '@/features/nuni/Session';
import { NuniError, nuniErrorMessage } from '@campus/shared/src/nuni';
import {
  membershipStateLabel,
  membershipReceiptMessage,
  parseMembershipRequestReceipt,
  parseNuniMemberships,
  validateMembershipRequestInput,
  type NuniMembership,
} from '@campus/shared/src/nuniAccount';
import styles from './NuniAccountPanel.module.css';

type Result =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'expired' }
  | { status: 'ready'; memberships: NuniMembership[] };

/** The parent remounts this reader whenever the account or session context changes. */
export function AccountMemberships({
  context,
  refreshAccount,
}: {
  context: string;
  refreshAccount: () => Promise<void>;
}) {
  return <MembershipScope key={context} context={context} refreshAccount={refreshAccount} />;
}

function MembershipScope({
  context,
  refreshAccount,
}: {
  context: string;
  refreshAccount: () => Promise<void>;
}) {
  const [result, setResult] = useState<Result>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void browserRequest('memberships', context)
      .then((value) => {
        const memberships = parseNuniMemberships(value);
        if (active) setResult({ status: 'ready', memberships });
      })
      .catch((error) => {
        if (active)
          setResult({
            status:
              error instanceof NuniError &&
              (error.status === 401 || error.code === 'SESSION_CHANGED')
                ? 'expired'
                : 'error',
          });
      });
    return () => {
      active = false;
    };
  }, [context, attempt]);
  function reload() {
    setResult({ status: 'loading' });
    setAttempt((value) => value + 1);
  }
  return (
    <section className={styles.memberships} aria-labelledby="account-schools-title">
      <div className={styles.membershipHeading}>
        <h3 id="account-schools-title">學校資格</h3>
        {result.status === 'ready' && (
          <button className="btn" onClick={reload}>
            更新學校資格
          </button>
        )}
      </div>
      <p>
        一個 Campus One
        帳號可以有多所學校的資格，各校分別驗證。切換瀏覽校園不會加入該校，也不會取得學生、教師或管理權限。
      </p>
      {notice ? <p role="status">{notice}</p> : null}
      {result.status === 'loading' ? (
        <p role="status">正在確認學校資格…</p>
      ) : result.status === 'expired' ? (
        <div role="alert">
          <p>登入已失效或帳號已變更，學校資格已隱藏。</p>
          <button className="btn" onClick={() => void refreshAccount()}>
            重新確認帳號
          </button>
        </div>
      ) : result.status === 'error' ? (
        <div role="alert">
          <p>目前無法讀取學校資格，請稍後再試。</p>
          <button className="btn" onClick={reload}>
            重新讀取學校資格
          </button>
        </div>
      ) : result.memberships.length === 0 ? (
        <p>這個帳號目前沒有學校資格紀錄。已授權的課程與店家服務仍依各自資格提供。</p>
      ) : (
        <ul className={styles.membershipList}>
          {result.memberships.map((membership) => (
            <li key={membership.membershipId}>
              <strong>{membership.campusName}</strong>
              <span>{membershipStateLabel(membership.state)}</span>
            </li>
          ))}
        </ul>
      )}
      {result.status === 'ready' ? (
        <MembershipRequestForm
          key={context}
          context={context}
          onStarted={() => setNotice('')}
          onExpired={() => {
            setNotice('');
            setResult({ status: 'expired' });
          }}
          onSubmitted={(message) => {
            setNotice(message);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}

function MembershipRequestForm({
  context,
  onStarted,
  onSubmitted,
  onExpired,
}: {
  context: string;
  onStarted(): void;
  onSubmitted(message: string): void;
  onExpired(): void;
}) {
  const inputId = useId();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(true);
  const locked = useRef(false);
  const pending = useRef<{ claimedEmail: string } | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || !active.current) return;
    try {
      if (!uncertain || !pending.current)
        pending.current = validateMembershipRequestInput({ claimedEmail: email });
    } catch {
      setError('請填寫學校配發的完整電子郵件地址。');
      return;
    }
    locked.current = true;
    onStarted();
    setBusy(true);
    setError('');
    try {
      const receipt = parseMembershipRequestReceipt(
        await browserRequest('memberships', context, pending.current),
      );
      if (active.current) onSubmitted(membershipReceiptMessage(receipt));
    } catch (failure) {
      if (!active.current) return;
      if (
        failure instanceof NuniError &&
        (failure.status === 401 || failure.code === 'SESSION_CHANGED')
      ) {
        onExpired();
        return;
      }
      const unknown =
        !(failure instanceof NuniError) || failure.status === 0 || failure.status >= 500;
      setUncertain(unknown);
      if (unknown) {
        setError('尚未確認申請結果。信箱已保留，請重試確認同一筆申請。');
      } else if (failure instanceof NuniError && failure.code === 'MEMBERSHIP_CLAIM_INVALID') {
        setError(
          '這個信箱無法對應目前開放資格申請的合作學校。請確認學校配發的信箱，或聯絡該校管理者。',
        );
      } else {
        setError(nuniErrorMessage(failure));
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <form
      className={styles.membershipForm}
      onSubmit={(event) => void submit(event)}
      aria-label="申請學校資格"
      noValidate
    >
      <h4>申請學校資格</h4>
      <p>填寫合作學校配發的信箱。申請由學校驗證，收件後不會直接授予校園身分或權限。</p>
      <label htmlFor={inputId}>學校配發的電子郵件</label>
      <input
        id={inputId}
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        maxLength={254}
        disabled={busy || uncertain}
        onChange={(event) => {
          if (!busy && !uncertain) setEmail(event.target.value);
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" className="btn" disabled={busy}>
        {busy ? '正在確認申請…' : uncertain ? '重試確認申請' : '送出資格申請'}
      </button>
    </form>
  );
}
