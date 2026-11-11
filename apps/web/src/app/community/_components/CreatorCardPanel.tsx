'use client';

import { useEffect, useId, useState } from 'react';
import { CREATOR_CARD_LIMITS, EMPTY_CREATOR_CARD, type CreatorCard } from '@campus/shared/src/creatorCard';
import { readCreatorCard, saveCreatorCard } from '@/lib/community/creatorCard';
import styles from './CreatorProfile.module.css';

type CardState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: CreatorCard | null };

export function CreatorCardPanel({
  schoolId, ownerUid, own,
}: { schoolId: string; ownerUid: string; own: boolean }) {
  const id = useId();
  const [state, setState] = useState<CardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CreatorCard>(EMPTY_CREATOR_CARD);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    void readCreatorCard(schoolId, ownerUid).then((value) => {
      if (live) setState({ status: 'ready', value });
    }).catch(() => {
      if (live) setState({ status: 'error' });
    });
    return () => { live = false; };
  }, [schoolId, ownerUid, attempt]);

  const openEditor = () => {
    if (!own || state.status !== 'ready') return;
    setDraft(state.value ?? EMPTY_CREATOR_CARD);
    setEditing(true);
    setFeedback('');
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!own || saving || state.status !== 'ready') return;
    setSaving(true);
    setFeedback('');
    try {
      const confirmed = await saveCreatorCard(schoolId, ownerUid, draft);
      setState({ status: 'ready', value: confirmed });
      setEditing(false);
      setFeedback('社群簡介已儲存，所屬校園成員可以看到。');
    } catch (error) {
      setFeedback(error instanceof Error && error.message.startsWith('Creator card update was not confirmed')
        ? '尚未確認儲存結果，請保持目前內容並重新儲存。'
        : error instanceof Error && /最多|HTTPS|有效/.test(error.message)
          ? error.message
          : '暫時無法儲存，已保留你輸入的內容，請確認連線及校籍後重試。');
    } finally {
      setSaving(false);
    }
  };

  if (state.status === 'loading') return <div role="status" className={styles.cardStatus}>正在讀取社群簡介…</div>;
  if (state.status === 'error') return (
    <div role="alert" className={styles.cardStatus}>
      社群簡介暫時無法讀取。
      <button type="button" className={styles.cardRetry} onClick={() => setAttempt((n) => n + 1)}>重新讀取</button>
    </div>
  );

  return (
    <section className={styles.creatorCard} aria-label="社群簡介">
      {editing ? (
        <form className={styles.cardForm} aria-label="編輯社群簡介" onSubmit={(e) => void save(e)}>
          <div className={styles.cardField}>
            <label htmlFor={`${id}-headline`}>一句話介紹</label>
            <input
              id={`${id}-headline`}
              value={draft.headline}
              onChange={(e) => setDraft((value) => ({ ...value, headline: e.target.value }))}
              maxLength={CREATOR_CARD_LIMITS.headline}
              placeholder="例如：用照片和文字記錄大學生活"
              disabled={saving}
            />
            <small>{draft.headline.length}/{CREATOR_CARD_LIMITS.headline}</small>
          </div>
          <div className={styles.cardField}>
            <label htmlFor={`${id}-bio`}>個人簡介</label>
            <textarea
              id={`${id}-bio`}
              value={draft.bio}
              onChange={(e) => setDraft((value) => ({ ...value, bio: e.target.value }))}
              maxLength={CREATOR_CARD_LIMITS.bio}
              rows={4}
              placeholder="分享你在校園裡關心的事、正在做的作品或興趣。"
              disabled={saving}
            />
            <small>{draft.bio.length}/{CREATOR_CARD_LIMITS.bio}</small>
          </div>
          <div className={styles.cardField}>
            <label htmlFor={`${id}-link`}>作品連結（選填）</label>
            <input
              id={`${id}-link`}
              value={draft.linkUrl}
              onChange={(e) => setDraft((value) => ({ ...value, linkUrl: e.target.value }))}
              maxLength={CREATOR_CARD_LIMITS.linkUrl}
              inputMode="url"
              placeholder="https://"
              disabled={saving}
            />
          </div>
          <p className={styles.cardPrivacy}>你填寫的內容會顯示在同校成員可閱讀的個人頁；不會帶入學號、電話或其他校務資料。</p>
          {feedback && <p role="alert" className={styles.cardError}>{feedback}</p>}
          <div className={styles.cardActions}>
            <button type="submit" className={styles.primaryAction} disabled={saving}>{saving ? '正在確認儲存…' : '儲存簡介'}</button>
            <button
              type="button" className={styles.secondaryAction} disabled={saving}
              onClick={() => { setEditing(false); setFeedback(''); }}
            >取消</button>
          </div>
        </form>
      ) : (
        <>
          {state.value?.headline && <p className={styles.creatorHeadline}>{state.value.headline}</p>}
          {state.value?.bio && <p className={styles.creatorBio}>{state.value.bio}</p>}
          {state.value?.linkUrl && (
            <a className={styles.creatorLink} href={state.value.linkUrl}
              target="_blank" rel="noopener noreferrer nofollow ugc">查看作品連結</a>
          )}
          {own && (
            <div className={styles.cardActions}>
              {(!state.value?.headline && !state.value?.bio && !state.value?.linkUrl) &&
                <p className={styles.cardHint}>加上一段簡介，讓同學認識你的興趣與作品。</p>}
              <button type="button" className={styles.secondaryAction} onClick={openEditor}>
                {state.value ? '編輯社群簡介' : '建立社群簡介'}
              </button>
            </div>
          )}
          {feedback && <p role="status" className={styles.cardSuccess}>{feedback}</p>}
        </>
      )}
    </section>
  );
}
