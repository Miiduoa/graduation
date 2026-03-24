/* eslint-disable */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { getScopedStorageKey } from "../services/scopedStorage";
import { usePersistedState } from "../hooks/usePersistedState";

export type FavoriteKind = "announcement" | "event" | "poi" | "menu";

export type FavoritesState = {
  announcement: string[];
  event: string[];
  poi: string[];
  menu: string[];
};

type FavoritesContextValue = {
  favorites: FavoritesState;
  isFavorite: (kind: FavoriteKind, id: string) => boolean;
  toggleFavorite: (kind: FavoriteKind, id: string) => void;
  clearAll: () => void;
};

const STORAGE_KEY_PREFIX = "campus.favorites";
const STORAGE_VERSION = "v3"; // Updated version to include schoolId

function getStorageKey(userId: string | null, schoolId: string | null): string {
  return getScopedStorageKey("favorites", { uid: userId, schoolId });
}

function getLegacyStorageKey(userId: string | null, schoolId: string | null): string {
  const userPart = userId || "anonymous";
  const schoolPart = schoolId || "default";
  return `${STORAGE_KEY_PREFIX}.${userPart}.${schoolPart}.${STORAGE_VERSION}`;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

const emptyState: FavoritesState = { announcement: [], event: [], poi: [], menu: [] };

export function FavoritesProvider(props: { 
  children: React.ReactNode; 
  userId?: string | null;
  schoolId?: string | null;
}) {
  const userId = props.userId ?? null;
  const schoolId = props.schoolId ?? null;
  const { value: favorites, setValue: setFavorites } = usePersistedState<FavoritesState>({
    storageKey: getStorageKey(userId, schoolId),
    legacyKeys: [getLegacyStorageKey(userId, schoolId)],
    defaultValue: emptyState,
    deserialize: (raw) => {
      const parsed = JSON.parse(raw) as Partial<FavoritesState>;
      return {
        announcement: parsed.announcement ?? [],
        event: parsed.event ?? [],
        poi: parsed.poi ?? [],
        menu: parsed.menu ?? [],
      };
    },
  });

  // 使用 useCallback 確保函數引用穩定
  const isFavorite = useCallback(
    (kind: FavoriteKind, id: string) => {
      return favorites[kind].includes(id);
    },
    [favorites]
  );

  const toggleFavorite = useCallback(
    (kind: FavoriteKind, id: string) => {
      setFavorites((prev) => {
        const list = prev[kind];
        const nextList = list.includes(id)
          ? list.filter((x) => x !== id)
          : [...list, id];
        return { ...prev, [kind]: nextList };
      });
    },
    []
  );

  const clearAll = useCallback(() => setFavorites(emptyState), []);

  // 修復：完整列出所有依賴項
  const value = useMemo(
    () => ({ favorites, isFavorite, toggleFavorite, clearAll }),
    [favorites, isFavorite, toggleFavorite, clearAll]
  );

  return <FavoritesContext.Provider value={value}>{props.children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites must be used within FavoritesProvider");
  return ctx;
}
