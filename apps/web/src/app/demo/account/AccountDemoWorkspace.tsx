'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCOUNT_DEMO_ACTION_FEATURES,
  ACCOUNT_DEMO_ACTION_LABELS,
  ACCOUNT_DEMO_FEATURE_LABELS,
  ACCOUNT_DEMO_FEATURES,
  applyAccountDemoAction,
  createAccountDemoPermissions,
  type AccountDemoAction,
  type AccountDemoFeature,
  type AccountDemoPermissions,
  type AccountDemoSnapshot,
  type AccountDemoStateKey,
} from '@campus/shared/src/accountDemo';
import { NuniError } from '@campus/shared/src/nuni';
import { SiteShell } from '@/components/SiteShell';
import { ConfirmModal } from '@/components/ui/Modal';
import { browserRequest, useOptionalNuniSession } from '@/features/nuni/Session';
import { parseOwnedAccountDemo, readAccountDemo } from '@/lib/accountDemoClient';
import {
  getPersonalImportSyncStatus,
  setPersonalImportSyncEnabled,
  syncPersonalImports,
} from '@/lib/personalImportSync';
import { readPersonalImports } from '@/lib/personalImports';
import styles from './accountDemo.module.css';

const MODULES: {
  title: string;
  detail: string;
  feature: AccountDemoFeature;
  actions: AccountDemoStateKey[];
}[] = [
  {
    title: '課堂與作業',
    detail: '從學生繳交 ER 圖作業到教師發布成績，查看兩端進度。',
    feature: 'coursework',
    actions: ['submitAssignment', 'publishGrade'],
  },
  {
    title: '點名與請假',
    detail: '完成課堂簽到，將請假申請交給示範教師審核。',
    feature: 'attendance',
    actions: ['checkIn', 'requestLeave', 'approveLeave'],
  },
  {
    title: '午餐與取餐',
    detail: '香煎雞腿飯 1 份，取餐時間 12:10，展示訂單建立與店家備餐。',
    feature: 'food',
    actions: ['createOrder', 'readyOrder'],
  },
  {
    title: '圖書館',
    detail: '預約 3 樓 A12 自習座位，續借《資料庫系統實務》。',
    feature: 'library',
    actions: ['reserveSeat', 'renewBook'],
  },
  {
    title: '宿舍生活',
    detail: '篤行學苑 A305：書桌檯燈無法亮起，附註晚間方便檢修。',
    feature: 'dormitory',
    actions: ['requestRepair'],
  },
  {
    title: '社群與訊息',
    detail: '發布專題彩排限時動態，傳送集合提醒到本人的示範對話。',
    feature: 'community',
    actions: ['postStory', 'sendMessage'],
  },
  {
    title: '校園管理',
    detail: '在此展示資料中發布「專題成果展示準備會」公告。',
    feature: 'administration',
    actions: ['postAnnouncement'],
  },
];

function message(error: unknown): string {
  if (error instanceof NuniError) {
    if (error.status === 409) return '資料已在其他畫面更新，請重新讀取後再操作。';
    if (error.status === 401) return '登入已失效，請重新登入。';
    if (error.code === 'DEMO_FEATURE_DISABLED') return '這項展示權限已關閉，請先在下方開啟。';
    if (error.status === 403) return '目前帳號的展示權限已變更，請重新讀取。';
  }
  return '暫時無法確認儲存結果，請重新讀取進度後再操作。';
}

