'use client';

import type { TeacherGradebook } from '@/lib/teacherCourse';
import {
  GRADEBOOK_SOURCE,
  gradebookUnknownFields,
  teacherGradebookCsv,
  teacherGradebookFilename,
} from '@/lib/teacherGradebookExport';

export function GradebookExport({ gradebook, className }: {
  gradebook: TeacherGradebook;
  className?: string;
}) {
  function download() {
    const blob = new Blob([teacherGradebookCsv(gradebook)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = teacherGradebookFilename(gradebook.course.id);
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      // Keep the object URL alive until the browser has started the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  return (
    <div>
      <p>
        CSV 匯出：{gradebook.rows.length} 列，未知欄位共 {gradebookUnknownFields(gradebook)} 個
        （姓名、總分、結果、發布狀態、發布時間）。來源：{GRADEBOOK_SOURCE}。
        未知值保留為未提供、未登錄或「—」；僅下載目前可見列。
      </p>
      <button type="button" className={className} onClick={download}>
        匯出可見列 CSV
      </button>
    </div>
  );
}
