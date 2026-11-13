'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTronClassAuthorityError, type TronClassAgentClient, type TronClassAgentQuestion } from '@/lib/tronClassAgentClient';
import type { TronClassAgentAction } from '@/lib/tronClassAgentTypes';
import { tronClassErrorMessage, tronClassUploadKey, TronClassRequestError } from '@/lib/tronClassIntegrationClient';
import { TronClassAgentAccess } from '@/features/tronclass/TronClassAgentAccess';
import { TronClassAssignment } from '@/features/tronclass/TronClassAssignment';
import { SourceLink, tronClassTime } from '@/features/tronclass/TronClassSource';
import type { V2Turn } from './types';
import styles from './AssistantTronClassResult.module.css';

const noAgentWrite = async (): Promise<never> => {
  throw new TronClassRequestError('TRONCLASS_AGENT_WRITE_UNAVAILABLE', '助理目前可準備與預覽作業，正式繳交尚未開放。');
};

export function AssistantTronClassResult({ data, question, client, owner, pending, onAsk, onAuthorityChanged }: {
  data: NonNullable<V2Turn['tronClass']>;
  question: string;
  client: TronClassAgentClient;
  owner: string;
  pending: boolean;
  onAsk: (input: TronClassAgentQuestion) => void;
  onAuthorityChanged: () => void;
}) {
  const result = data.result;
  const [showAccess, setShowAccess] = useState(!!data.accessRequired);
  const [selected, setSelected] = useState(() => result?.preparation
    ? result.snapshot?.homework.find(item => item.courseId === result.preparation!.courseId && item.id === result.preparation!.homeworkId) ?? null
    : null);
  const [changed, setChanged] = useState(false);
  const inactive = changed || !!data.inactive;
  const authorityChanged = useRef(onAuthorityChanged);
  useEffect(() => { authorityChanged.current = onAuthorityChanged; }, [onAuthorityChanged]);
  const invalidate = useCallback(() => {
    setSelected(null);
    setChanged(true);
    authorityChanged.current();
  }, []);
  const preparations = useRef(new Set<AbortController>());
  useEffect(() => {
    const requests = preparations.current;
    return () => {
      for (const controller of requests) controller.abort();
      requests.clear();
    };
  }, [client, owner, result?.revision, inactive]);
  const preparationClient = useMemo(() => ({
    prepare: async (courseId: number, homeworkId: number) => {
      const controller = new AbortController();
      preparations.current.add(controller);
      try { return await client.prepare(courseId, homeworkId, controller.signal); }
      catch (reason) {
        if (!controller.signal.aborted && isTronClassAuthorityError(reason)) invalidate();
        throw reason;
      }
      finally { preparations.current.delete(controller); }
    },
    upload: noAgentWrite, submit: noAgentWrite, reconcile: noAgentWrite,
  }), [client, invalidate]);
  const snapshot = result?.snapshot;
  const showHomework = result && ['homework', 'prepare'].includes(result.intent);
  const showMaterials = result && ['materials', 'download'].includes(result.intent);
  return <div className={styles.result} aria-label="TronClass 查詢結果">
    {data.unconnected && <Link className="btn" href="/tronclass">連接 TronClass</Link>}
    {result && <>
      <p className={styles.meta}>來源：靜宜大學 TronClass · 查詢時間：{tronClassTime(result.fetchedAt)}</p>
      {result.selection === 'course' || result.intent === 'courses' ? <div className={styles.choices} role="group" aria-label="選擇 TronClass 課程">
        {snapshot?.courses.map(course => <button key={course.id} className={styles.choice} disabled={pending || inactive}
          onClick={() => onAsk({ question: result.selection === 'course' ? question : '查詢 TronClass 作業', courseId: course.id })}>
          <strong>{course.name}</strong>
          <span>{[course.code, course.semester, ...course.teachers].filter(Boolean).join(' · ')}</span>
          <span>{result.selection === 'course' ? '選擇這門課繼續' : '查詢這門課的作業'}</span>
        </button>)}
      </div> : null}
      {showHomework && !!snapshot?.homework.length && <ul className={styles.items} aria-label="TronClass 作業">
        {snapshot.homework.map(homework => {
          const action = result.actions.find(action => action.kind === 'prepare_homework' && action.courseId === homework.courseId && action.homeworkId === homework.id);
          return <li key={`${homework.courseId}:${homework.id}`}>
            <h4>{homework.title}</h4>
            <p className={styles.meta}>{homework.courseName} · {homework.deadline ? `${tronClassTime(homework.deadline)} 截止` : homework.deadlineLabel || '未提供截止時間'}</p>
            <p className={styles.meta}>{homework.submitted === true ? '已繳交' : homework.submitted === false ? '尚未繳交' : '尚未確認繳交狀態'}</p>
            {homework.description && <details><summary>作業要求</summary><p className={styles.literal}>{homework.description}</p></details>}
            {action && <button className="btn" disabled={pending || inactive}
              onClick={() => onAsk({ question: '幫我準備 TronClass 作業', courseId: homework.courseId, homeworkId: homework.id })}>準備 {homework.title}</button>}
          </li>;
        })}
      </ul>}
      {result.intent === 'announcements' && !!snapshot?.announcements.length && <ul className={styles.items} aria-label="TronClass 公告">
        {snapshot.announcements.map(item => <li key={`${item.courseId}:${item.id}`}>
          <h4>{item.title}</h4><p className={styles.meta}>{item.courseName}{item.publishedAt ? ` · ${tronClassTime(item.publishedAt)}` : ''}</p>
          <p className={styles.literal}>{item.content}</p>
          <SourceLink href={item.href}>查看公告來源</SourceLink>
        </li>)}
      </ul>}
      {showMaterials && !!snapshot?.materials.length && <ul className={styles.items} aria-label="TronClass 教材">
        {snapshot.materials.map(material => <li key={`${material.courseId}:${material.id}`}>
          <h4>{material.title}</h4><p className={styles.meta}>{material.courseName}</p>
          {material.files.map((file, index) => {
            const action = result.actions.find(action => action.kind === 'download_material' && action.courseId === material.courseId && String(action.activityId) === String(material.id) && action.uploadKey === tronClassUploadKey(file.downloadHref));
            return action ? null : <p key={index} className={styles.meta}>{file.name}{!file.allowDownload ? ' · 此附件未開放下載' : !result.capabilities.downloadMaterials ? ' · 尚未允許助理下載' : ' · 尚無可確認的下載方式'}</p>;
          })}
          {!inactive && result.actions.map(action => action.kind === 'download_material' && action.courseId === material.courseId && String(action.activityId) === String(material.id)
            ? <AgentMaterialDownload key={`${action.id}:${result.requestId}`} action={action} client={client} disabled={pending} onAuthorityChanged={invalidate} /> : null)}
          {!material.files.length && <SourceLink href={material.href}>查看教材來源</SourceLink>}
        </li>)}
      </ul>}
      {snapshot?.partial && <p className={styles.notice}>部分資料尚未查詢完成，這份清單可能不完整。請依下方紀錄重新查詢。</p>}
      {!!snapshot?.errors.length && <ul className={styles.meta}>{snapshot.errors.map((item, index) => <li key={index}>{item.message}</li>)}</ul>}
      {selected && !inactive && <TronClassAssignment key={`${owner}:${result.revision}:${selected.courseId}:${selected.id}`}
        client={preparationClient} revision={result.revision} owner={owner} homework={selected} prepareOnly
        onClose={() => setSelected(null)} onBusy={() => undefined} onSubmitted={() => undefined}
        onConnectionChanged={invalidate} />}
      <details className={styles.record}>
        <summary>操作紀錄與可用功能</summary>
        <p className={styles.meta}>查詢時間：{tronClassTime(result.fetchedAt)}</p>
        {result.steps.length > 0 && <ol>{result.steps.map(step => <li key={step.id}>
          <strong>{step.status === 'completed' ? '已完成' : step.status === 'partial' ? '部分完成' : '未執行'}</strong> · {step.message}
        </li>)}</ol>}
        <ul>
          <li>查詢課程資料：{result.capabilities.readCourseData ? '已開啟' : '尚未開啟'}</li>
          <li>下載教材：{result.capabilities.downloadMaterials ? '已開啟' : '尚未開啟'}</li>
          <li>準備作業預覽：{result.capabilities.prepareHomework ? '已開啟' : '尚未開啟'}</li>
          <li>正式送出作業：尚未開放</li>
        </ul>
        {result.capabilities.limitations.map((limitation, index) => <p key={index} className={styles.meta}>{limitation}</p>)}
      </details>
    </>}
    {inactive && <p role="status" className={styles.notice}>連接或權限已更新，請重新查詢以使用目前的設定。</p>}
    <div className={styles.actions}>
      <button className="btn" disabled={pending} onClick={() => onAsk({ question })}>重新查詢 TronClass</button>
      <button className={styles.textButton} onClick={() => setShowAccess(value => !value)}>{showAccess ? '收起助理權限' : '管理 TronClass 助理權限'}</button>
      <Link href="/tronclass" className={styles.textButton}>TronClass 課程空間</Link>
    </div>
    {showAccess && <TronClassAgentAccess client={client} compact revision={inactive ? undefined : result?.revision}
      expectedVersion={inactive ? undefined : result?.grantVersion}
      onSaved={invalidate} onConnectionChanged={invalidate} />}
  </div>;
}