function Workspace({ accountId, context }: { accountId: string; context: string }) {
  const [demo, setDemo] = useState<AccountDemoSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<AccountDemoAction | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setPending(null);
    try {
      const next = await readAccountDemo(context, accountId);
      if (!active.current || request !== generation.current) return;
      setDemo(next);
      setError('');
    } catch (failure) {
      if (!active.current || request !== generation.current) return;
      setDemo(null);
      setError(message(failure));
    } finally {
      if (active.current && request === generation.current) setLoading(false);
    }
  }, [accountId, context]);

  useEffect(() => {
    active.current = true;
    void reload();
    const focus = () => {
      void reload();
    };
    window.addEventListener('focus', focus);
    return () => {
      active.current = false;
      generation.current += 1;
      window.removeEventListener('focus', focus);
    };
  }, [reload]);

  useEffect(() => {
    if (!demo) return;
    const deadline = setTimeout(
      () => {
        generation.current += 1;
        setDemo(null);
        setPending(null);
        setNotice('');
        setBusy(false);
      },
      Math.min(2_147_483_647, Math.max(0, Date.parse(demo.expiresAt) - Date.now())),
    );
    return () => clearTimeout(deadline);
  }, [demo]);

  async function mutate(
    change: { permissions: AccountDemoPermissions } | { action: AccountDemoAction },
  ) {
    if (!demo || busy || loading || inFlight.current || Date.parse(demo.expiresAt) <= Date.now())
      return;
    inFlight.current = true;
    const current = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await browserRequest('account-demo', context, {
        expectedRevision: demo.revision,
        ...change,
      });
      if (!active.current || current !== generation.current) return;
      const next = parseOwnedAccountDemo(result, accountId);
      const expectedPermissions = 'permissions' in change ? change.permissions : demo.permissions;
      const expectedState =
        'action' in change ? applyAccountDemoAction(demo, change.action) : demo.state;
      if (
        !next ||
        next.revision !== demo.revision + 1 ||
        JSON.stringify(next.permissions) !== JSON.stringify(expectedPermissions) ||
        JSON.stringify(next.state) !== JSON.stringify(expectedState)
      )
        throw new Error('未收到相符的儲存回執。');
      setDemo(next);
      setPending(null);
      setNotice(
        'permissions' in change
          ? '展示權限已儲存。'
          : change.action === 'reset'
            ? '展示進度已重設，權限設定保留。'
            : `${ACCOUNT_DEMO_ACTION_LABELS[change.action]}：展示紀錄已儲存。`,
      );
    } catch (failure) {
      if (active.current && current === generation.current) {
        setError(message(failure));
        setPending(null);
      }
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function loadImports() {
    if (
      !demo?.permissions.timetable ||
      busy ||
      loading ||
      inFlight.current ||
      Date.parse(demo.expiresAt) <= Date.now()
    )
      return;
    inFlight.current = true;
    const current = ++generation.current;
    const scope = { owner: `platform:${accountId}`, schoolId: demo.profile.schoolId };
    const isCurrent = () =>
      active.current && current === generation.current && Date.parse(demo.expiresAt) > Date.now();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // The existing reconciliation engine preserves device edits and reports conflicts.
      await setPersonalImportSyncEnabled(scope, true, isCurrent);
      await syncPersonalImports(scope, { platformAccountId: accountId, context }, isCurrent);
      if (!isCurrent()) return;
      const result = getPersonalImportSyncStatus(scope);
      if (result?.phase !== 'synced') {
        setError(result?.message || '同步尚未完成，請稍後重新讀取。');
        return;
      }
      const count = readPersonalImports(scope).length;
      setNotice(`已載入 ${count} 筆本人課表、行程與成績資料。現在可開啟課表，或請助理整理。`);
    } catch (failure) {
      if (isCurrent())
        setError(failure instanceof Error ? failure.message : '資料尚未載入，請稍後重試。');
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  const blocked = busy || loading || Boolean(error);
  const schoolSearch = demo ? `?campus=${encodeURIComponent(demo.profile.schoolId)}` : '';
  const summary = demo
    ? [
        demo.state.submitAssignment ? '資料庫 ER 圖作業已繳交' : '資料庫 ER 圖作業待繳交',
        demo.state.checkIn ? '今天已簽到' : '今天尚未簽到',
        demo.state.approveLeave ? '請假已核准' : demo.state.requestLeave ? '請假待審核' : null,
        demo.state.readyOrder ? '雞腿飯已可取餐' : demo.state.createOrder ? '雞腿飯正在備餐' : null,
        demo.state.requestRepair ? '宿舍報修紀錄已建立' : null,
      ]
        .filter(Boolean)
        .join('；')
    : '';

  return (
    <SiteShell
      title="我的展示工作區"
      subtitle="用自己的帳號，完整走過一天的校園生活。"
      schoolName={demo?.profile.schoolName}
    >
      <div className={styles.workspace}>
        {loading ? <p role="status">正在核對帳號與展示資料…</p> : null}
        {error ? (
          <div role="alert" className={styles.error}>
            <p>{error}</p>
            <button type="button" disabled={busy} onClick={() => void reload()}>
              重新讀取
            </button>
          </div>
        ) : null}
        {notice ? (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        ) : null}
        {!loading && !demo && !error ? (
          <section className={styles.panel}>
            <h2>此帳號尚未開通展示資料</h2>
            <p>請使用已指定的展示帳號登入。</p>
            <Link href="/settings?section=account">查看目前帳號</Link>
          </section>
        ) : null}
        {demo ? (
          <>
            <section className={styles.hero}>
              <div>
                <span className={styles.eyebrow}>ACCOUNT DEMO · 帳號展示</span>
                <h2>{demo.profile.displayName}，資料已備妥</h2>
                <p>
                  {demo.profile.department} · {demo.profile.schoolName}
                </p>
                <p className={styles.explanation}>
                  以下是此帳號專屬的展示資料；操作進度會儲存，重新登入後可接續。
                </p>
              </div>
              <Link className={styles.cardLink} href={`/student-card${schoolSearch}`}>
                開啟展示學生證 <span aria-hidden="true">↗</span>
              </Link>
            </section>

            <section className={styles.panel} aria-labelledby="account-data-title">
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>01 · 準備展示</span>
                  <h2 id="account-data-title">把資料帶進日常頁面</h2>
                </div>
                <span className={styles.tag}>本人帳號</span>
              </div>
              <p>
                課程、教材、作業與測驗可直接從「課程與作業」開啟。第一次使用這台裝置，先同步課表與行程，再從首頁請助理查看。
              </p>
              <div className={styles.links}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={blocked || !demo.permissions.timetable}
                  onClick={() => void loadImports()}
                >
                  同步我的課表與行程
                </button>
                <Link href={`/classroom${schoolSearch}`}>課程與作業 ↗</Link>
                <Link href={`/timetable${schoolSearch}`}>我的課表 ↗</Link>
                <Link href={`/assistant${schoolSearch}`}>開啟助理 ↗</Link>
              </div>
            </section>

            <section className={styles.panel} aria-labelledby="account-flow-title">
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>02 · 情境操作</span>
                  <h2 id="account-flow-title">從上課到放學</h2>
                </div>
                <span className={styles.tag}>合成展示情境</span>
              </div>
              <p>這裡的訂單、請假、報修與訊息留在本人展示紀錄，方便演示雙方的處理流程。</p>
              <div className={styles.modules}>
                {MODULES.map((module) => (
                  <article className={styles.module} key={module.title}>
                    <h3>{module.title}</h3>
                    <p>{module.detail}</p>
                    <div className={styles.actions}>
                      {module.actions.map((action) => {
                        const allowed = ACCOUNT_DEMO_ACTION_FEATURES[action].every(
                          (feature) => demo.permissions[feature],
                        );
                        const ready =
                          action === 'approveLeave'
                            ? demo.state.requestLeave
                            : action === 'publishGrade'
                              ? demo.state.submitAssignment
                              : action === 'readyOrder'
                                ? demo.state.createOrder
                                : true;
                        return (
                          <button
                            type="button"
                            key={action}
                            disabled={blocked || !allowed || !ready || demo.state[action]}
                            onClick={() => setPending(action)}
                          >
                            {demo.state[action] ? '✓ ' : ''}
                            {ACCOUNT_DEMO_ACTION_LABELS[action]}
                            {!allowed ? '（已關閉）' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
              {demo.permissions.assistant ? (
                <aside className={styles.summary} aria-label="展示狀態摘要">
                  <h3>目前進度</h3>
                  <p>{summary}。</p>
                  <p className={styles.explanation}>
                    摘要依本帳號的展示紀錄更新；日常課業查詢請使用上方的助理入口。
                  </p>
                </aside>
              ) : null}
            </section>

            <section className={styles.panel} aria-labelledby="account-permissions-title">
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>03 · 權限管理</span>
                  <h2 id="account-permissions-title">展示權限</h2>
                </div>
                <button
                  type="button"
                  disabled={
                    blocked || ACCOUNT_DEMO_FEATURES.every((feature) => demo.permissions[feature])
                  }
                  onClick={() => void mutate({ permissions: createAccountDemoPermissions(true) })}
                >
                  全部開啟
                </button>
              </div>
              <p>
                每個開關都會儲存到目前帳號。關閉後，對應展示操作會停止；正式校園服務仍依原本的身分授權。
              </p>
              <div className={styles.permissions}>
                {ACCOUNT_DEMO_FEATURES.map((feature) => (
                  <label className={styles.permission} key={feature}>
                    <span>{ACCOUNT_DEMO_FEATURE_LABELS[feature]}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-label={`${ACCOUNT_DEMO_FEATURE_LABELS[feature]}展示權限`}
                      aria-checked={demo.permissions[feature]}
                      className={styles.switch}
                      disabled={blocked}
                      onClick={() =>
                        void mutate({
                          permissions: {
                            ...demo.permissions,
                            [feature]: !demo.permissions[feature],
                          },
                        })
                      }
                    >
                      <span />
                    </button>
                  </label>
                ))}
              </div>
            </section>
            <div className={styles.footer}>
              <p>展示進度跟隨帳號儲存。課程與已同步的個人資料不受重設影響。</p>
              <button type="button" disabled={blocked} onClick={() => setPending('reset')}>
                重設展示進度
              </button>
            </div>

            <ConfirmModal
              isOpen={pending !== null}
              onClose={() => setPending(null)}
              title={pending ? ACCOUNT_DEMO_ACTION_LABELS[pending] : '確認展示操作'}
              message={
                pending === 'reset'
                  ? '清除本帳號的展示操作進度，保留已設定的展示權限。'
                  : '此操作會更新本帳號的合成展示紀錄，重新登入後仍可讀取。'
              }
              loading={busy}
              confirmText="確認並儲存"
              onConfirm={() => (pending ? mutate({ action: pending }) : undefined)}
            />
          </>
        ) : null}
      </div>
    </SiteShell>
  );
}

export function AccountDemoWorkspace() {
  const auth = useOptionalNuniSession();
  if (auth?.loading || auth?.pendingLogout)
    return (
      <SiteShell title="我的展示工作區">
        <p role="status">正在確認帳號…</p>
      </SiteShell>
    );
  if (!auth?.session)
    return (
      <SiteShell title="我的展示工作區">
        <section className={styles.panel}>
          <h2>先登入你的展示帳號</h2>
          <p>課表、學生證及操作進度依帳號分開儲存。</p>
          <Link href="/login?returnUrl=%2Fdemo%2Faccount">登入 nuni</Link>
        </section>
      </SiteShell>
    );
  const { platformAccountId, context } = auth.session;
  return (
    <Workspace
      key={`${platformAccountId}:${context}`}
      accountId={platformAccountId}
      context={context}
    />
  );
}
