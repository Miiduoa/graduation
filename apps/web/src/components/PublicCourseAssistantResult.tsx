import Link from 'next/link';
import type { PublicCourseAssistantRead } from '@campus/shared/src/publicCourseAssistantClient';
import { formatPublicCatalogFetchedAt } from '@campus/shared/src/publicCourseCatalog';
import { publicCourseFilterLabel, publicCourseWeekdays } from '@campus/shared/src/publicCourseFilters';
import { formatSemester } from '@/lib/academicRecords';
import styles from './PublicCourseAssistantResult.module.css';

/** A read-only result from the reviewed public catalog, separate from action proposals. */
export function PublicCourseAssistantResult({ read }: { read: PublicCourseAssistantRead }) {
  const filterLabel = publicCourseFilterLabel(read.filters);
  return (
    <section className={styles.result} aria-label={`${read.schoolName}公開開課查詢`}>
      <p className={styles.eyebrow}>校方公開資料</p>
      <h3>{read.schoolName}開課查詢</h3>
      <p className={styles.meta}>{read.query ? `查詢「${read.query}」` : filterLabel ? '關鍵字不限' : '瀏覽公開開課清單'}</p>
      {filterLabel && <p className={styles.filters}>{read.status === 'ready' ? '已套用條件' : '查詢條件'}：{filterLabel}</p>}
      {read.filters?.weekday !== undefined && <p className={styles.meta}>當天有課，也可能在其他天上課。</p>}
      {read.status === 'ready' ? (
        <>
          {read.matchCount > 0 && (
            <p className={styles.meta}>
              本次取得 {read.matchCount} 筆開課資料
              {read.matchCount > read.courses.length ? `，這裡先顯示 ${Math.min(read.courses.length, 5)} 筆` : ''}。
            </p>
          )}
          {read.courses.length > 0 ? (
            <ul className={styles.courses}>
              {read.courses.slice(0, 5).map((course, index) => (
                <li key={JSON.stringify([course.semester, course.code, course.section, index])}>
                  <strong>{course.title}</strong>
                  <p className={styles.meta}>
                    {formatSemester(course.semester)} · 課號 {course.code || '未提供'}
                    {course.section ? ` · 班別 ${course.section}` : ''}
                  </p>
                  <dl>
                    <div><dt>授課老師</dt><dd>{course.teacher || '未提供'}</dd></div>
                    <div><dt>學分</dt><dd>{course.credits || '未提供'}</dd></div>
                    {read.filters?.weekday !== undefined && <div><dt>上課日</dt><dd>
                      {publicCourseWeekdays(course, read.schoolId)?.map((day) => `星期${'一二三四五六日'[day - 1]}`).join('、') || '未能確認'}
                    </dd></div>}
                  </dl>
                </li>
              ))}
            </ul>
          ) : <p>這次查詢沒有符合的開課資料，可調整關鍵字、星期或學分後再查詢。</p>}
          {!!read.unresolvedCount && <p className={styles.meta}>
            另有 {read.unresolvedCount} 筆資料無法確認是否符合上述篩選條件，未列入結果。
          </p>}
          {read.truncated && <p className={styles.meta}>符合條件的課程超過查詢上限，可用課號或老師姓名縮小範圍。</p>}
          {read.fetchedAt && (
            <p className={styles.meta}>
              校方資料擷取：{formatPublicCatalogFetchedAt(read.fetchedAt)}（台灣時間；非校方更新時間）
            </p>
          )}
        </>
      ) : <p>這次暫時無法取得可核對的課程資料，請至查課頁重試或查看校方來源。</p>}
      <div className={styles.links}>
        <Link href={read.href}>查看課程與課表核對</Link>
        <a href={read.sourceUrl} target="_blank" rel="noopener noreferrer">校方資料來源</a>
      </div>
      <p className={styles.meta}>到查課頁選擇課程，再按「帶入課表核對」確認學期、時段與教室。</p>
    </section>
  );
}
