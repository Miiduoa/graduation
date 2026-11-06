'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CommunityAccess } from '../../_components/CommunityAccess';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { useAuth } from '@/components/AuthGuard';
import { useBrowsingSchoolPageContext } from '@/lib/useBrowsingSchoolPageContext';
import { verifiedSocialPoisForSchool } from '@/lib/community/pois';
import { createStoryId, publishStory } from '@/lib/community/firestore';
import { storyImageError, uploadStoryImage } from '@/lib/community/media';
import styles from './composer.module.css';

const BACKGROUNDS = [
  ['深綠', '#243b35'],
  ['灰藍', '#3e5169'],
  ['琥珀棕', '#67513d'],
  ['暮紫', '#554661'],
  ['磚紅', '#6f4039'],
  ['石墨灰', '#303b42'],
] as const;
const MAX_TEXT = 220;
const TTL_24H = 24 * 3600 * 1000;

export default function StoryComposePage() {
  const { schoolId, schoolName, ready } = useBrowsingSchoolPageContext();
  return (
    <SiteShell
      title="發布限時動態"
      subtitle="與同校同學分享這一刻，動態會保留 24 小時。"
      schoolName={ready ? schoolName : undefined}
    >
      {ready ? (
        <CommunityAccess>
          <StoryComposeInner key={schoolId} schoolId={schoolId} />
        </CommunityAccess>
      ) : (
        <SchoolScopePlaceholder />
      )}
    </SiteShell>
  );
}

