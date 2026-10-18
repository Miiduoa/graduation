'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { friendResendCopy, meetupLabel } from '@campus/shared';
import { SiteShell } from '@/components/SiteShell';
import { SchoolScopePlaceholder } from '@/components/SchoolScopePlaceholder';
import { SchoolAccountRequired } from '@/components/SchoolAccountRequired';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  findByHandle,
  isValidHandle,
  listAcceptedFriends,
  listPendingRequests,
  loadMyHandle,
  normalizeHandle,
  publishHandle,
  sendFriendRequest,
  sentRequestState,
  type SentState,
  unpublishHandle,
  type FriendRow,
} from '@/lib/timetable/friends';
import { listMyMeetups, respondMeetup } from '@/lib/timetable/store';
import styles from '@/components/academic/academic.module.css';

type Meetup = {
  id: string;
  creatorUid: string;
  inviteeUid: string;
  kind: 'meal' | 'study';
  day: number;
  startPeriod: number;
  endPeriod: number;
  startMinute?: number;
  durationMinutes?: number;
  status: 'pending' | 'accepted' | 'declined';
};

const MEETUP_STATUS: Record<Meetup['status'], string> = {
  pending: '等回覆',
  accepted: '已答應',
  declined: '已婉拒',
};

export default function FriendsPage() {
  const { selectedSchoolId, loading: schoolLoading } = useSelectedSchool();
  const { user, loading: authLoading } = useAuth();
  if (authLoading)
    return (
      <SiteShell title="找人">
        <p role="status">正在確認登入狀態…</p>
      </SiteShell>
    );
  if (schoolLoading || !selectedSchoolId) {
    return (
      <SiteShell title="找人">
        <SchoolScopePlaceholder />
      </SiteShell>
    );
  }
  if (!user) {
    return (
      <SiteShell title="找人" subtitle="用同學給你的找人代號加好友。">
        <SchoolAccountRequired
          returnUrl={`/friends?schoolId=${encodeURIComponent(selectedSchoolId)}`}
          alternative="找同學請先用課堂或通訊軟體聯絡。"
        />
      </SiteShell>
    );
  }
  return (
    <FriendsContent
      key={`${user.uid}:${selectedSchoolId}`}
      schoolId={selectedSchoolId}
      uid={user.uid}
    />
  );
}

