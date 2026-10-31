'use client';

import Link from 'next/link';
import type { PersonalImportKind } from '@campus/shared';
import { usePersonalImportScope, usePersonalImports } from '@/lib/usePersonalImports';
import styles from './PersonalImport.module.css';

export function PersonalImportSummary({ kind }: { kind: PersonalImportKind }) {
  const context = usePersonalImportScope();
  const { records, error } = usePersonalImports(context.scope, !context.loading);
  const rows = records.filter((row) => row.kind === kind);
  return (
    <section className={styles.panel} aria-label="自行匯入的資料">
      <div className={styles.heading}>
        <h2>自己的資料，也能先整理</h2>
        <Link className="btn primary" href={`/import?kind=${kind}`}>
          匯入截圖或檔案
        </Link>
      </div>
      <p className={styles.note}>
        不用連線學校帳號。自行匯入的內容是個人參考資料，存在這台裝置，與學校正式紀錄分開。
      </p>
      {error && <p role="alert">{error}</p>}
      {!context.loading && rows.length > 0 && (
        <>
          <p>
            已匯入 {rows.length} 筆
            {kind === 'grades'
              ? `，共 ${rows.reduce((sum, row) => sum + (row.credits || 0), 0)} 個修課學分（包含未通過與重修）`
              : ''}
            。
          </p>
          <ul className={styles.saved}>
            {rows
              .slice(-5)
              .reverse()
              .map((row) => (
                <li key={row.id}>
                  <strong><Link href={`/import?kind=${kind}#record-${encodeURIComponent(row.id)}`}>{row.title}</Link></strong>
                  <span>來源：個人匯入 · 匯入時間：{new Date(row.importedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</span>
                  <span>
                    {row.kind === 'grades'
                      ? `${row.academicYear}／${row.semester} · ${row.credits} 學分 · ${row.grade}`
                      : row.date}
                  </span>
                </li>
              ))}
          </ul>
          <Link href={`/import?kind=${kind}`}>查看與編輯全部個人紀錄 →</Link>
        </>
      )}
    </section>
  );
}
