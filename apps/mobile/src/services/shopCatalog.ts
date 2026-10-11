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

type LocalShop = { hours: string; items: ShopMenuItem[] };

async function readLocal(cafeteriaId: string): Promise<LocalShop> {
  try {
    const raw = await AsyncStorage.getItem(localKey(cafeteriaId));
    if (!raw) return { hours: '', items: [] };
    const parsed = JSON.parse(raw) as LocalShop;
    return { hours: parsed.hours || '', items: Array.isArray(parsed.items) ? parsed.items : [] };
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
