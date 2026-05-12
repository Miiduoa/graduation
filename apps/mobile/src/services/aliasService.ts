/* eslint-disable @typescript-eslint/no-explicit-any */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getDb } from '../firebase';

const ANIMALS = [
  '河馬',
  '企鵝',
  '貓頭鷹',
  '水豚',
  '狐狸',
  '兔子',
  '刺蝟',
  '浣熊',
  '柴犬',
  '鸚鵡',
  '海豚',
  '無尾熊',
  '熊貓',
  '紅鶴',
  '海龜',
  '倉鼠',
  '松鼠',
  '蜜蜂',
  '蝴蝶',
];

export type BoardAliasDoc = {
  alias: string;
  animal: string;
  num: number;
  boardId: string;
  schoolId: string;
  updatedAt?: any;
};

function stableNumFromSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 100;
}

function pickAnimal(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 17 + seed.charCodeAt(i)) >>> 0;
  return ANIMALS[h % ANIMALS.length];
}

/** 每看板穩定匿名暱稱（users/{uid}/campusBoardAliases/{boardId}） */
export async function getOrCreateBoardAlias(
  uid: string,
  schoolId: string,
  boardId: string,
  db: Firestore = getDb(),
): Promise<string> {
  const ref = doc(db, 'users', uid, 'campusBoardAliases', boardId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const d = snap.data() as BoardAliasDoc;
    if (d?.alias) return d.alias;
  }
  const seed = `${uid}|${schoolId}|${boardId}`;
  const animal = pickAnimal(seed);
  const num = stableNumFromSeed(seed);
  const alias = `匿名${animal} #${num}`;
  const payload: BoardAliasDoc = {
    alias,
    animal,
    num,
    boardId,
    schoolId,
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload, { merge: true });
  return alias;
}
