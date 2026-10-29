'use client';

import { useEffect, useState } from 'react';
import {
  checkTronClassHomework,
  submitTronClassHomework,
  type TronClassSubmissionReceipt,
} from '@/lib/tronClassLms';
import styles from '@/app/school-lms/schoolLms.module.css';

type Props = {
  uid: string;
  courseId: number;
  homeworkId: number;
  href: string;
  submissionType?: string | null;
  writeEnabled?: boolean;
};

export function TronClassHomeworkComposer({
  uid, courseId, homeworkId, href, submissionType, writeEnabled = true,
}: Props) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState<TronClassSubmissionReceipt | null>(null);
  const [uncertain, setUncertain] = useState('');
  const [checking, setChecking] = useState(false);
  const [verificationNote, setVerificationNote] = useState('');
  const key = 'tronclass-draft:' + uid + ':' + courseId + ':' + homeworkId;
  const fileOnly = ['file', 'files', 'upload', 'attachment']
    .includes((submissionType || '').toLowerCase());

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try { setText(window.sessionStorage.getItem(key) || ''); }
      catch { setText(''); }
      setPreview(false);
      setReceipt(null);
      setUncertain('');
      setVerificationNote('');
    });
    return () => { active = false; };
  }, [key]);

  function edit(value: string) {
    setText(value);
    setPreview(false);
    try { window.sessionStorage.setItem(key, value); } catch { /* private browsing */ }
  }

  async function confirm() {
    if (!text.trim() || sending || uncertain || receipt || fileOnly) return;
    setSending(true);
    try {
      const result = await submitTronClassHomework(uid, courseId, homeworkId, text);
      setReceipt(result);
      if (result.status === 'verified') {
        try { window.sessionStorage.removeItem(key); } catch { /* private browsing */ }
      }
    } catch (error) {
      setUncertain(error instanceof Error ? error.message : '校方回應不明，請先核對作業。');
    } finally {
      setSending(false);
    }
  }

  async function verifyReceipt() {
    if (checking || sending) return;
    setChecking(true);
    setVerificationNote('');
    try {
      const result = await checkTronClassHomework(uid, courseId, homeworkId);
      if (result.status === 'verified') {
        setReceipt({ status: 'verified', receiptId: result.receiptId, submittedAt: result.submittedAt });
        setUncertain('');
        try { window.sessionStorage.removeItem(key); } catch { /* private browsing */ }
      } else if (result.status === 'pending') {
        setReceipt({ status: 'pending', receiptId: result.receiptId, submittedAt: result.submittedAt });
        setUncertain('');
      } else if (uncertain || receipt) {
        setReceipt(null);
        setUncertain('校方尚未回傳可確認的繳交紀錄。為避免重複提交，請先核對原站的完整繳交歷史。');
      } else {
        setVerificationNote('玩課雲目前沒有回傳這份作業的本人繳交紀錄。');
      }
    } catch (error) {
      setVerificationNote(error instanceof Error
        ? error.message : '暫時無法查核校方繳交紀錄。');
    } finally {
      setChecking(false);
    }
  }

  if (fileOnly) {
    return (
      <section className={styles.composer} aria-label="繳交作業">
        <h3>這份作業需要上傳檔案</h3>
        <p className={styles.meta}>目前尚未支援玩課雲附件直接繳交，請使用原站完成上傳。</p>
        <a className="btn primary" href={href} target="_blank" rel="noopener noreferrer">開啟玩課雲繳交</a>
      </section>
    );
  }

  if (!writeEnabled) {
    return (
      <section className={styles.composer} aria-label="玩課雲作業繳交">
        <h3>校方直接繳交尚未開通</h3>
        <p className={styles.meta}>作業、公告及教材可在 Campus One 閱讀。為避免未驗證的作業送出流程影響正式繳交，請先至玩課雲原站完成這份作業。</p>
        <a className="btn primary" href={href} target="_blank" rel="noopener noreferrer">前往玩課雲繳交</a>
      </section>
    );
  }

  return (
    <section className={styles.composer} aria-labelledby="tronclass-submit-heading">
      <div className={styles.composerHeading}>
        <div>
          <p className={styles.eyebrow}>作業工作台</p>
          <h3 id="tronclass-submit-heading">在這裡完成文字作業</h3>
        </div>
        <span className={styles.composerHint}>僅限純文字 · 需校方回執</span>
      </div>
      {verificationNote ? <p className={styles.verificationNote} role="status">{verificationNote}</p> : null}
      {receipt ? (
        <div className={styles.receipt} role="status">
          <h4>{receipt.status === 'verified' ? '已確認繳交' : '已送出，等待校方確認'}</h4>
          <p>{receipt.status === 'verified'
            ? '已從玩課雲讀到你的繳交紀錄。'
            : '校方已接收寫入請求，但尚未取得可核對的提交紀錄。請在原站確認，勿重複繳交。'}</p>
          {receipt.receiptId ? <p>收件編號：{receipt.receiptId}</p> : null}
          {receipt.status === 'pending' ? (
            <button type="button" className="btn primary" onClick={() => void verifyReceipt()} disabled={checking}>
              {checking ? '查核中…' : '重新查核校方回執'}
            </button>
          ) : null}
          <a href={href} target="_blank" rel="noopener noreferrer">查看玩課雲繳交紀錄</a>
        </div>
      ) : uncertain ? (
        <div className={styles.submitAlert} role="alert">
          <h4>暫停再次送出，避免重複繳交</h4>
          <p>{uncertain}</p>
          <p>已保留此分頁的文字草稿。可以先在這裡查核校方回執，不會再次送出作業。</p>
          <div className={styles.actions}>
            <button type="button" className="btn primary" disabled={checking}
              onClick={() => void verifyReceipt()}>{checking ? '查核中…' : '查核校方繳交結果'}</button>
            <a className="btn" href={href} target="_blank" rel="noopener noreferrer">開啟玩課雲核對</a>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.verifyStrip}>
            <span>已在其他裝置交過作業？</span>
            <button type="button" className="btn" disabled={checking}
              onClick={() => void verifyReceipt()}>{checking ? '查核中…' : '查核校方繳交紀錄'}</button>
          </div>
          <label className={styles.editorLabel} htmlFor="tronclass-homework-content">繳交內容</label>
          <textarea
            id="tronclass-homework-content"
            className={styles.editor}
            rows={8}
            maxLength={12000}
            value={text}
            disabled={sending}
            placeholder="在這裡撰寫或貼上文字作業。草稿只暫存於目前瀏覽器分頁。"
            onChange={(event) => edit(event.target.value)}
          />
          <div className={styles.editorFoot}>
            <span>不支援檔案附件與複雜格式；此處不會代替檔案上傳。</span>
            <span>{text.length.toLocaleString('zh-TW')} / 12,000</span>
          </div>
          {preview ? (
            <div className={styles.preview} role="region" aria-label="繳交內容預覽">
              <h4>確認繳交內容</h4>
              <p>{text}</p>
              <p className={styles.meta}>按下「確認繳交」後，文字會直接送至玩課雲，請先檢查課程與內容。</p>
              <div className={styles.actions}>
                <button type="button" className="btn primary" disabled={sending}
                  onClick={() => void confirm()}>{sending ? '正在送出…' : '確認繳交至玩課雲'}</button>
                <button type="button" className="btn" disabled={sending}
                  onClick={() => setPreview(false)}>返回修改</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn primary"
              disabled={!text.trim() || sending}
              onClick={() => setPreview(true)}>預覽並確認繳交</button>
          )}
        </>
      )}
    </section>
  );
}
