import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { getDb, isFirebaseMockMode } from '../firebase';
import { resolveStoredMerchantMode, type MerchantMode } from '@campus/shared/src/merchantMode';

export type StorefrontShop = {
  id: string;
  name: string;
  intro?: string;
  location?: string;
  openingHours?: string;
  websiteUrl?: string;
  orderingUrl?: string;
  merchantMode: MerchantMode;
  orderingEnabled?: boolean;
  menuSyncedAt?: string;
};

export type StorefrontPost = {
  id: string;
  title: string;
  text: string;
  kind: 'post' | 'announcement' | 'promo';
  likeCount: number;
  liked: boolean;
};

export type StorefrontComment = {
  id: string;
  authorId: string;
  text: string;
};

function cafeteriaPath(schoolId: string, cafeteriaId: string) {
  return ['schools', schoolId, 'cafeterias', cafeteriaId] as const;
}

export async function loadStorefront(schoolId: string, cafeteriaId: string): Promise<StorefrontShop | null> {
  if (isFirebaseMockMode() || !cafeteriaId || cafeteriaId.includes('/')) return null;
  const snapshot = await getDoc(doc(getDb(), ...cafeteriaPath(schoolId, cafeteriaId)));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data.schoolId != null && data.schoolId !== schoolId) return null;
  return {
    id: snapshot.id,
    name: typeof data.name === 'string' ? data.name : '未命名店家',
    intro: typeof data.intro === 'string' ? data.intro : undefined,
    location: typeof data.location === 'string' ? data.location : undefined,
    openingHours: typeof data.openingHours === 'string' ? data.openingHours : undefined,
    websiteUrl: typeof data.websiteUrl === 'string' ? data.websiteUrl : undefined,
    orderingUrl: typeof data.orderingUrl === 'string' ? data.orderingUrl : undefined,
    merchantMode: resolveStoredMerchantMode(data),
    orderingEnabled: data.orderingEnabled === true,
    menuSyncedAt:
      typeof data.menuSyncedAt === 'string'
        ? data.menuSyncedAt
        : data.menuSyncedAt && typeof data.menuSyncedAt.toDate === 'function'
          ? data.menuSyncedAt.toDate().toISOString()
          : undefined,
  };
}

export async function loadStorefrontPosts(
  schoolId: string,
  cafeteriaId: string,
  uid?: string | null,
): Promise<StorefrontPost[]> {
  const snapshot = await getDocs(
    query(
      collection(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'posts'),
      orderBy('createdAt', 'desc'),
      limit(30),
    ),
  );
  const posts = snapshot.docs.flatMap((row) => {
    const data = row.data();
    if (data.kind === 'draft') return [];
    return [
      {
        id: row.id,
        title: typeof data.title === 'string' ? data.title : '',
        text: typeof data.text === 'string' ? data.text : '',
        kind: data.kind === 'promo' || data.kind === 'announcement' ? data.kind : 'post',
        likeCount: typeof data.likeCount === 'number' ? data.likeCount : 0,
        liked: false,
      } satisfies StorefrontPost,
    ];
  });
  if (!uid) return posts;
  const liked = await Promise.all(
    posts.map((post) => getDoc(doc(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'posts', post.id, 'likes', uid))),
  );
  return posts.map((post, index) => ({ ...post, liked: liked[index]?.exists() === true }));
}

export async function followStorefront(schoolId: string, cafeteriaId: string, uid: string, on: boolean) {
  const ref = doc(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'followers', uid);
  if (on) await setDoc(ref, { createdAt: serverTimestamp() });
  else await deleteDoc(ref);
}

export async function isFollowingStorefront(schoolId: string, cafeteriaId: string, uid: string) {
  const snapshot = await getDoc(doc(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'followers', uid));
  return snapshot.exists();
}

export async function toggleStorefrontLike(
  schoolId: string,
  cafeteriaId: string,
  postId: string,
  uid: string,
  liked: boolean,
) {
  const ref = doc(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'posts', postId, 'likes', uid);
  if (liked) await deleteDoc(ref);
  else await setDoc(ref, { createdAt: serverTimestamp() });
}

export async function addStorefrontComment(
  schoolId: string,
  cafeteriaId: string,
  postId: string,
  uid: string,
  text: string,
) {
  await addDoc(collection(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'posts', postId, 'comments'), {
    authorId: uid,
    text: text.trim().slice(0, 2000),
    createdAt: serverTimestamp(),
  });
}

export async function loadStorefrontComments(
  schoolId: string,
  cafeteriaId: string,
  postId: string,
): Promise<StorefrontComment[]> {
  const snapshot = await getDocs(
    query(
      collection(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'posts', postId, 'comments'),
      orderBy('createdAt', 'asc'),
      limit(50),
    ),
  );
  return snapshot.docs.map((row) => ({
    id: row.id,
    authorId: typeof row.data().authorId === 'string' ? row.data().authorId : '',
    text: typeof row.data().text === 'string' ? row.data().text : '',
  }));
}
