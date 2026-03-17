import type { Announcement, ClubEvent, MenuItem, Poi } from "./types";

export type FindByIdOptions = {
  fallbackToFirst?: boolean;
};

export function findById<T extends { id: string }>(
  items: T[], 
  id: string | undefined,
  options: FindByIdOptions = {}
): T | null {
  const { fallbackToFirst = false } = options;
  
  if (!id) {
    return fallbackToFirst ? (items[0] ?? null) : null;
  }
  
  const found = items.find((x) => x.id === id);
  if (found) {
    return found;
  }
  
  return fallbackToFirst ? (items[0] ?? null) : null;
}

export function findByIdStrict<T extends { id: string }>(
  items: T[], 
  id: string
): T | null {
  return items.find((x) => x.id === id) ?? null;
}

export function findByIdOrFirst<T extends { id: string }>(
  items: T[], 
  id: string | undefined
): T | null {
  if (!id) return items[0] ?? null;
  return items.find((x) => x.id === id) ?? items[0] ?? null;
}

export type AnyItem = Announcement | ClubEvent | Poi | MenuItem;
