'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  getCampusAssistantSnapshot,
  type CampusAssistantSnapshot,
} from '@/lib/campusAssistantClient';
import styles from './assistant.module.css';

interface Props {
  userId: string;
  schoolId: string;
  revision: number;
  onAsk: (question: string) => void;
}

function dateLabel(value: string | null): string {
  if (!value) return '未設定截止時間';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '截止時間待確認';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function CampusSensePanel({ userId, schoolId, revision, onAsk }: Props) {
  const [snapshot, setSnapshot] = useState<CampusAssistantSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    getCampusAssistantSnapshot(userId, schoolId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSnapshot(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSnapshot(null);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, schoolId, revision, refreshCount]);

  const assignments = snapshot?.assignments;
  const announcements = snapshot?.announcements;
  const schedule = snapshot?.schedule;

  return (
    <section className={styles.sense} aria-label="個人校園情境">
      <div className={styles.senseHeader}>
        <div>
          <span className={styles.eyebrow}>校園情境</span>
          <h2>先看今天值得注意的事</h2>
          <p>僅整理已授權、實際讀取到的資料；沒有連線的服務會另外標示。</p>
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => setRefreshCount((value) => value + 1)}
          disabled={loading}
          aria-label="重新取得校園情境"
        >
          {loading ? '更新中…' : '重新整理'}
        </button>
      </div>
      {failed ? (
        <div className={styles.senseUnavailable} role="status">
          暫時無法讀取此校的個人情境，請確認校籍權限或稍後重新整理。你仍可直接詢問助理。
        </div>
      ) : (
        <div className={styles.senseGrid} aria-busy={loading}>
          <div className={styles.senseItem}>
            <div className={styles.senseItemTop}>
              <span>待處理作業</span>
              <Link href="/today-v2">前往待辦</Link>
            </div>
            {loading && !snapshot ? (
              <p className={styles.senseMuted}>正在確認…</p>
            ) : assignments?.status === 'available' ? (
              <>
                <strong className={styles.senseMetric}>{assignments.count} <small>份</small></strong>
                {assignments.items.length ? (
                  <div className={styles.senseDetails}>
                    {assignments.items.slice(0, 2).map((item, index) => (
                      <p key={index}>
                        <b>{item.title}</b>
                        <span>{item.groupName ? item.groupName + ' · ' : ''}{dateLabel(item.dueAt)}</span>
                      </p>
                    ))}
                  </div>
                ) : <p className={styles.senseMuted}>目前沒有本系統可讀取的待繳作業。</p>}
              </>
            ) : <p className={styles.senseMuted}>尚無法讀取作業資料</p>}
            <button type="button" className={styles.senseAsk} onClick={() => onAsk('幫我整理這週待繳作業的優先順序')}>
              整理優先順序
            </button>
          </div>
          <div className={styles.senseItem}>
            <div className={styles.senseItemTop}>
              <span>最新校園公告</span>
              <Link href="/announcements">查看公告</Link>
            </div>
            {loading && !snapshot ? (
              <p className={styles.senseMuted}>正在確認…</p>
            ) : announcements?.status === 'available' ? (
              <>
                <strong className={styles.senseMetric}>{announcements.items.length} <small>則最新摘要</small></strong>
                {announcements.items.length ? (
                  <div className={styles.senseDetails}>
                    {announcements.items.slice(0, 2).map((item, index) => (
                      <p key={index}><b>{item.title}</b><span>{item.publishedAt ? dateLabel(item.publishedAt) : '公告日期待確認'}</span></p>
                    ))}
                  </div>
                ) : <p className={styles.senseMuted}>目前沒有通過來源檢查的公告。</p>}
              </>
            ) : <p className={styles.senseMuted}>公告來源暫時無法確認</p>}
            <button type="button" className={styles.senseAsk} onClick={() => onAsk('整理和我有關的最新校園公告')}>
              幫我整理公告
            </button>
          </div>
          <div className={styles.senseItem}>
            <div className={styles.senseItemTop}>
              <span>今日課表</span>
              <Link href="/timetable">開啟課表</Link>
            </div>
            {loading && !snapshot ? (
              <p className={styles.senseMuted}>正在確認…</p>
            ) : schedule?.status === 'available' ? (
              <>
                <strong className={styles.senseMetric}>{schedule.count} <small>堂</small></strong>
                <p className={styles.senseMuted}>依已連結的課表資料顯示。</p>
              </>
            ) : (
              <>
                <strong className={styles.sensePending}>尚未連結</strong>
                <p className={styles.senseMuted}>助理目前無法取得正式課表，不能判定今天有沒有課。</p>
              </>
            )}
            <button type="button" className={styles.senseAsk} onClick={() => onAsk('今天的課表目前能查到什麼？')}>
              詢問課表狀態
            </button>
          </div>
        </div>
      )}
      {snapshot && !failed && (
        <p className={styles.senseFootnote}>
          查詢時間：{dateLabel(snapshot.checkedAt)}。資訊可能晚於校務系統更新，重要事項請以來源服務為準。
        </p>
      )}
    </section>
  );
}