function StoryComposeInner({ schoolId }: { schoolId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const requestedPoi = useSearchParams()?.get('poiId');
  const returnHref = `/community?tab=realtime&schoolId=${encodeURIComponent(schoolId)}`;
  const [poi, setPoi] = useState(() =>
    verifiedSocialPoisForSchool(schoolId).find((item) => item.id === requestedPoi),
  );
  const [body, setBody] = useState('');
  const [bgColor, setBgColor] = useState<string>(BACKGROUNDS[0][1]);
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [checkingPhoto, setCheckingPhoto] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'publishing' | 'published'>('idle');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const selection = useRef(0);
  const publishing = useRef(false);
  const storyId = useRef('');
  const uploadedUrl = useRef('');
  const busy = status !== 'idle';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.preview);
    },
    [photo],
  );

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || publishing.current) return;
    const request = ++selection.current;
    const invalid = storyImageError(file);
    setError(invalid ?? '');
    setCheckingPhoto(!invalid);
    if (invalid) return;

    const preview = URL.createObjectURL(file);
    try {
      const image = new window.Image();
      image.src = preview;
      await image.decode();
      if (!mounted.current || selection.current !== request) {
        URL.revokeObjectURL(preview);
        return;
      }
      storyId.current = '';
      uploadedUrl.current = '';
      setPhoto({ file, preview });
    } catch {
      URL.revokeObjectURL(preview);
      if (mounted.current && selection.current === request)
        setError('無法開啟這張照片，請改選其他圖片。');
    } finally {
      if (mounted.current && selection.current === request) setCheckingPhoto(false);
    }
  }

  function removePhoto() {
    selection.current++;
    storyId.current = '';
    uploadedUrl.current = '';
    setCheckingPhoto(false);
    setPhoto(null);
    setError('');
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (publishing.current || checkingPhoto || !user?.uid || (!body.trim() && !photo)) return;
    publishing.current = true;
    setError('');
    try {
      storyId.current ||= createStoryId();
      if (photo && !uploadedUrl.current) {
        setStatus('uploading');
        const uploaded = await uploadStoryImage({
          schoolId,
          storyId: storyId.current,
          uid: user.uid,
          file: photo.file,
        });
        if (!mounted.current) return;
        uploadedUrl.current = uploaded.url;
      }
      setStatus('publishing');
      await publishStory({
        storyId: storyId.current,
        schoolId,
        authorUid: user.uid,
        kind: photo ? 'image' : 'text',
        text: body.trim(),
        mediaUrl: photo ? uploadedUrl.current : null,
        bgColor,
        poiId: poi?.id ?? null,
        poiName: poi?.name ?? null,
        expiresAtMs: Date.now() + TTL_24H,
      });
    } catch {
      if (mounted.current) {
        publishing.current = false;
        setStatus('idle');
        setError('發布失敗，你的內容還在。請確認連線與校園帳號後再試一次。');
      }
      return;
    }
    if (mounted.current) {
      setStatus('published');
      router.replace(returnHref);
    }
  }

  return (
    <form className={styles.composer} onSubmit={publish} aria-label="編輯限時動態">
      <div className={styles.layout}>
        <fieldset className={styles.editor} disabled={busy}>
          <div className={styles.labelRow}>
            <label htmlFor="story-text">{photo ? '照片說明（選填）' : '文字內容'}</label>
            <small id="story-count">
              {body.length} / {MAX_TEXT}
            </small>
          </div>
          <textarea
            id="story-text"
            className="input"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            aria-describedby="story-count"
            maxLength={MAX_TEXT}
            rows={3}
            placeholder={photo ? '這一刻有什麼故事？' : '校園裡有什麼新鮮事？'}
          />
          <div className={styles.photoRow}>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              aria-label="限動照片"
              hidden
              onChange={selectPhoto}
            />
            <button className="btn" type="button" onClick={() => fileInput.current?.click()}>
              {photo ? '更換照片' : '加入照片'}
            </button>
            {photo && (
              <button className="btn" type="button" onClick={removePhoto}>
                移除照片
              </button>
            )}
          </div>
          {!photo && (
            <fieldset className={styles.palette}>
              <legend>背景顏色</legend>
              {BACKGROUNDS.map(([name, color]) => (
                <button
                  key={color}
                  type="button"
                  aria-label={name}
                  aria-pressed={bgColor === color}
                  title={name}
                  onClick={() => setBgColor(color)}
                >
                  <span style={{ backgroundColor: color }}>{bgColor === color ? '✓' : ''}</span>
                </button>
              ))}
            </fieldset>
          )}
          {poi && (
            <button
              className={styles.location}
              type="button"
              onClick={() => setPoi(undefined)}
              aria-label={`移除地點：${poi.name}`}
            >
              {poi.name} <span aria-hidden="true">×</span>
            </button>
          )}
        </fieldset>

        <figure className={styles.previewPanel}>
          <figcaption>限時動態預覽</figcaption>
          <div className={styles.preview} style={{ background: photo ? '#101315' : bgColor }}>
            {photo && (
              <Image src={photo.preview} alt="已選取的照片" unoptimized fill sizes="220px" />
            )}
            {body.trim() ? (
              <span className={photo ? styles.caption : styles.storyText}>{body.trim()}</span>
            ) : (
              !photo && <span className={styles.hint}>你的文字會顯示在這裡</span>
            )}
            {poi && <span className={styles.place}>{poi.name}</span>}
          </div>
        </figure>
      </div>
      <div className={styles.actions}>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <span role="status" className={styles.status}>
          {checkingPhoto
            ? '正在讀取照片…'
            : status === 'uploading'
              ? '正在上傳照片…'
              : status === 'publishing'
                ? '正在發布限時動態…'
                : status === 'published'
                  ? '限時動態已發布'
                  : ''}
        </span>
        <div className={styles.actionRow}>
          <Link
            href={returnHref}
            className="btn"
            aria-disabled={busy}
            onClick={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            取消
          </Link>
          <button
            className="btn primary"
            type="submit"
            disabled={busy || checkingPhoto || (!body.trim() && !photo)}
          >
            {busy ? (status === 'published' ? '已發布' : '發布中…') : '發布限時動態'}
          </button>
        </div>
      </div>
    </form>
  );
}
