'use client';

import Link from 'next/link';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthGuard';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { SchoolLearningLinks } from '@/components/academic/SchoolLearningLinks';
import { SiteShell } from '@/components/SiteShell';
import { AcademicConnectionError } from '@/lib/academicClient';
import { isOfficialAcademicSchool } from '@/lib/academicOfficialSchool';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useSignInOptions } from '@/lib/signInOptions';
import { findLmsHomework, loadTronClassLms } from '@/lib/tronClassLms';
import {
  isLmsConnectingRetryReason,
  LMS_CONNECTING_RETRY_LIMIT,
  lmsConnectingRetryDelayMs,
} from '@/lib/lmsConnectingRetry';
import { loadFailureCopy } from '@campus/shared/src/loadFailureCopy';
import styles from '@/components/academic/academic.module.css';
import lmsStyles from '../../../schoolLms.module.css';

function idsFrom(value: string) {
  return /^[1-9]\d*$/.test(value) ? Number(value) : null;
}

export default function HomeworkDetailPage() {
  const { user, loading, error } = useAuth();
  const path = usePathname();
  const search = useSearchParams();
  const route = useParams<{ courseId?: string; homeworkId?: string }>();
  const browse = useCampusBrowseContext({
    school: search.get('school') ?? undefined,
    schoolId: search.get('schoolId') ?? undefined,
    campus: search.get('campus') ?? undefined,
  });
  const returnUrl = `${path}${browse.schoolSearch}`;
  const courseId = idsFrom(String(route.courseId || ''));
  const homeworkId = idsFrom(String(route.homeworkId || ''));
  return (
    <SiteShell title="作業說明" subtitle="查看本校課堂作業說明。">
      {browse.status === 'loading' || (isOfficialAcademicSchool(browse.schoolId) && loading) ? (
        <div className={styles.status} role="status">正在確認學校與帳號…</div>
      ) : browse.status === 'error' || (isOfficialAcademicSchool(browse.schoolId) && error) ? (
        <section className={styles.status} role="alert"><h2>暫時無法確認學校與帳號</h2></section>
      ) : browse.status !== 'ready' || !browse.schoolId ? (
        <section className={styles.status}><h2>請先選擇一所學校</h2></section>
      ) : !isOfficialAcademicSchool(browse.schoolId) ? (
        <SchoolLearningLinks schoolId={browse.schoolId} schoolName={browse.schoolName} />
      ) : !user ? (
        <SchoolAccountRequired returnUrl={returnUrl} alternative="請先至玩課雲查看作業。" />
      ) : !courseId || !homeworkId ? (
        <section className={styles.status} role="alert"><h2>作業連結無效</h2>
          <p><Link href={`/school-lms${browse.schoolSearch}`}>回到作業清單</Link></p></section>
      ) : (
        <HomeworkDetail
          key={JSON.stringify([user.uid, browse.schoolId, courseId, homeworkId])}
          uid={user.uid} courseId={courseId} homeworkId={homeworkId}
          returnUrl={returnUrl} listUrl={`/school-lms${browse.schoolSearch}`}
        />
      )}
    </SiteShell>
  );
}

function HomeworkDetail({ uid, courseId, homeworkId, returnUrl, listUrl }: {
  uid: string; courseId: number; homeworkId: number; returnUrl: string; listUrl: string;
}) {
  const options = useSignInOptions();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reason, setReason] = useState<string>('unavailable');
  const [autoTries, setAutoTries] = useState(0);
  const [reload, setReload] = useState(0);
  const [item, setItem] = useState<ReturnType<typeof findLmsHomework>>();
  const connecting = state === 'error' && isLmsConnectingRetryReason(reason);

  useEffect(() => {
    let active = true;
    void loadTronClassLms(uid, { expectedSchool: 'pu' }).then((snapshot) => {
      if (!active) return;
      if (snapshot.ownerUid !== uid || snapshot.schoolId !== 'pu') throw new AcademicConnectionError('unavailable');
      setItem(findLmsHomework(snapshot, courseId, homeworkId));
      setState('ready');
    }).catch((caught: unknown) => {
      if (!active) return;
      setReason(caught instanceof AcademicConnectionError ? caught.reason : 'unavailable');
      setState('error');
    });
    return () => { active = false; };
  }, [uid, courseId, homeworkId, reload]);

  useEffect(() => {
    if (!connecting || autoTries >= LMS_CONNECTING_RETRY_LIMIT) return;
    const timer = window.setTimeout(() => {
      setAutoTries((value) => value + 1);
      setState('loading');
      setReload((value) => value + 1);
    }, lmsConnectingRetryDelayMs(autoTries));
    return () => window.clearTimeout(timer);
  }, [connecting, autoTries, reload]);

  return state === 'loading' ? (
    <div className={styles.status} role="status">正在讀取作業說明…</div>
  ) : connecting ? (
    <section className={styles.status} role="status">
      <h2>正在連線玩課雲</h2>
      <p>{autoTries >= LMS_CONNECTING_RETRY_LIMIT
        ? '還沒連上玩課雲，請稍後按重新讀取。'
        : '正在連線玩課雲。登入後會在背景接上課堂，完成後會自動再讀取。'}</p>
      <div className={styles.actions}>
        <button type="button" className="btn primary" onClick={() => {
          setAutoTries(0);
          setState('loading');
          setReload((value) => value + 1);
        }}>重新讀取</button>
        <Link className="btn" href={listUrl}>回到作業清單</Link>
      </div>
    </section>
  ) : state === 'error' ? (
    <section className={styles.status} role="alert">
      <h2>{reason === 'reconnect' || reason === 'permission' ? '請重新連線 WOW Class' : '暫時無法讀取作業說明'}</h2>
      <p>{reason === 'reconnect' || reason === 'permission'
        ? '請重新連線學校帳號後再打開這份作業。'
        : loadFailureCopy(new Error(reason), { online: navigator.onLine })}</p>
      <div className={styles.actions}>
        {(reason === 'reconnect' || reason === 'permission') && options.studentId ? (
          <Link className="btn primary" href={`/login?reconnect=school&returnUrl=${encodeURIComponent(returnUrl)}`}>重新連線學校帳號</Link>
        ) : null}
        <Link className="btn" href={listUrl}>回到作業清單</Link>
      </div>
    </section>
  ) : !item ? (
    <section className={styles.status} role="status">
      <h2>這次讀取裡沒有這份作業</h2>
      <p>不會用空白說明充數。請改到玩課雲查看，或回到清單重新整理。</p>
      <div className={styles.actions}>
        <Link className="btn" href={listUrl}>回到作業清單</Link>
        <a className="btn" href={`https://tronclass.pu.edu.tw/course/${courseId}/content#/activity/${homeworkId}`} target="_blank" rel="noopener noreferrer">玩課雲同一筆 ↗</a>
      </div>
    </section>
  ) : (
    <article className={lmsStyles.detail}>
      <p className={lmsStyles.meta}>{item.courseName} · {item.submitted ? '已交' : '未交'} · {item.deadlineLabel || '截止時間未提供'}</p>
      <h2>{item.title}</h2>
      <p>{item.description || '學校這次沒有回傳作業說明文字。'}</p>
      <div className={lmsStyles.actions}>
        <a className="btn primary" href={item.href} target="_blank" rel="noopener noreferrer">玩課雲同一筆 ↗</a>
        <Link className="btn" href={listUrl}>回到作業清單</Link>
      </div>
    </article>
  );
}
