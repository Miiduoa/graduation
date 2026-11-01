import {
  validatePersonalImportRow,
  type PersonalImportRow,
  type PeriodProfileId,
} from '@campus/shared';
import { REVIEW_DAYS, reviewCellRows, reviewPeriods } from '@campus/shared/src/imports/reviewGrid';
import styles from './PersonalImport.module.css';

export function TimetableReviewGrid({
  rows,
  profile,
  disabled,
  editedIds = [],
  onEdit,
  onAdd,
}: {
  rows: PersonalImportRow[];
  profile?: PeriodProfileId;
  disabled: boolean;
  editedIds?: string[];
  onEdit(row: PersonalImportRow): void;
  onAdd(day: number, period: number): void;
}) {
  return (
    <div className={styles.weekGrid} tabIndex={0} aria-label="週課表核對，可橫向捲動">
      <table>
        <caption>點課程修正；點空格補課。跨節課可在欄位下方拆分。</caption>
        <thead>
          <tr>
            <th scope="col">節次</th>
            {REVIEW_DAYS.map((day) => (
              <th scope="col" key={day}>
                星期{day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reviewPeriods(rows, profile).map((period) => (
            <tr key={period.index}>
              <th scope="row">{period.label}</th>
              {REVIEW_DAYS.map((day, index) => {
                const entries = reviewCellRows(rows, index + 1, period.index);
                return (
                  <td key={day}>
                    {entries.length ? (
                      entries.map((row) => (
                        <button
                          className="btn"
                          type="button"
                          key={row.id}
                          disabled={disabled}
                          onClick={() => onEdit(row)}
                          aria-label={`修正星期${day}第${period.label}節 ${row.title || '未命名課程'}`}
                        >
                          {row.title || '名稱待填'}
                          <small>
                            {validatePersonalImportRow(row, { periodProfile: profile }).some(
                              (issue) => issue.severity === 'error',
                            )
                              ? '需修正'
                              : editedIds.includes(row.id)
                                ? '已手動修改'
                                : '待核對'}
                            {entries.length > 1 ? ' · 時段重疊' : ''}
                          </small>
                          <small>{row.location || '教室待填'}</small>
                        </button>
                      ))
                    ) : (
                      <button
                        className="btn"
                        type="button"
                        disabled={disabled}
                        onClick={() => onAdd(index + 1, period.index)}
                        aria-label={`新增星期${day}第${period.label}節`}
                      >
                        ＋
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
