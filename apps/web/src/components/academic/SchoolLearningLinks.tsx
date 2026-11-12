import Link from 'next/link';
import { resolveOfficialCourseQueryLink } from '@campus/shared/src/courseCatalogCapability';
import { campusServiceHref } from '@/lib/campusNavigation';
import { getSchoolLearningEntry } from '@campus/shared/src/schoolLearningPlatforms';
import styles from './academic.module.css';

export function SchoolLearningLinks({ schoolId, schoolName, courseSearch }: {
  schoolId: string;
  schoolName: string;
  courseSearch?: string;
}) {
  const entry = getSchoolLearningEntry(schoolId, schoolName);
  const catalog = entry && courseSearch !== undefined ? resolveOfficialCourseQueryLink(schoolId) : null;
  return (
    <section className={styles.status}>
      <h2>{schoolName}的學習平臺</h2>
      {entry?.kind === 'platform' ? (
        <p>{entry.links.length > 1 ? '請選擇授課老師使用的平臺，登入後查看作業、公告與教材。' : '前往校方平臺，登入後查看作業、公告與教材。'}</p>
      ) : entry?.kind === 'website' ? (
        <p>可從學校官網查找數位學習平臺或學生專區。</p>
      ) : (
        <p>目前尚無可核對的校方入口，請依授課老師提供的網址進入課堂。</p>
      )}
      {(entry || courseSearch !== undefined) && (
        <div className={styles.actions}>
          {entry?.links.map(({ label, url }) => (
            <a key={url} className="btn" href={url} target="_blank" rel="noopener noreferrer">{label} ↗</a>
          ))}
          {catalog && <a className="btn" href={catalog.url} target="_blank" rel="noopener noreferrer">{catalog.label} ↗</a>}
          {courseSearch !== undefined && (
            <Link className="btn" href={campusServiceHref('/import?kind=timetable', courseSearch)}>匯入我的課表</Link>
          )}
        </div>
      )}
    </section>
  );
}
