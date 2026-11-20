import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDb, isFirebaseMockMode } from '../firebase';
import {
  isHttpsOrderingUrl,
  storefrontUrlIssue,
  trimStorefrontUrl,
  resolveStoredMerchantMode,
  type MerchantMode,
} from '@campus/shared/src/merchantMode';

export type ShopMenuItem = {
  id: string;
  name: string;
  price: number | null;
  soldOut: boolean;
};

export type ShopHours = {
  openingHours: string;
};

const localKey = (cafeteriaId: string) => `campus-one-shop:${cafeteriaId}`;

export type ShopStorefront = ShopHours & {
  intro: string;
  location: string;
  websiteUrl: string;
  orderingUrl: string;
  merchantMode: MerchantMode;
};

type LocalShop = {
  hours: string;
  items: ShopMenuItem[];
  intro?: string;
  location?: string;
  websiteUrl?: string;
  orderingUrl?: string;
  merchantMode?: MerchantMode;
};

async function readLocal(cafeteriaId: string): Promise<LocalShop> {
  try {
    const raw = await AsyncStorage.getItem(localKey(cafeteriaId));
    if (!raw) return { hours: '', items: [] };
    const parsed = JSON.parse(raw) as LocalShop;
    return {
      hours: parsed.hours || '',
      items: Array.isArray(parsed.items) ? parsed.items : [],
      intro: parsed.intro || '',
      location: parsed.location || '',
      websiteUrl: parsed.websiteUrl || '',
      orderingUrl: parsed.orderingUrl || '',
      merchantMode: parsed.merchantMode,
    };
  } catch {
    return { hours: '', items: [] };
  }
}

async function writeLocal(cafeteriaId: string, next: LocalShop) {
  await AsyncStorage.setItem(localKey(cafeteriaId), JSON.stringify(next));
}

export async function loadShopMenu(schoolId: string, cafeteriaId: string): Promise<ShopMenuItem[]> {
  const local = await readLocal(cafeteriaId);
  if (isFirebaseMockMode()) return local.items;
  try {
    const snap = await getDocs(
      query(
        collection(getDb(), 'schools', schoolId, 'menus'),
        where('cafeteriaId', '==', cafeteriaId),
      ),
    );
    return snap.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        name: String(data.name || ''),
        price: typeof data.price === 'number' ? data.price : null,
        soldOut: data.soldOut === true,
      };
    });
  } catch {
    return local.items;
  }
}

export async function loadShopHours(schoolId: string, cafeteriaId: string): Promise<ShopHours> {
  const local = await readLocal(cafeteriaId);
  if (isFirebaseMockMode()) return { openingHours: local.hours };
  try {
    const snap = await getDoc(doc(getDb(), 'schools', schoolId, 'cafeterias', cafeteriaId));
    return { openingHours: String(snap.data()?.openingHours || local.hours) };
  } catch {
    return { openingHours: local.hours };
  }
}

export async function saveShopHours(input: {
  schoolId: string;
  cafeteriaId: string;
  openingHours: string;
}): Promise<{ stored: 'cloud' | 'local' }> {
  const local = await readLocal(input.cafeteriaId);
  const openingHours = input.openingHours.trim().slice(0, 120);
  await writeLocal(input.cafeteriaId, { ...local, hours: openingHours });
  if (isFirebaseMockMode()) return { stored: 'local' };
  try {
    await updateDoc(doc(getDb(), 'schools', input.schoolId, 'cafeterias', input.cafeteriaId), {
      openingHours,
      updatedAt: serverTimestamp(),
      sourceLabel: 'shop-dock',
    });
    return { stored: 'cloud' };
  } catch {
    return { stored: 'local' };
  }
}

export async function saveShopMenuItem(input: {
  schoolId: string;
  cafeteriaId: string;
  cafeteriaName: string;
  item: ShopMenuItem;
}): Promise<{ stored: 'cloud' | 'local' }> {
  const local = await readLocal(input.cafeteriaId);
  const items = local.items.some((row) => row.id === input.item.id)
    ? local.items.map((row) => (row.id === input.item.id ? input.item : row))
    : [...local.items, input.item];
  await writeLocal(input.cafeteriaId, { ...local, items });
  if (isFirebaseMockMode()) return { stored: 'local' };
  try {
    await setDoc(doc(getDb(), 'schools', input.schoolId, 'menus', input.item.id), {
      schoolId: input.schoolId,
      cafeteriaId: input.cafeteriaId,
      cafeteria: input.cafeteriaName,
      name: input.item.name.trim().slice(0, 80),
      price: input.item.price,
      soldOut: input.item.soldOut,
      availableOn: new Date().toISOString().slice(0, 10),
      updatedAt: serverTimestamp(),
    });
    return { stored: 'cloud' };
  } catch {
    return { stored: 'local' };
  }
}

