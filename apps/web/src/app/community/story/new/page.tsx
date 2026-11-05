'use client';

import { STORY_VIDEO_CONTENT_TYPE, STORY_VIDEO_MAX_SECONDS } from '@campus/shared/src/storyVideo';
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
import { storyMediaError, uploadStoryMedia } from '@/lib/community/media';
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

function readVideoDuration(url: string): Promise<number> {
  const video = document.createElement('video');
  return new Promise((resolve, reject) => {
    const unreadable = '無法播放這段影片，請改選含影像的 MP4 檔案。';
    const timeout = window.setTimeout(() => finish(unreadable), 12_000);
    function finish(error?: string) {
      window.clearTimeout(timeout);
      const duration = video.duration;
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      if (error) reject(new Error(error));
      else resolve(duration);
    }
    video.onloadeddata = () => {
      if (
        !video.videoWidth ||
        !video.videoHeight ||
        !Number.isFinite(video.duration) ||
        video.duration <= 0
      )
        finish(unreadable);
      else if (video.duration > STORY_VIDEO_MAX_SECONDS) finish('影片最長 30 秒，請先剪短再加入。');
      else finish();
    };
    video.onerror = () => finish(unreadable);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
  });
}

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
  const [allowReplies, setAllowReplies] = useState(true);
  const [bgColor, setBgColor] = useState<string>(BACKGROUNDS[0][1]);
  const [media, setMedia] = useState<{ file: File; preview: string; duration?: number } | null>(
    null,
  );
  const mediaName = media?.duration ? '影片' : '照片';
  const [checkingMedia, setCheckingMedia] = useState(false);
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
      if (media) URL.revokeObjectURL(media.preview);
    },
    [media],
  );

  async function selectMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || publishing.current) return;
    const request = ++selection.current;
    const invalid = storyMediaError(file);
    setError(invalid ?? '');
    setCheckingMedia(!invalid);
    if (invalid) return;

    const preview = URL.createObjectURL(file);
    try {
      let duration: number | undefined;
      if (file.type === STORY_VIDEO_CONTENT_TYPE) {
        duration = await readVideoDuration(preview);
      } else {
        const image = new window.Image();
        image.src = preview;
        await image.decode();
      }
      if (!mounted.current || selection.current !== request) {
        URL.revokeObjectURL(preview);
        return;
      }
      storyId.current = '';
      uploadedUrl.current = '';
      setMedia({ file, preview, duration });
    } catch (cause) {
      URL.revokeObjectURL(preview);
      if (mounted.current && selection.current === request)
        setError(
          file.type === STORY_VIDEO_CONTENT_TYPE && cause instanceof Error
            ? cause.message
            : '無法開啟這張照片，請改選其他圖片。',
        );
    } finally {
      if (mounted.current && selection.current === request) setCheckingMedia(false);
    }
  }

  function removeMedia() {
    selection.current++;
    storyId.current = '';
    uploadedUrl.current = '';
    setCheckingMedia(false);
    setMedia(null);
    setError('');
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (publishing.current || checkingMedia || !user?.uid || (!body.trim() && !media)) return;
    publishing.current = true;
    setError('');
    try {
      storyId.current ||= createStoryId();
      if (media && !uploadedUrl.current) {
        setStatus('uploading');
        const uploaded = await uploadStoryMedia({
          schoolId,
          storyId: storyId.current,
          uid: user.uid,
          file: media.file,
        });
        if (!mounted.current) return;
        uploadedUrl.current = uploaded.url;
      }
      setStatus('publishing');
      await publishStory({
        storyId: storyId.current,
        schoolId,
        authorUid: user.uid,
        kind: media?.duration ? 'video' : media ? 'image' : 'text',
        text: body.trim(),
        allowReplies,
        mediaUrl: media ? uploadedUrl.current : null,
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
            <label htmlFor="story-text">{media ? `${mediaName}說明（選填）` : '文字內容'}</label>
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
            placeholder={media ? '這一刻有什麼故事？' : '校園裡有什麼新鮮事？'}
          />
          <div className={styles.photoRow}>
            <input
              ref={fileInput}
              type="file"
              accept={`image/*,${STORY_VIDEO_CONTENT_TYPE}`}
              aria-label="限動照片或影片"
              hidden
              onChange={selectMedia}
            />
            <button className="btn" type="button" onClick={() => fileInput.current?.click()}>
              {media ? '更換媒體' : '加入照片或影片'}
            </button>
            {media && (
              <button className="btn" type="button" onClick={removeMedia}>
                移除{mediaName}
              </button>
            )}
          </div>
          <small className={styles.mediaHint}>MP4 影片最長 30 秒，檔案須小於 100 MB。</small>
          {!media && (
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
          <label className={styles.replySetting}>
            <input
              type="checkbox"
              checked={allowReplies}
              onChange={(event) => setAllowReplies(event.target.checked)}
            />
            允許同校成員私訊回覆
          </label>
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
          <figcaption>
            限時動態預覽{media?.duration ? ` · ${Math.ceil(media.duration)} 秒` : ''}
          </figcaption>
          <div
            className={styles.preview}
            data-video={!!media?.duration}
            style={{ background: media ? '#101315' : bgColor }}
          >
            {media?.duration ? (
              <video
                key={media.preview}
                src={media.preview}
                aria-label="已選取的影片"
                controls
                playsInline
                muted
                preload="metadata"
              />
            ) : media ? (
              <Image src={media.preview} alt="已選取的照片" unoptimized fill sizes="220px" />
            ) : null}
            {body.trim() ? (
              <span className={media ? styles.caption : styles.storyText}>{body.trim()}</span>
            ) : (
              !media && <span className={styles.hint}>你的文字會顯示在這裡</span>
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
          {checkingMedia
            ? '正在讀取媒體…'
            : status === 'uploading'
              ? `正在上傳${mediaName}…`
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
            disabled={busy || checkingMedia || (!body.trim() && !media)}
          >
            {busy ? (status === 'published' ? '已發布' : '發布中…') : '發布限時動態'}
          </button>
        </div>
      </div>
    </form>
  );
}
