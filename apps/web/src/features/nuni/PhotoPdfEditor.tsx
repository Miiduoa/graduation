'use client';

import { useEffect, useRef, useState } from 'react';
import { formatAssignmentFileSize, moveAssignmentFile } from '@campus/shared/src/assignmentFiles';
import { buildPhotoPdf, type PhotoPage } from './photoPdf';
import styles from './PhotoPdfEditor.module.css';

export function PhotoPdfEditor({
  onConfirm,
  onCancel,
}: {
  onConfirm: (file: File) => void;
  onCancel: () => void;
}) {
  const [pages, setPages] = useState<PhotoPage[]>([]);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const urls = useRef<string[]>([]);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      urls.current.forEach(URL.revokeObjectURL);
    };
  }, []);
  function edit(next: PhotoPage[]) {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPages(next);
    setError('');
  }
  return (
    <section className={styles.editor} aria-label="照片轉 PDF">
      <div className={styles.heading}>
        <strong>把這次作業裝成一本</strong>
        <button type="button" onClick={onCancel}>
          取消製作
        </button>
      </div>
      <p>選 1–8 張照片。由上往下就是 PDF 頁序，先轉正、排好，再看一次。</p>
      <label className={styles.pick}>
        選照片
        <input
          aria-label="選擇 PDF 照片"
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length + pages.length > 8) {
              setError('一本最多 8 頁，請減少照片後再選。');
              return;
            }
            edit([
              ...pages,
              ...files.map((file) => {
                const url = URL.createObjectURL(file);
                urls.current.push(url);
                return { key: url, file, url, rotation: 0 };
              }),
            ]);
          }}
        />
      </label>
      <ol className={styles.pages}>
        {pages.map((page, index) => (
          <li key={page.key}>
            <div className={styles.paper}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.url}
                alt={`第 ${index + 1} 頁：${page.file.name}`}
                style={{ transform: `rotate(${page.rotation}deg)` }}
              />
            </div>
            <span>第 {index + 1} 頁</span>
            <div className={styles.tools}>
              <button
                type="button"
                disabled={busy || index === 0}
                onClick={() => edit(moveAssignmentFile(pages, index, -1))}
              >
                上移
              </button>
              <button
                type="button"
                disabled={busy || index === pages.length - 1}
                onClick={() => edit(moveAssignmentFile(pages, index, 1))}
              >
                下移
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  edit(
                    pages.map((p) =>
                      p.key === page.key ? { ...p, rotation: (p.rotation + 90) % 360 } : p,
                    ),
                  )
                }
              >
                向右轉 90°
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => edit(pages.filter((p) => p.key !== page.key))}
              >
                刪頁
              </button>
            </div>
          </li>
        ))}
      </ol>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !pages.length}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const file = await buildPhotoPdf(pages);
            if (!active.current) return;
            if (preview) URL.revokeObjectURL(preview.url);
            const url = URL.createObjectURL(file);
            urls.current.push(url);
            setPreview({ file, url });
          } catch {
            if (active.current)
              setError(
                '無法製作 PDF，可能照片無法讀取或成品超過 20 MiB。請刪減照片再試，不會自動降低畫質。',
              );
          } finally {
            if (active.current) setBusy(false);
          }
        }}
      >
        {busy ? '正在裝訂…' : '預覽 PDF'}
      </button>
      {preview ? (
        <div className={styles.proof}>
          <p>
            {pages.length} 頁 · {formatAssignmentFileSize(preview.file.size)}
            。請逐頁確認文字與方向。
          </p>
          <iframe title="作業 PDF 預覽" src={preview.url} />
          <a href={preview.url} target="_blank" rel="noreferrer">
            另開 PDF 檢查
          </a>
          <button type="button" onClick={() => onConfirm(preview.file)}>
            確認，加入待繳附件
          </button>
          <p>加入後，還要按作業的送出按鈕才會繳交。</p>
        </div>
      ) : null}
    </section>
  );
}