export async function loadShopStorefront(
  schoolId: string,
  cafeteriaId: string,
): Promise<ShopStorefront> {
  const local = await readLocal(cafeteriaId);
  const fromLocal = {
    openingHours: local.hours,
    intro: local.intro || '',
    location: local.location || '',
    websiteUrl: local.websiteUrl || '',
    orderingUrl: local.orderingUrl || '',
    merchantMode: resolveStoredMerchantMode({ merchantMode: local.merchantMode }),
  };
  if (isFirebaseMockMode()) return fromLocal;
  try {
    const snap = await getDoc(doc(getDb(), 'schools', schoolId, 'cafeterias', cafeteriaId));
    const data = snap.data() || {};
    return {
      openingHours: String(data.openingHours || local.hours || ''),
      intro: String(data.intro || local.intro || ''),
      location: String(data.location || local.location || ''),
      websiteUrl: String(data.websiteUrl || local.websiteUrl || ''),
      orderingUrl: String(data.orderingUrl || local.orderingUrl || ''),
      merchantMode: resolveStoredMerchantMode(data),
    };
  } catch {
    return fromLocal;
  }
}

export async function saveShopStorefront(input: {
  schoolId: string;
  cafeteriaId: string;
  storefront: ShopStorefront;
}): Promise<{ stored: 'cloud' | 'local' }> {
  const local = await readLocal(input.cafeteriaId);
  const openingHours = input.storefront.openingHours.trim().slice(0, 120);
  const intro = input.storefront.intro.trim().slice(0, 500);
  const location = input.storefront.location.trim().slice(0, 120);
  const websiteUrl = trimStorefrontUrl(input.storefront.websiteUrl);
  const orderingUrl = trimStorefrontUrl(input.storefront.orderingUrl);
  const websiteIssue = storefrontUrlIssue(input.storefront.websiteUrl);
  const orderingIssue = storefrontUrlIssue(input.storefront.orderingUrl);
  if (websiteIssue) throw new Error(websiteIssue);
  if (orderingIssue) throw new Error(orderingIssue);
  const merchantMode =
    input.storefront.merchantMode === 'native_order'
      ? 'native_order'
      : input.storefront.merchantMode === 'showcase_link' && isHttpsOrderingUrl(orderingUrl)
        ? 'showcase_link'
        : 'info_only';
  await writeLocal(input.cafeteriaId, {
    ...local,
    hours: openingHours,
    intro,
    location,
    websiteUrl,
    orderingUrl,
    merchantMode,
  });
  if (isFirebaseMockMode()) return { stored: 'local' };
  try {
    await updateDoc(doc(getDb(), 'schools', input.schoolId, 'cafeterias', input.cafeteriaId), {
      openingHours,
      intro,
      location,
      websiteUrl: isHttpsOrderingUrl(websiteUrl) ? websiteUrl : '',
      orderingUrl: isHttpsOrderingUrl(orderingUrl) ? orderingUrl : '',
      merchantMode,
      updatedAt: serverTimestamp(),
      sourceLabel: 'shop-dock',
    });
    return { stored: 'cloud' };
  } catch {
    return { stored: 'local' };
  }
}

export async function createShopPost(input: {
  schoolId: string;
  cafeteriaId: string;
  title: string;
  text: string;
  kind: 'post' | 'announcement' | 'promo';
}): Promise<{ stored: 'cloud' | 'local' }> {
  const title = input.title.trim().slice(0, 80);
  const text = input.text.trim().slice(0, 2000);
  if (!text) throw new Error('請填貼文內容');
  if (isFirebaseMockMode()) return { stored: 'local' };
  try {
    await setDoc(doc(collection(getDb(), 'schools', input.schoolId, 'cafeterias', input.cafeteriaId, 'posts')), {
      title,
      text,
      kind: input.kind,
      createdAt: serverTimestamp(),
      likeCount: 0,
    });
    return { stored: 'cloud' };
  } catch {
    return { stored: 'local' };
  }
}

export async function deleteShopMenuItem(input: {
  schoolId: string;
  cafeteriaId: string;
  id: string;
}): Promise<{ stored: 'cloud' | 'local' }> {
  const local = await readLocal(input.cafeteriaId);
  await writeLocal(input.cafeteriaId, {
    ...local,
    items: local.items.filter((row) => row.id !== input.id),
  });
  if (isFirebaseMockMode()) return { stored: 'local' };
  try {
    await deleteDoc(doc(getDb(), 'schools', input.schoolId, 'menus', input.id));
    return { stored: 'cloud' };
  } catch {
    return { stored: 'local' };
  }
}
