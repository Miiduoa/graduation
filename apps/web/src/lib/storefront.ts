import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { getDb, isFirebaseConfigured, type Cafeteria } from '@/lib/firebase';
import {
  EXTERNAL_ORDER_HONEST_TEXT,
  buildShowcaseOrderingUrl,
  isHttpsOrderingUrl,
  resolveStoredMerchantMode,
  safeStorefrontUrl,
  storefrontUrlIssue,
  trimStorefrontUrl,
} from '@campus/shared/src/merchantMode';

export type StorefrontPost = {
  id: string;
  title: string;
  text: string;
  kind: 'post' | 'announcement' | 'promo';
  createdAt: string;
  likeCount: number;
  liked: boolean;
};

export type StorefrontComment = {
  id: string;
  authorId: string;
  text: string;
};

export function cafeteriaPath(schoolId: string, cafeteriaId: string) {
  return ['schools', schoolId, 'cafeterias', cafeteriaId] as const;
}

export async function loadStorefront(
  schoolId: string,
  cafeteriaId: string,
): Promise<Cafeteria | null> {
  if (!isFirebaseConfigured() || !cafeteriaId || cafeteriaId.includes('/')) return null;
  const snapshot = await getDocFromServer(doc(getDb(), ...cafeteriaPath(schoolId, cafeteriaId)));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data.schoolId != null && data.schoolId !== schoolId) return null;
  return {
    id: snapshot.id,
    name: typeof data.name === 'string' ? data.name : '未命名店家',
    location: typeof data.location === 'string' ? data.location : undefined,
    openingHours: typeof data.openingHours === 'string' ? data.openingHours : undefined,
    intro: typeof data.intro === 'string' ? data.intro : undefined,
    coverUrl: typeof data.coverUrl === 'string' ? data.coverUrl : undefined,
    websiteUrl: safeStorefrontUrl(data.websiteUrl),
    orderingUrl: safeStorefrontUrl(data.orderingUrl),
    merchantMode: resolveStoredMerchantMode(data),
    menuSyncedAt:
      typeof data.menuSyncedAt === 'string'
        ? data.menuSyncedAt
        : data.menuSyncedAt && typeof data.menuSyncedAt.toDate === 'function'
          ? data.menuSyncedAt.toDate().toISOString()
          : undefined,
    schoolId,
  };
}

export async function loadStorefrontPosts(
  schoolId: string,
  cafeteriaId: string,
  uid?: string | null,
): Promise<StorefrontPost[]> {
  const snapshot = await getDocsFromServer(
    query(
      collection(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'posts'),
      orderBy('createdAt', 'desc'),
      limit(30),
    ),
  );
  const posts: StorefrontPost[] = snapshot.docs.flatMap((row) => {
    const data = row.data();
    if (data.kind === 'draft') return [];
    const kind: StorefrontPost['kind'] =
      data.kind === 'promo' || data.kind === 'announcement' ? data.kind : 'post';
    return [
      {
        id: row.id,
        title: typeof data.title === 'string' ? data.title : '',
        text: typeof data.text === 'string' ? data.text : '',
        kind,
        createdAt:
          data.createdAt && typeof data.createdAt.toDate === 'function'
            ? data.createdAt.toDate().toISOString()
            : '',
        likeCount: typeof data.likeCount === 'number' ? data.likeCount : 0,
        liked: false,
      },
    ];
  });
  if (!uid) return posts;
  const liked = await Promise.all(
    posts.map((post) =>
      getDocFromServer(
        doc(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'posts', post.id, 'likes', uid),
      ),
    ),
  );
  return posts.map((post, index) => ({ ...post, liked: liked[index]?.exists() === true }));
}

export async function followStorefront(
  schoolId: string,
  cafeteriaId: string,
  uid: string,
  on: boolean,
) {
  const ref = doc(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'followers', uid);
  if (on) await setDoc(ref, { createdAt: serverTimestamp() });
  else await deleteDoc(ref);
}

