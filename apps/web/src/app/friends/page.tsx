'use client';

import { useEffect, useState } from 'react';
import { SiteShell } from '@/components/SiteShell';
import { useAuth } from '@/components/AuthGuard';
import { useSelectedSchool } from '@/components/SelectedSchoolProvider';
import {
  acceptFriendRequest,
  listAcceptedFriends,
  searchPeople,
  sendFriendRequest,
  type FriendRow,
} from '@/lib/timetable/friends';
import styles from '@/components/academic/academic.module.css';
import Link from 'next/link';

export default function FriendsPage() {
  const { user } = useAuth();
  const school = useSelectedSchool();
  const schoolId = school.selectedSchoolId || 'pu';
  const [needle, setNeedle] = useState('');
  const [hits, setHits] = useState<Array<{ uid: string; name: string; username?: string }>>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!user) return;
    void listAcceptedFriends(schoolId, user.uid)
      .then(setFriends)
      .catch(() => setNotice('現在讀不到好友名單。可能是還沒登入學校，或好友功能尚未對這所學校開放。'));
  }, [user, schoolId]);

  if (!user) {
    return (
      <SiteShell title="找人" subtitle="加好友之後，才能看對方課表、約共同空堂。">
        <p className={styles.notice}>
          請先 <Link href="/login?returnUrl=/friends">登入</Link>。未成為好友前，不會露出任何人的課表。
        </p>
      </SiteShell>
    );
  }

  return (
    <SiteShell title="找人" subtitle="用姓名或 @帳號找同學。加好友之後才能看課表。">
      {notice && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}
      <label className={styles.field}>
        搜尋
        <input
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          placeholder="姓名或 @帳號"
        />
      </label>
      <button
        type="button"
        className="btn"
        onClick={() =>
          void searchPeople(schoolId, needle)
            .then(setHits)
            .catch(() => setNotice('學校還沒開放同學名冊搜尋，或這次查詢沒有成功。'))
        }
      >
        搜尋
      </button>
      <ul className={styles.list}>
        {hits.map((hit) => (
          <li key={hit.uid}>
            <div>
              <h3>{hit.name}</h3>
              <p>{hit.username ? `@${hit.username}` : hit.uid}</p>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void sendFriendRequest(schoolId, user.uid, hit.uid)
                  .then(() => setNotice('已送出好友邀請。'))
                  .catch(() => setNotice('邀請沒有送出。可能已經是好友，或對方不在同一所學校。'))
              }
            >
              加好友
            </button>
          </li>
        ))}
      </ul>
      <section className={styles.panel}>
        <h2>已是好友</h2>
        {friends.length === 0 ? (
          <p className={styles.notice}>還沒有好友。對方接受邀請後，才看得到課表。</p>
        ) : (
          <ul className={styles.list}>
            {friends.map((friend) => (
              <li key={friend.id}>
                <div>
                  <h3>{friend.name}</h3>
                  <p>{friend.username ? `@${friend.username}` : '已接受'}</p>
                </div>
                <Link className="btn" href="/timetable">
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