function FriendsContent({ schoolId, uid }: { schoolId: string; uid: string }) {
  const [needle, setNeedle] = useState('');
  const [hit, setHit] = useState<{ uid: string; name: string; handle: string } | null>(null);
  const [searched, setSearched] = useState(false);
  const [hitState, setHitState] = useState<SentState>({ kind: 'none' });
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [pending, setPending] = useState<FriendRow[]>([]);
  const [meetups, setMeetups] = useState<Meetup[]>([]);
  const [myHandle, setMyHandle] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [myName, setMyName] = useState('');
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [searching, setSearching] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const searchGeneration = useRef(0);
  const actionLock = useRef(false);

  const reload = useCallback(() => {
    const run = ++generation.current;
    return Promise.all([
      listAcceptedFriends(schoolId, uid),
      listPendingRequests(schoolId, uid),
      loadMyHandle(schoolId, uid),
      listMyMeetups(schoolId, uid),
    ]).then(
      ([accepted, waiting, mine, invites]) => {
        if (!mounted.current || run !== generation.current) return;
        setFriends(accepted);
        setPending(waiting);
        setMyHandle(mine.handle);
        setHandleInput((current) => current || mine.handle);
        setMyName(mine.name);
        setMeetups(invites as unknown as Meetup[]);
        setLoading(false);
      },
      () => {
        if (mounted.current && run === generation.current) {
          setLoadError(true);
          setLoading(false);
        }
      },
    );
  }, [uid, schoolId]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  function refresh() {
    setLoading(true);
    setLoadError(false);
    void reload();
  }

  async function perform<T>(
    action: () => Promise<T>,
    onSuccess: (value: T) => void,
    errorText: string,
  ) {
    if (actionLock.current || loading || loadError || !mounted.current) return;
    actionLock.current = true;
    setPendingAction(true);
    setNotice('');
    setFailure(false);
    try {
      const value = await action();
      if (mounted.current) onSuccess(value);
    } catch (error) {
      if (mounted.current) {
        setFailure(true);
        setNotice(
          error instanceof Error && error.message === 'handle-taken'
            ? '這個代號已經有人用了，請換一個。'
            : error instanceof Error && error.message === 'invalid-handle'
              ? '代號請使用 3 到 32 個小寫英文字母、數字、底線、點或連字號。'
              : errorText,
        );
      }
    } finally {
      actionLock.current = false;
      if (mounted.current) setPendingAction(false);
    }
  }

  if (loading || loadError) {
    return (
      <SiteShell title="找人" subtitle="用同學給你的找人代號加好友。">
        {loading ? (
          <p role="status">正在讀取好友與找人代號…</p>
        ) : (
          <section role="alert">
            <p>現在讀不到好友資料，請確認連線與學校帳號後重試。</p>
            <button className="btn" type="button" onClick={refresh}>
              重新讀取
            </button>
          </section>
        )}
      </SiteShell>
    );
  }

  const nameOf = (uid: string) => friends.find((friend) => friend.uid === uid)?.name || '同學';
  const incoming = pending.filter((row) => row.incoming);
  const outgoing = pending.filter((row) => !row.incoming);
  const meetupText = (item: Meetup) => meetupLabel(item);

  const search = async () => {
    const run = ++searchGeneration.current;
    setSearched(false);
    setHit(null);
    const handle = normalizeHandle(needle);
    if (!isValidHandle(handle)) {
      setNotice('請輸入完整的找人代號，例如 @wei_0312。');
      setFailure(true);
      return;
    }
    setSearching(true);
    setFailure(false);
    setNotice('');
    try {
      const found = await findByHandle(schoolId, handle);
      const usable = found && found.uid !== uid ? found : null;
      const state = usable
        ? await sentRequestState(schoolId, uid, usable.uid)
        : ({ kind: 'none' } as const);
      if (!mounted.current || run !== searchGeneration.current) return;
      setHit(usable);
      setHitState(state);
      setSearched(true);
      setNotice('');
    } catch {
      if (mounted.current && run === searchGeneration.current) {
        setFailure(true);
        setNotice('這次沒有查成功，請確認連線後重新查詢。');
      }
    } finally {
      if (mounted.current && run === searchGeneration.current) setSearching(false);
    }
  };

  return (
    <SiteShell
      title="找人"
      subtitle="用同學給你的找人代號加好友。課表只有在對方開放分享時才能查看。"
    >
      <div className={styles.toolbar}>
        <button
          type="button"
          className="btn"
          disabled={pendingAction || searching}
          onClick={refresh}
        >
          更新好友資料
        </button>
      </div>
      {notice && (
        <p className={styles.note} role={failure ? 'alert' : 'status'}>
          {notice}
        </p>
      )}

      {pendingAction && <p role="status">正在確認操作結果…</p>}
      <section className={styles.panel} aria-label="我的找人代號" aria-busy={pendingAction}>
        <h2>我的找人代號</h2>
        <p className={styles.notice}>
          {myHandle
            ? `同學輸入 @${myHandle} 就能找到你。`
            : '還沒開放。設一個代號給同學，對方才找得到你；不會列出全校名單。'}
        </p>
        <label className={styles.field}>
          代號
          <input
            value={handleInput}
            disabled={pendingAction}
            onChange={(event) => setHandleInput(event.target.value)}
            placeholder="英文小寫、數字、底線、點或連字號，3 到 32 字"
          />
        </label>
        <div className={styles.toolbar}>
          <button
            type="button"
            className="btn"
            disabled={pendingAction || !handleInput.trim()}
            onClick={() =>
              void perform(
                () => publishHandle(schoolId, uid, handleInput),
                (handle) => {
                  setMyHandle(handle);
                  setHandleInput(handle);
                  setNotice(`已開放，同學輸入 @${handle} 就能找到你。`);
                },
                '未能確認代號更新結果，原本輸入已保留。請確認連線後重試。',
              )
            }
          >
            {myHandle ? '更新代號' : '開放代號'}
          </button>
          {myHandle && (
            <button
              type="button"
              className="btn"
              disabled={pendingAction}
              onClick={() =>
                void perform(
                  () => unpublishHandle(schoolId, uid),
                  () => {
                    setMyHandle('');
                    setNotice('已關掉，同學查不到你的代號了。');
                  },
                  '未能確認代號已關閉，同學可能仍找得到你。請確認連線後再試一次。',
                )
              }
            >
              關掉代號
            </button>
          )}
        </div>
      </section>

      <section className={styles.panel} aria-label="加好友">
        <h2>加好友</h2>
        <label className={styles.field}>
          同學的找人代號
          <input
            value={needle}
            disabled={pendingAction}
            onChange={(event) => {
              ++searchGeneration.current;
              setSearching(false);
              setNeedle(event.target.value);
              setHit(null);
              setSearched(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !searching && !pendingAction) {
                event.preventDefault();
                void search();
              }
            }}
            placeholder="@代號"
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={searching || pendingAction}
          onClick={() => void search()}
        >
          {searching ? '查詢中…' : '查詢'}
        </button>
        {searched && !hit && <p className={styles.notice}>找不到這個代號。請跟同學確認一下。</p>}
        {hit && (
          <ul className={styles.list}>
            <li>
              <div>
                <h3>{hit.name}</h3>
                <p>@{hit.handle}</p>
              </div>
              {hitState.kind === 'declined' ? (
                <div>
                  <button type="button" className="btn" disabled>
                    加好友
                  </button>
                  <p className={styles.notice}>{friendResendCopy(hitState.declinedAtMs)}</p>
                </div>
              ) : hitState.kind === 'accepted' ? (
                <span>已是好友</span>
              ) : hitState.kind === 'pending' ? (
                <span>邀請已送出</span>
              ) : hitState.kind === 'blocked' ? (
                <span>目前無法傳送邀請</span>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={pendingAction}
                  onClick={() =>
                    void perform(
                      () => sendFriendRequest(schoolId, uid, hit.uid, myName, hit.name),
                      (result) => {
                        setHitState({ kind: result === 'accepted' ? 'accepted' : 'pending' });
                        setNotice(
                          result === 'accepted'
                            ? '你們已經是好友了。'
                            : result === 'pending'
                              ? '邀請已經送過了，等對方回覆。'
                              : '已送出好友邀請，等對方接受。',
                        );
                        refresh();
                      },
                      '未能確認好友邀請結果。請重新查詢對方代號，確認狀態後再試。',
                    )
                  }
                >
                  加好友
                </button>
              )}
            </li>
          </ul>
        )}
      </section>

      {incoming.length > 0 && (
        <section className={styles.panel} aria-label="好友邀請">
          <h2>好友邀請</h2>
          <ul className={styles.list}>
            {incoming.map((row) => (
              <li key={row.id}>
                <div>
                  <h3>{row.name}</h3>
                  <p>想加你好友</p>
                </div>
                <div className={styles.toolbar}>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={pendingAction}
                    onClick={() =>
                      void perform(
                        () => acceptFriendRequest(row.id, myName),
                        () => {
                          setNotice(`已和 ${row.name} 成為好友。`);
                          refresh();
                        },
                        '未能確認接受邀請的結果，請重新讀取後再試。',
                      )
                    }
                  >
                    接受
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={pendingAction}
                    onClick={() =>
                      void perform(
                        () => declineFriendRequest(row.id),
                        () => {
                          setNotice('已婉拒。');
                          refresh();
                        },
                        '未能確認婉拒結果，請重新讀取後再試。',
                      )
                    }
                  >
                    婉拒
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className={styles.panel} aria-label="等對方回覆">
          <h2>等對方回覆</h2>
          <ul className={styles.list}>
            {outgoing.map((row) => (
              <li key={row.id}>
                <div>
                  <h3>{row.name}</h3>
                  <p>邀請已送出</p>
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={pendingAction}
                  onClick={() =>
                    void perform(
                      () => cancelFriendRequest(row.id),
                      () => {
                        setNotice('已收回邀請。');
                        refresh();
                      },
                      '未能確認收回結果，請重新讀取後再試。',
                    )
                  }
                >
                  收回
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.panel} aria-label="邀約">
        <h2>邀約</h2>
        {meetups.length === 0 ? (
          <p className={styles.notice}>還沒有邀約。到課表選一位好友，從共同空堂約吃飯或讀書。</p>
        ) : (
          <ul className={styles.list}>
            {meetups.map((item) => {
              const mine = item.creatorUid === uid;
              const other = nameOf(mine ? item.inviteeUid : item.creatorUid);
              return (
                <li key={item.id}>
                  <div>
                    <h3>{mine ? `你約 ${other}` : `${other} 約你`}</h3>
                    <p>
                      {meetupText(item)} · {MEETUP_STATUS[item.status] || item.status}
                    </p>
                  </div>
                  {!mine && item.status === 'pending' && (
                    <div className={styles.toolbar}>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={pendingAction}
                        onClick={() =>
                          void perform(
                            () => respondMeetup(item.id, 'accepted'),
                            () => {
                              setNotice('已答應，對方會看到。');
                              refresh();
                            },
                            '未能確認邀約回覆，請重新讀取後再試。',
                          )
                        }
                      >
                        答應
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={pendingAction}
                        onClick={() =>
                          void perform(
                            () => respondMeetup(item.id, 'declined'),
                            () => {
                              setNotice('已婉拒。');
                              refresh();
                            },
                            '未能確認邀約回覆，請重新讀取後再試。',
                          )
                        }
                      >
                        婉拒
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.panel} aria-label="好友">
        <h2>好友</h2>
        {friends.length === 0 ? (
          <p className={styles.notice}>
            還沒有好友。對方接受邀請並開放課表分享後，就能查看共同空堂。
          </p>
        ) : (
          <ul className={styles.list}>
            {friends.map((friend) => (
              <li key={friend.id}>
                <div>
                  <h3>{friend.name}</h3>
                  <p>已是好友</p>
                </div>
                <Link
                  className="btn"
                  href={`/timetable?friend=${encodeURIComponent(friend.uid)}&schoolId=${encodeURIComponent(schoolId)}`}
                >
                  看共同空堂
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SiteShell>
  );
}
