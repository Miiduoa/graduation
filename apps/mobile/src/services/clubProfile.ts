import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
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
  const posts = await getDocsFromServer(
    query(collection(getDb(), 'groups', groupId, 'posts'), orderBy('createdAt', 'desc'), limit(20)),
  );
  if (getAuthInstance().currentUser !== user) throw new Error('帳號已變更');
  return {
    name: typeof data.name === 'string' ? data.name : '未命名社團',
    description: typeof data.description === 'string' ? data.description : '',
    role: typeof member.role === 'string' ? member.role : 'member',
    memberCount:
      Number.isInteger(data.memberCount) && data.memberCount >= 0
        ? (data.memberCount as number)
        : null,
    announcements: posts.docs
      .filter((post) => post.data().kind === 'announcement')
      .slice(0, 3)
      .map((post) => ({
        id: post.id,
        title: String(post.data().title || ''),
        body: String(post.data().body || ''),
      })),
  };
}
