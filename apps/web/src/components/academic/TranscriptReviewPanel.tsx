import type { AcademicGrade } from '@/lib/academicRecords';
import { summarizeTranscriptReview, transcriptReviewLabel, transcriptReviewReason } from '@/lib/transcriptReview';
import styles from './transcript-review.module.css';

type Props = {
  grades: readonly AcademicGrade[];
  active: boolean;
  onChange: (active: boolean) => void;
};

export function TranscriptReviewPanel({ grades, active, onChange }: Props) {
  const review = summarizeTranscriptReview(grades);
  if (!review.count && !active) return null;
  const details = [
    review.counts.missing ? `成績尚未提供 ${review.counts.missing} 筆` : '',
    review.counts.unrecognized ? `文字結果需核對 ${review.counts.unrecognized} 筆` : '',
    review.counts.invalid ? `數值或格式需核對 ${review.counts.invalid} 筆` : '',
  ].filter(Boolean);
  return (
    <section className={styles.panel} aria-label="成績待核對">
      <div className={styles.heading}>
        <div>
          <h3>{review.count ? `${review.count} 筆成績需要核對` : '目前範圍沒有待核對的成績'}</h3>
          {details.length > 0 && <p>{details.join(' · ')}</p>}
        </div>
        <button type="button" className="btn" aria-pressed={active} onClick={() => onChange(!active)}>
          {active ? '返回全部明細' : `核對 ${review.count} 筆成績`}
        </button>
      </div>
      {review.count > 0 && <p className={styles.scope}>
        {review.affectedCredits === null
          ? '這些紀錄的學分合計尚無法確認。'
          : `這些紀錄共列 ${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 4 }).format(review.affectedCredits)} 學分；不代表已取得或尚缺學分。`}
      </p>}
      <p className={styles.note}>
        只統計所選學期，保留原始成績；未確認的文字不推定及格。核對時保留學期並清除其他明細篩選，不修改校方或個人規劃資料。
      </p>
    </section>
  );
}

export function TranscriptReviewHint({ score }: { score: unknown }) {
  const reason = transcriptReviewReason(score);
  return reason === null ? null : <p className={styles.hint}>{transcriptReviewLabel(reason)}</p>;
}
