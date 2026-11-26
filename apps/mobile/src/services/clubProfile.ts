import { clubProfileFeed } from '@campus/shared/src/clubProfile';
import { callClubPortal } from './clubPortal';
import { doc, getDocFromServer } from 'firebase/firestore';
import { postNuniWebFn } from './nuniWebFn';
import { getDb, getAuthInstance } from '../firebase';

export async function loadClubProfile(uid: string, schoolId: string, groupId: string) {
  const user = getAuthInstance().currentUser;
  if (!user || user.uid !== uid) throw new Error('請重新登入');
  const [group, mine] = await Promise.all([
    getDocFromServer(doc(getDb(), 'groups', groupId)),
    getDocFromServer(doc(getDb(), 'groups', groupId, 'members', uid)),
  ]);
  if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
  const data = group.data();
  const member = mine.data();
  if (!data || data.type !== 'club' || data.schoolId !== schoolId || member?.status !== 'active')
    throw new Error('無法確認社團資格');
  const posts = await postNuniWebFn<
    { groupId: string; pageSize: number },
    { posts: { id: string; kind?: string; title?: string; body?: string }[] }
  >('listGroupDiscussionPage', { groupId, pageSize: 20 }, uid);
  if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
  const feed = await callClubPortal(uid, schoolId, { action: 'read', groupId })
    .then(clubProfileFeed)
    .catch(() => null);
  if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
  return {
    feed,
    name: typeof data.name === 'string' ? data.name : '未命名社團',
    description: typeof data.description === 'string' ? data.description : '',
    meetingTime:
      typeof data.clubProfile?.meetingTime === 'string' ? data.clubProfile.meetingTime.trim() : '',
    role: typeof member.role === 'string' ? member.role : 'member',
    memberCount:
      Number.isInteger(data.memberCount) && data.memberCount >= 0
        ? (data.memberCount as number)
        : null,
    announcements: posts.posts
      .filter((post) => post.kind === 'announcement')
      .slice(0, 3)
      .map((post) => ({
        id: post.id,
        title: String(post.title || ''),
        body: String(post.body || ''),
      })),
  };
}