function AgentMaterialDownload({ action, client, disabled, onAuthorityChanged }: {
  action: Extract<TronClassAgentAction, { kind: 'download_material' }>;
  client: TronClassAgentClient;
  disabled: boolean;
  onAuthorityChanged: () => void;
}) {
  const [status, setStatus] = useState<'ready' | 'downloading' | 'downloaded' | 'failed'>('ready');
  const [message, setMessage] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const download = useCallback(async (controller: AbortController) => {
    if (lock.current || controller.signal.aborted) return;
    lock.current = true;
    setStatus('downloading');
    setMessage('');
    try {
      const file = await client.downloadMaterial({ courseId: action.courseId, activityId: action.activityId,
        uploadKey: action.uploadKey, revision: action.revision }, controller.signal);
      if (controller.signal.aborted) return;
      const href = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = file.filename;
      document.body.appendChild(link);
      try { link.click(); } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }
      setStatus('downloaded');
      setMessage(`已開始下載 ${file.filename} · ${tronClassTime(new Date().toISOString())}`);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setStatus('failed');
      setMessage(tronClassErrorMessage(reason));
      if (isTronClassAuthorityError(reason)) onAuthorityChanged();
    } finally { lock.current = false; }
  }, [action, client, onAuthorityChanged]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    // A single explicit, verified download request may run immediately. Deferring
    // lets Strict Mode's first cleanup cancel before any network request begins.
    if (action.automatic) void Promise.resolve().then(() => {
      if (!controller.signal.aborted) void download(controller);
    });
    return () => controller.abort();
  }, [action.automatic, download]);

  return <div className={styles.download}>
    <button className="btn" disabled={disabled || status === 'downloading'}
      onClick={() => { if (lifetime.current) void download(lifetime.current); }}>
      {status === 'downloading' ? '正在下載' : status === 'downloaded' ? '再次下載' : '下載'} {action.name}
    </button>
    {message && <p role={status === 'failed' ? 'alert' : 'status'} className={status === 'failed' ? styles.error : styles.meta}>{message}</p>}
  </div>;
}
