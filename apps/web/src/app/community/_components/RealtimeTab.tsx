'use client';

/**
 * 校園社群 — 即時（Web）
 *
 * 對應 mobile/RealtimeSocialScreen.tsx：
 *  - POI chip 列：來自 lib/community/pois.ts（與 mobile 同步）
 *  - 同點位 peer 卡：頭像、姓名、系所
 *  - Story grid 可點開全螢幕 viewer，含進度條與左右切換
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CommunityLoadError, useCommunityLoad } from './useCommunityLoad';
import { useAuth } from '@/components/AuthGuard';
import {
  SOCIAL_POIS,
  defaultSocialPoiId,
  findSocialPoi,
  SOCIAL_POI_CATEGORY_LABEL,
  type SocialPoiCategory,
} from '@/lib/community/pois';
import {
  heartbeatCheckIn,
  clearPresence,
  peersAtPoi,
  fetchSchoolDirectoryProfiles,
  listActiveStoriesForSchool,
  groupStoriesByAuthor,
  markStoryViewed,
  type StoryAuthorGroup,
} from '@/lib/community/firestore';

type Peer = { uid: string; name?: string; avatarUrl?: string | null; department?: string | null };

const POI_ICON: Record<SocialPoiCategory, string> = {
  library: '📚',
  cafeteria: '🍱',
  sports: '🏋',
  academic: '🏛',
  social: '👥',
  transit: '🚌',
};

export function RealtimeTab(props: { schoolId: string }) {
  const { schoolId } = props;
  const { user } = useAuth();
  const [selectedPoi, setSelectedPoi] = useState<string>(defaultSocialPoiId());
  const [storyGroups, setStoryGroups] = useState<StoryAuthorGroup[]>([]);
  const [peerResult, setPeerResult] = useState<{ poiId: string; items: Peer[] } | null>(null);
  const peers = peerResult?.poiId === selectedPoi ? peerResult.items : [];
  const peersGeneration = useRef(0);
  const [heartbeatSession, setHeartbeatSession] = useState<{ id: string; poiId: string } | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const checkInFlight = useRef(false);
  const checkedInHere = heartbeatSession?.poiId === selectedPoi;
  const [viewerState, setViewerState] = useState<{ group: StoryAuthorGroup; index: number } | null>(
    null,
  );
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({});
  const [avatarByUid, setAvatarByUid] = useState<Record<string, string>>({});

  const refreshStories = useCallback(async () => {
    if (!schoolId) {
      setStoryGroups([]);
      return;
    }
    const rows = await listActiveStoriesForSchool(schoolId, 80);
    setStoryGroups(groupStoriesByAuthor(rows, user?.uid));
  }, [schoolId, user]);

  const refreshPeers = useCallback(async () => {
    const request = ++peersGeneration.current;
    if (!schoolId) return;
    const raw = await peersAtPoi(schoolId, selectedPoi);
    const unique = [...new Set(raw.map((row) => row.uid).filter(Boolean))].filter((uid) => uid !== user?.uid);
    const profiles = unique.length ? await fetchSchoolDirectoryProfiles(schoolId, unique) : [];
    if (request !== peersGeneration.current) return;
    setPeerResult({ poiId: selectedPoi, items: unique.map((uid) => {
      const profile = profiles.find((row) => row.uid === uid);
      return { uid, name: profile?.displayName ?? '同學', avatarUrl: profile?.avatarUrl ?? null, department: profile?.department ?? null };
    }) });
  }, [schoolId, selectedPoi, user]);

  const load = useCallback(async () => {
    await Promise.all([refreshStories(), refreshPeers()]);
  }, [refreshStories, refreshPeers]);
  const {
    loading: storiesLoading,
    error,
    refresh,
  } = useCommunityLoad(load, '暫時無法讀取校園動態，請確認連線後重試。');

  useEffect(() => {
    (async () => {
      if (!schoolId) return;
      const uids = [...new Set(storyGroups.map((g) => g.authorUid))];
      if (uids.length === 0) {
        setNameByUid({});
        setAvatarByUid({});
        return;
      }
      const profiles = await fetchSchoolDirectoryProfiles(schoolId, uids);
      const n: Record<string, string> = {};
      const a: Record<string, string> = {};
      profiles.forEach((p) => {
        n[p.uid] = (p.displayName ?? p.uid.slice(0, 6)).trim();
        if (p.avatarUrl) a[p.uid] = p.avatarUrl;
      });
      setNameByUid(n);
      setAvatarByUid(a);
    })().catch(() => {});
  }, [storyGroups, schoolId]);

  const tapHeart = async () => {
    if (!user?.uid || !schoolId || checkInFlight.current) return;
    checkInFlight.current = true;
    setCheckingIn(true);
    try {
      if (heartbeatSession) {
        await clearPresence(schoolId, heartbeatSession.id);
        setHeartbeatSession(null);
      }
      if (!checkedInHere) {
        const id = await heartbeatCheckIn(user.uid, schoolId, selectedPoi);
        setHeartbeatSession({ id, poiId: selectedPoi });
      }
      await refresh();
    } catch {
      alert('這次未能更新打卡，請稍後再試。');
    } finally {
      checkInFlight.current = false;
      setCheckingIn(false);
    }
  };

  const openStoryGroup = (g: StoryAuthorGroup) => {
    setViewerState({ group: g, index: 0 });
    const story = g.stories[0];
    if (story && user?.uid) void markStoryViewed(story.id, user.uid).catch(() => {});
  };

  const advance = (delta: number) => {
    setViewerState((prev) => {
      if (!prev) return prev;
      const next = prev.index + delta;
      if (next < 0 || next >= prev.group.stories.length) return null;
      const s = prev.group.stories[next];
      if (s && user?.uid) void markStoryViewed(s.id, user.uid).catch(() => {});
      return { group: prev.group, index: next };
    });
  };

  if (error) return <CommunityLoadError message={error} retry={refresh} />;

  return (
    <div>
      <h3 style={{ margin: '4px 0 8px', fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>
        我在哪
      </h3>
      <div
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          paddingBottom: 8,
        }}
      >
        {SOCIAL_POIS.map((poi) => {
          const active = poi.id === selectedPoi;
          const checked = heartbeatSession?.poiId === poi.id;
          return (
            <button
              key={poi.id}
              type="button"
              disabled={checkingIn}
              onClick={() => setSelectedPoi(poi.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 12px',
                borderRadius: 999,
                border: active ? '1px solid var(--brand)' : '1px solid var(--border)',
                background: active ? 'var(--brand)' : 'var(--surface)',
                color: active ? 'var(--on-brand)' : 'var(--text)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              <span>{POI_ICON[poi.category]}</span>
              {poi.name}
              {checked && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--success)',
                    marginLeft: 4,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        className="card"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: 14,
          marginTop: 8,
          marginBottom: 18,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            {findSocialPoi(selectedPoi)?.name ?? selectedPoi}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {SOCIAL_POI_CATEGORY_LABEL[findSocialPoi(selectedPoi)?.category ?? 'social']}
            {findSocialPoi(selectedPoi)?.hint ? ` · ${findSocialPoi(selectedPoi)?.hint}` : ''}
          </div>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={tapHeart}
          disabled={checkingIn}
          style={{
            background: checkedInHere ? 'var(--success)' : 'var(--brand)',
            fontSize: 13,
          }}
        >
          {checkingIn ? '更新中…' : checkedInHere ? '取消打卡' : '我在這裡'}
        </button>
      </div>

      {checkedInHere && <p role="status" style={{ color: 'var(--success)' }}>已在這個地點打卡。你可以隨時取消。</p>}
      <h3 style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>
        附近同學{!storiesLoading && peerResult?.poiId === selectedPoi ? ` · ${peers.length}` : ''}
      </h3>
      {storiesLoading || peerResult?.poiId !== selectedPoi ? <p role="status">正在讀取附近同學…</p> : peers.length === 0 ? (
        <div
          className="card"
          style={{ padding: 18, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}
        >
          這個地點目前沒有其他同學打卡。
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {peers.slice(0, 16).map((p) => (
            <div
              key={p.uid}
              className="card"
              style={{
                width: 110,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: p.avatarUrl ? '#fff' : 'var(--brand)',
                  color: 'var(--on-brand)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  overflow: 'hidden',
                }}
              >
                {p.avatarUrl ? (
                  <img
                    src={p.avatarUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  (p.name ?? '?').slice(0, 1)
                )}
              </div>
              <div
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', textAlign: 'center' }}
              >
                {p.name}
              </div>
              {p.department && (
                <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>
                  {p.department}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
        <h3 style={{ margin: 0, fontSize: 13, color: 'var(--muted)', fontWeight: 700, flex: 1 }}>
          限時動態
        </h3>
        <Link
          href={`/community/story/new?poiId=${encodeURIComponent(selectedPoi)}`}
          className="btn primary"
          style={{ fontSize: 12, padding: '6px 12px' }}
        >
          ＋ 發布限時動態
        </Link>
      </div>

      {storiesLoading ? (
        <div className="card" style={{ padding: 18, textAlign: 'center', color: 'var(--muted)' }}>
          載入中…
        </div>
      ) : storyGroups.length === 0 ? (
        <div
          className="card"
          style={{ padding: 18, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}
        >
          目前還沒有限時動態。分享一張照片或寫下此刻的心情。
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))',
            gap: 10,
            marginTop: 10,
          }}
        >
          {storyGroups.map((g) => {
            const latest = g.stories[g.stories.length - 1] ?? g.stories[0];
            const isImage = latest?.kind === 'image' && latest.mediaUrl;
            return (
              <button
                key={g.authorUid}
                type="button"
                onClick={() => openStoryGroup(g)}
                style={{
                  position: 'relative',
                  aspectRatio: '9/14',
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                  background: isImage ? '#000' : latest?.bgColor || '#0f172a',
                  cursor: 'pointer',
                  padding: 0,
                }}
                aria-label={`查看 ${g.isMine ? '我的' : (nameByUid[g.authorUid] ?? '同學')} 的限時動態`}
              >
                {isImage ? (
                  <img
                    src={latest!.mediaUrl as string}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 14,
                      boxSizing: 'border-box',
                    }}
                  >
                    <span
                      style={{
                        color: '#fff',
                        fontSize: 14,
                        fontWeight: 600,
                        textAlign: 'center',
                        lineHeight: 1.5,
                      }}
                    >
                      {latest?.text || '（媒體）'}
                    </span>
                  </div>
                )}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent)',
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: avatarByUid[g.authorUid] ? '#fff' : 'var(--brand)',
                      color: 'var(--on-brand)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      overflow: 'hidden',
                      fontSize: 11,
                    }}
                  >
                    {avatarByUid[g.authorUid] ? (
                      <img
                        src={avatarByUid[g.authorUid]}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      (nameByUid[g.authorUid] ?? '?').slice(0, 1)
                    )}
                  </div>
                  <span
                    style={{
                      flex: 1,
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {g.isMine ? '我的動態' : (nameByUid[g.authorUid] ?? g.authorUid.slice(0, 6))}
                  </span>
                  {g.stories.length > 1 && (
                    <span style={{ color: '#fff', fontSize: 11, opacity: 0.85 }}>
                      · {g.stories.length}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {viewerState && (
        <StoryViewer state={viewerState} onClose={() => setViewerState(null)} onAdvance={advance} />
      )}
    </div>
  );
}

function StoryViewer(props: {
  state: { group: StoryAuthorGroup; index: number };
  onClose: () => void;
  onAdvance: (delta: number) => void;
}) {
  const { state, onClose, onAdvance } = props;
  const story = state.group.stories[state.index];
  if (!story) return null;
  const total = state.group.stories.length;

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          aspectRatio: '9/16',
          position: 'relative',
          background: story.kind === 'image' ? '#000' : story.bgColor || '#0f172a',
          borderRadius: 16,
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* progress segments */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            display: 'flex',
            gap: 4,
            zIndex: 2,
          }}
        >
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background:
                  i < state.index
                    ? '#fff'
                    : i === state.index
                      ? 'rgba(255,255,255,0.7)'
                      : 'rgba(255,255,255,0.25)',
              }}
            />
          ))}
        </div>

        {/* content */}
        {story.kind === 'image' && story.mediaUrl ? (
          <img
            src={story.mediaUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 28,
              boxSizing: 'border-box',
            }}
          >
            <span
              style={{
                color: '#fff',
                fontSize: 22,
                lineHeight: 1.5,
                fontWeight: 700,
                textAlign: 'center',
              }}
            >
              {story.text || '（無內容）'}
            </span>
          </div>
        )}

        {/* left/right hit zones */}
        <button
          type="button"
          aria-label="上一則"
          onClick={() => onAdvance(-1)}
          style={{
            position: 'absolute',
            top: 60,
            bottom: 60,
            left: 0,
            width: '35%',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        />
        <button
          type="button"
          aria-label="下一則"
          onClick={() => onAdvance(+1)}
          style={{
            position: 'absolute',
            top: 60,
            bottom: 60,
            right: 0,
            width: '55%',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        />

        {/* close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          style={{
            position: 'absolute',
            top: 24,
            right: 16,
            zIndex: 3,
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.4)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontSize: 18,
          }}
        >
          ×
        </button>

        {story.poiName && (
          <div
            style={{
              position: 'absolute',
              bottom: 20,
              left: 16,
              padding: '6px 12px',
              background: 'rgba(0,0,0,0.4)',
              borderRadius: 999,
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            📍 {story.poiName}
          </div>
        )}
      </div>
    </div>
  );
}
