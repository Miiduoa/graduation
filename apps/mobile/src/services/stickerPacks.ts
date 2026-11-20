/* eslint-disable @typescript-eslint/no-explicit-any */
import { collection, getDocs, limit, query, type QueryDocumentSnapshot } from 'firebase/firestore';
import { getDb } from '../firebase';

export type StickerPack = { id: string; name?: string };
export type StickerItem = { id: string; url?: string; label?: string };

export async function listStickerPacks(): Promise<StickerPack[]> {
  const db = getDb();
  try {
    const snap = await getDocs(query(collection(db, 'stickers'), limit(80)));
    return snap.docs.map((d: QueryDocumentSnapshot) => ({
      id: d.id,
      ...(d.data() as object),
    })) as StickerPack[];
  } catch {
    return [];
  }
}

export async function listStickersForPack(packId: string): Promise<StickerItem[]> {
  const db = getDb();
  try {
    const snap = await getDocs(
      query(collection(db, 'stickers', packId, 'items'), limit(200)),
    );
    return snap.docs.map((d: QueryDocumentSnapshot) => ({
      id: d.id,
      ...(d.data() as object),
    })) as StickerItem[];
  } catch {
    const defaults = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    return defaults.map((e, i) => ({ id: `e_${i}`, label: e, url: undefined }));
  }
}