export async function isFollowingStorefront(schoolId: string, cafeteriaId: string, uid: string) {
  const snapshot = await getDocFromServer(
    doc(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'followers', uid),
  );
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
  const snapshot = await getDocsFromServer(
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

export async function recordExternalOrderClick(input: {
  uid: string;
  schoolId: string;
  cafeteriaId: string;
  orderingUrl: string;
}) {
  if (!isHttpsOrderingUrl(input.orderingUrl)) throw new Error('Invalid ordering url');
  const tagged = buildShowcaseOrderingUrl(input.orderingUrl, input.schoolId, input.cafeteriaId);
  await addDoc(
    collection(getDb(), 'users', input.uid, 'schools', input.schoolId, 'externalOrders'),
    {
      fulfillment: 'external',
      schoolId: input.schoolId,
      cafeteriaId: input.cafeteriaId,
      orderingUrl: tagged,
      clickedAt: serverTimestamp(),
    },
  );
  return tagged;
}

export async function saveShopStorefront(input: {
  schoolId: string;
  cafeteriaId: string;
  websiteUrl?: string;
  orderingUrl?: string;
  intro?: string;
  location?: string;
  openingHours?: string;
  merchantMode?: 'showcase_link' | 'info_only' | 'native_order';
}) {
  const websiteUrl = trimStorefrontUrl(input.websiteUrl);
  const orderingUrl = trimStorefrontUrl(input.orderingUrl);
  const websiteIssue = storefrontUrlIssue(input.websiteUrl);
  const orderingIssue = storefrontUrlIssue(input.orderingUrl);
  if (websiteIssue) throw new Error(websiteIssue);
  if (orderingIssue) throw new Error(orderingIssue);
  if (!isFirebaseConfigured() || !input.cafeteriaId || input.cafeteriaId.includes('/')) {
    throw new Error('暫時無法寫入店面。');
  }
  await updateDoc(doc(getDb(), ...cafeteriaPath(input.schoolId, input.cafeteriaId)), {
    websiteUrl: websiteUrl && isHttpsOrderingUrl(websiteUrl) ? websiteUrl : '',
    orderingUrl: orderingUrl && isHttpsOrderingUrl(orderingUrl) ? orderingUrl : '',
    intro: typeof input.intro === 'string' ? input.intro.trim().slice(0, 500) : '',
    location: typeof input.location === 'string' ? input.location.trim().slice(0, 120) : '',
    openingHours: typeof input.openingHours === 'string' ? input.openingHours.trim().slice(0, 120) : '',
    merchantMode:
      input.merchantMode === 'showcase_link' && isHttpsOrderingUrl(orderingUrl)
        ? 'showcase_link'
        : input.merchantMode === 'native_order'
          ? 'native_order'
          : 'info_only',
    updatedAt: serverTimestamp(),
    sourceLabel: 'shop-dock',
  });
  return { websiteUrl, orderingUrl };
}

export function honestExternalCopy() {
  return EXTERNAL_ORDER_HONEST_TEXT;
}

export function watchStorefrontPosts(
  schoolId: string,
  cafeteriaId: string,
  onNext: (posts: StorefrontPost[]) => void,
  onError: (error: unknown) => void,
) {
  if (!isFirebaseConfigured()) {
    onError(new Error('unavailable'));
    return () => undefined;
  }
  return onSnapshot(
    query(
      collection(getDb(), ...cafeteriaPath(schoolId, cafeteriaId), 'posts'),
      orderBy('createdAt', 'desc'),
      limit(30),
    ),
    (snapshot) =>
      onNext(
        snapshot.docs.flatMap((row) => {
          const data = row.data();
          if (data.kind === 'draft') return [];
          return [
            {
              id: row.id,
              title: typeof data.title === 'string' ? data.title : '',
              text: typeof data.text === 'string' ? data.text : '',
              kind: data.kind === 'promo' || data.kind === 'announcement' ? data.kind : 'post',
              createdAt: '',
              likeCount: typeof data.likeCount === 'number' ? data.likeCount : 0,
              liked: false,
            },
          ];
        }),
      ),
    onError,
  );
}
