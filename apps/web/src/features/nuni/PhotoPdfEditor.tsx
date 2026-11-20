'use client';

import { useEffect, useRef, useState } from 'react';
import { formatAssignmentFileSize, moveAssignmentFile } from '@campus/shared/src/assignmentFiles';
import { buildPhotoPdf, validatePhotoPages, type PhotoPage } from './photoPdf';
import styles from './PhotoPdfEditor.module.css';

export function PhotoPdfEditor({
  onConfirm,
  onCancel,
}: {
  onConfirm: (file: File) => void;
  onCancel: () => void;
}) {
  const conversion = useRef<AbortController | null>(null);
  const [pages, setPages] = useState<PhotoPage[]>([]);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const urls = useRef<Set<string>>(new Set());
  function release(url: string) {
    if (urls.current.delete(url)) URL.revokeObjectURL(url);
  }
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      conversion.current?.abort();
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current.clear();
    };
  }, []);
  function edit(next: PhotoPage[]) {
    if (preview) release(preview.url);
    setPreview(null);
    setPages(next);
    setError('');
  }
  return (
    <section className={styles.editor} aria-label="照片轉 PDF">
      <div className={styles.heading}>
        <strong>將照片合併成 PDF</strong>
        <button
          type="button"
          onClick={() => {
            conversion.current?.abort();
            active.current = false;
            onCancel();
          }}
        >
          取消製作
        </button>
      </div>
      <p>
        選 1–8 張 JPEG 或 PNG 照片。來源每張最多 1600 萬像素（較大照片會縮至 1200 萬像素），合計 3200 萬像素。由上往下就是 PDF
        頁序，先轉正、排好，再看一次。
      </p>
      <label className={styles.pick}>
        選照片
        <input
          aria-label="選擇 PDF 照片"
          type="file"
          accept="image/jpeg,image/png"
          multiple
          disabled={busy}
          onChange={async (event) => {
            const files = Array.from(event.target.files ?? []);
            if (!files.length) return;
            event.target.value = '';
            if (files.length + pages.length > 8) {
              setError('一本最多 8 頁，請減少照片後再選。');
              return;
            }
            setBusy(true);
            try {
              await validatePhotoPages([
                ...pages,
                ...files.map((file) => ({ key: '', file, url: '', rotation: 0 })),
              ]);
              if (!active.current) return;
            } catch (cause) {
              if (active.current)
                setError(cause instanceof Error ? cause.message : '無法讀取照片。');
              return;
            } finally {
              if (active.current) setBusy(false);
            }
            edit([
              ...pages,
              ...files.map((file) => {
                const url = URL.createObjectURL(file);
                urls.current.add(url);
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
                onClick={() => {
                  release(page.url);
                  edit(pages.filter((p) => p.key !== page.key));
                }}
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
          const controller = new AbortController();
          conversion.current = controller;
          try {
            const file = await buildPhotoPdf(pages, controller.signal);
            if (!active.current) return;
            if (preview) release(preview.url);
            const url = URL.createObjectURL(file);
            urls.current.add(url);
            setPreview({ file, url });
          } catch (cause) {
            if (active.current)
              setError(
                cause instanceof Error
                  ? `${cause.message}（成品上限 20 MiB）`
                  : '無法製作 PDF，可能照片無法讀取或成品超過 20 MiB。請刪減照片再試，不會自動降低畫質。',
              );
          } finally {
            if (active.current) setBusy(false);
          }
        }}
      >
        {busy ? '正在製作 PDF…' : '預覽 PDF'}
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
