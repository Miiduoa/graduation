'use client';

import Link from 'next/link';
import { useOptionalSelectedSchool } from './SelectedSchoolProvider';
import styles from './SystemNotice.module.css';

export function SchoolDataScope({ schoolName }: { schoolName: string }) {
  const selection = useOptionalSelectedSchool();
  const school = selection?.selectedSchool;
  if (!school || school.name === schoolName) return null;
  return (
    <aside className={styles.notice} aria-label="目前校園資料範圍">
      <p>
        此頁目前提供{schoolName}的資料，尚未連結你選擇的{school.name}
        。切換瀏覽校園不會更換這裡的校務紀錄。
      </p>
      <Link href={`/social?campus=${encodeURIComponent(school.id)}`}>
        查看{school.name}的公開交流
      </Link>
    </aside>
  );
}
