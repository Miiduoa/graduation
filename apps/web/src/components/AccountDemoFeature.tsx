'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  ACCOUNT_DEMO_ACTION_FEATURES, ACCOUNT_DEMO_ACTION_LABELS,
  type AccountDemoStateKey,
} from '@campus/shared/src/accountDemo';
import { AccountDemoScope, type AccountDemoController } from './AccountDemoState';
import { AccountDemoImportControl } from './AccountDemoSettings';
import { ConfirmModal } from './ui/Modal';
import styles from './AccountDemo.module.css';

type Feature = { title: string; description: string; actions: AccountDemoStateKey[]; imports?: boolean };
const FEATURES: Record<string, Feature> = {
  '/classroom': { title: '資料庫 ER 圖作業', description: '繳交 ER 圖作業後，可到成績頁接續發布評分。下方課班保留完整教材、作業與測驗。', actions: ['submitAssignment', 'checkIn'] },
  '/grades': { title: '資料庫作業評分', description: 'ER 圖作業已繳交後，可演示教師發布評分的流程。', actions: ['publishGrade'] },
  '/leave': { title: '專題成果展公假', description: '11 月 20 日參加專題成果展，申請完成後可接續審核。', actions: ['requestLeave'] },
  '/leave/review': { title: '專題成果展公假審核', description: '核對本人示範申請，完成教師端審核流程。', actions: ['approveLeave'] },
  '/library': { title: '我的圖書與座位', description: '《資料庫系統實務》借閱紀錄；3 樓 A12 自習座位。', actions: ['reserveSeat', 'renewBook'] },
  '/dormitory': { title: '篤行學苑 A305 報修', description: '書桌檯燈無法亮起，晚間方便檢修。', actions: ['requestRepair'] },
  '/community/me': { title: '專題彩排限時動態', description: '「今天完成專題彩排，成果展見！」', actions: ['postStory'] },
  '/community': { title: '專題彩排限時動態', description: '「今天完成專題彩排，成果展見！」', actions: ['postStory'] },
  '/dms': { title: '專題小組集合提醒', description: '「今天 16:00 在主顧樓集合，記得帶筆電。」', actions: ['sendMessage'] },
  '/announcements': { title: '專題成果展示準備會', description: '11 月 18 日 16:00，主顧樓 305，請攜帶筆電與展示資料。', actions: ['postAnnouncement'] },
  '/timetable': { title: '我的課表資料', description: '此帳號已備妥課表、行程與成績，第一次使用這台裝置時先同步。', actions: [], imports: true },
  '/calendar': { title: '我的行程資料', description: '同步已準備的校園行程，之後也能在首頁請助理直接查詢。', actions: [], imports: true },
};

function FeatureContent({ controller, feature }: { controller: AccountDemoController; feature: Feature }) {
  const { demo, blocked, busy, mutate } = controller;
  const [pending, setPending] = useState<AccountDemoStateKey | null>(null);
  const search = `?campus=${encodeURIComponent(demo.profile.schoolId)}`;
  return <section className={`${styles.workspace} ${styles.panel}`} aria-label="本人合成資料">
    <div className={styles.sectionHeader}><h2>{feature.title}</h2><span className={styles.tag}>本人合成資料</span></div>
    <p>{feature.description}</p>
    {feature.actions.length ? <>
      <ul>{feature.actions.map(action => <li key={action}>{ACCOUNT_DEMO_ACTION_LABELS[action]}：{demo.state[action] ? '已完成' : '尚未完成'}</li>)}</ul>
      <div className={styles.actions}>{feature.actions.map(action => {
        const allowed = ACCOUNT_DEMO_ACTION_FEATURES[action].every(key => demo.permissions[key]);
        const prerequisite = action === 'approveLeave' ? demo.state.requestLeave : action === 'publishGrade' ? demo.state.submitAssignment : true;
        return <button type="button" key={action} disabled={blocked || !allowed || !prerequisite || demo.state[action]}
          onClick={() => setPending(action)}>{demo.state[action] ? '✓ ' : ''}{ACCOUNT_DEMO_ACTION_LABELS[action]}{!allowed ? '（已關閉）' : ''}</button>;
      })}</div>
      <p className={styles.explanation}>此處保存本人的示範紀錄，供演示處理流程。</p>
    </> : null}
    {feature.imports ? <AccountDemoImportControl controller={controller} /> : null}
    <div className={styles.links}>
      {feature.actions.includes('requestLeave') ? <Link href={`/leave/review${search}`}>查看審核</Link> : null}
      {feature.actions.includes('approveLeave') ? <Link href={`/leave${search}`}>查看申請</Link> : null}
      {feature.actions.includes('submitAssignment') ? <Link href={`/grades${search}&tab=feedback`}>查看評分</Link> : null}
      {feature.actions.includes('publishGrade') && !demo.state.submitAssignment ? <Link href={`/classroom${search}`}>先繳交示範作業</Link> : null}
      <Link href={`/settings?section=platform&campus=${encodeURIComponent(demo.profile.schoolId)}#account-demo-permissions`}>資料權限</Link>
    </div>
    <ConfirmModal isOpen={pending !== null} onClose={() => setPending(null)}
      title={pending ? ACCOUNT_DEMO_ACTION_LABELS[pending] : '確認操作'}
      message="確認後會保存本帳號的合成示範紀錄，可在此頁與助理讀取進度。" loading={busy} confirmText="確認並儲存"
      onConfirm={async () => { if (pending && await mutate({ action: pending })) setPending(null); }} />
  </section>;
}

/** Each existing feature displays only its own records, never a separate demo dashboard. */
export function AccountDemoFeature() {
  const pathname = usePathname();
  const feature = pathname ? FEATURES[pathname] : null;
  if (!feature) return null;
  return <AccountDemoScope key={pathname}>{controller => <FeatureContent controller={controller} feature={feature} />}</AccountDemoScope>;
}
