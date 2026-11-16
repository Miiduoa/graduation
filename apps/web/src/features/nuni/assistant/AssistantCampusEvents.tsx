import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { campusEventPreviewIssue, campusEventTargetKey, parseAssistantCampusEventTargets,
  type AssistantCampusEventTarget } from '@/lib/assistantCampusEvent';
import styles from './AssistantCampusEvents.module.css';

export function AssistantCampusEvents({ targets: raw, schoolId, pending, blockedReason, sourceOnly = false, onSelect }: {
  targets: unknown;
  schoolId: string;
  pending: boolean;
  blockedReason?: string;
  sourceOnly?: boolean;
  onSelect?: (target: AssistantCampusEventTarget) => void;
}) {
  const id = useId();
  const targets = parseAssistantCampusEventTargets(raw, schoolId);
  const [now, setNow] = useState(() => Date.now());
  const nextStart = Math.min(...targets.map(target => Date.parse(target.startsAt)).filter(start => start > now));
  useEffect(() => {
    if (!Number.isFinite(nextStart)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(nextStart - Date.now() + 1, 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [nextStart, now]);
  if (!targets.length) return null;
  return <section className={styles.results} aria-label={sourceOnly ? '活動來源行程' : '選擇活動加入行事曆'}>
    <h3>{sourceOnly ? '活動來源行程' : '選擇要加入的活動'}</h3>
    <p className={styles.note}>{sourceOnly
      ? '這筆行程依活動來源準備，只保存標題與時間，地點僅供來源參考。如需更新，請重新查詢來源後再準備。'
      : '請選擇一筆活動。我會重新核對來源並列出確認卡，只保存標題與時間；確認後才加入個人行事曆，不會替你報名。'}</p>
    {!sourceOnly && blockedReason && <p id={id + '-blocked'} className={styles.blocked} role="status">{blockedReason}</p>}
    <ul className={styles.list}>
      {targets.map((target, index) => {
        const issue = campusEventPreviewIssue(target, now);
        return <li key={campusEventTargetKey(target)} className={styles.item}>
          <h4>{!sourceOnly && <span className={styles.ordinal}>第 {index + 1} 筆 · </span>}{target.title}</h4>
          <p className={styles.when}>
            {formatTaipeiDateTime(target.startsAt, { seconds: false })}
            {target.endsAt ? ` ～ ${formatTaipeiDateTime(target.endsAt, { seconds: false })}` : ' · 結束時間未提供'}（台灣時間）
          </p>
          {target.location && <p className={styles.note}>來源地點：{target.location}</p>}
          <p className={styles.checked}>來源核對：{formatTaipeiDateTime(target.checkedAt, { seconds: false })}（台灣時間）</p>
          {!sourceOnly && issue && <p id={`${id}-issue-${index}`} className={styles.note}>{issue}</p>}
          <div className={styles.actions}>
            {!sourceOnly && onSelect && <button type="button" className={styles.prepare}
              aria-label={`將${target.title}加入個人行事曆`}
              aria-describedby={blockedReason ? id + '-blocked' : issue ? `${id}-issue-${index}` : undefined}
              disabled={pending || !!blockedReason || !!issue}
              onClick={() => {
                if (!pending && !blockedReason && !campusEventPreviewIssue(target, Date.now())) onSelect(target);
              }}>加入個人行事曆</button>}
            <Link className={styles.source} href={target.href}>{sourceOnly ? '重新查看活動來源' : '查看活動來源'}</Link>
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
