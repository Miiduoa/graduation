'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { WEEKDAY_LABELS, friendResendCopy, periodRangeLabel } from '@campus/shared';
import { SiteShell } from '@/components/SiteShell';
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
  status: 'pending' | 'accepted' | 'declined';
};

const MEETUP_STATUS: Record<Meetup['status'], string> = {
  pending: '等回覆',
  accepted: '已答應',
  declined: '已婉拒',
};

export default function FriendsPage() {
  const { user } = useAuth();
  const school = useSelectedSchool();
  const schoolId = school.selectedSchoolId || 'pu';
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

  const reload = useCallback(async () => {
    if (!user) return;
    try {
      const [accepted, waiting, mine, invites] = await Promise.all([
        listAcceptedFriends(schoolId, user.uid),
        listPendingRequests(schoolId, user.uid),
        loadMyHandle(user.uid),
        listMyMeetups(schoolId, user.uid),
      ]);
      setFriends(accepted);
      setPending(waiting);
      setMyHandle(mine.handle);
      setHandleInput((current) => current || mine.handle);
      setMyName(mine.name);
      setMeetups(invites as unknown as Meetup[]);
    } catch {
      setNotice('現在讀不到好友資料，請稍後再試。');
    }
  }, [user, schoolId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!user) {
    return (
      <SiteShell title="找人" subtitle="加好友之後，才能看對方課表、約共同空堂。">
        <p className={styles.notice}>
          請先 <Link href="/login?returnUrl=/friends">登入</Link>。成為好友前，看不到任何人的課表。
        </p>
      </SiteShell>
    );
  }

  const nameOf = (uid: string) => friends.find((friend) => friend.uid === uid)?.name || '同學';
  const incoming = pending.filter((row) => row.incoming);
  const outgoing = pending.filter((row) => !row.incoming);
  const meetupLabel = (item: Meetup) =>
    `${WEEKDAY_LABELS[item.day - 1] || ''} ${periodRangeLabel(item.startPeriod, item.endPeriod)} ${
      item.kind === 'meal' ? '吃飯' : '讀書'
    }`;

  const search = async () => {
    setSearched(false);
    setHit(null);
    const handle = normalizeHandle(needle);
    if (!isValidHandle(handle)) {
      setNotice('請輸入完整的找人代號，例如 @wei_0312。');
      return;
    }
    try {
      const found = await findByHandle(schoolId, handle);
      const usable = found && found.uid !== user.uid ? found : null;
      setHit(usable);
      setHitState(usable ? await sentRequestState(schoolId, user.uid, usable.uid) : { kind: 'none' });
      setSearched(true);
      setNotice('');
    } catch {
      setNotice('這次沒有查成功，請稍後再試。');
    }
  };

  return (
    <SiteShell title="找人" subtitle="用同學給你的找人代號加好友。加好友之後才看得到課表。">
      {notice && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}

      <section className={styles.panel} aria-label="我的找人代號">
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
            onChange={(event) => setHandleInput(event.target.value)}
            placeholder="英文小寫、數字或底線，3 到 32 字"
          />
        </label>
        <div className={styles.toolbar}>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void publishHandle(schoolId, user.uid, handleInput, myName)
                .then((handle) => {
                  setMyHandle(handle);
                  setNotice(`已開放，同學輸入 @${handle} 就能找到你。`);
                })
                .catch(() => setNotice('這個代號不能用，可能格式不對或已經有人用了。'))
            }
          >
            {myHandle ? '更新代號' : '開放代號'}
          </button>
          {myHandle && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                void unpublishHandle(schoolId, user.uid).then(() => {
                  setMyHandle('');
                  setNotice('已關掉，同學查不到你的代號了。');
                })
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
            onChange={(event) => setNeedle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void search();
              }
            }}
            placeholder="@代號"
          />
        </label>
        <button type="button" className="btn" onClick={() => void search()}>
          查詢
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
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void sendFriendRequest(schoolId, user.uid, hit.uid, myName, hit.name)
                      .then((result) => {
                        setHitState({ kind: result === 'accepted' ? 'accepted' : 'pending' });
                        setNotice(
                          result === 'accepted'
                            ? '你們已經是好友了。'
                            : result === 'pending'
                              ? '邀請已經送過了，等對方回覆。'
                              : '已送出好友邀請，等對方接受。',
                        );
                      })
                      .then(reload)
                      .catch(async () => {
                        const state = await sentRequestState(schoolId, user.uid, hit.uid);
                        setHitState(state);
                        if (state.kind !== 'declined') setNotice('邀請沒有送出，請稍後再試。');
                      })
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
                    onClick={() =>
                      void acceptFriendRequest(row.id, myName)
                        .then(() => setNotice(`已和 ${row.name} 成為好友。`))
                        .then(reload)
                        .catch(() => setNotice('沒有接受成功，請稍後再試。'))
                    }
                  >
                    接受
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void declineFriendRequest(row.id)
                        .then(() => setNotice('已婉拒。'))
                        .then(reload)
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
                  onClick={() => void cancelFriendRequest(row.id).then(reload)}
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
              const mine = item.creatorUid === user.uid;
              const other = nameOf(mine ? item.inviteeUid : item.creatorUid);
              return (
                <li key={item.id}>
                  <div>
                    <h3>{mine ? `你約 ${other}` : `${other} 約你`}</h3>
                    <p>
                      {meetupLabel(item)} · {MEETUP_STATUS[item.status] || item.status}
                    </p>
                  </div>
                  {!mine && item.status === 'pending' && (
                    <div className={styles.toolbar}>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => void respondMeetup(item.id, 'accepted').then(reload)}
                      >
                        答應
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void respondMeetup(item.id, 'declined').then(reload)}
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
          <p className={styles.notice}>還沒有好友。對方接受邀請後，才看得到彼此的課表。</p>
        ) : (
          <ul className={styles.list}>
            {friends.map((friend) => (
              <li key={friend.id}>
                <div>
                  <h3>{friend.name}</h3>
                  <p>已是好友</p>
                </div>
                <Link className="btn" href={`/timetable?friend=${encodeURIComponent(friend.uid)}`}>
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
