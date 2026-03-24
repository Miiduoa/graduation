/* eslint-disable */
import React, { createContext, useContext, useCallback, useMemo } from "react";
import { getScopedStorageKey } from "../services/scopedStorage";
import { usePersistedState } from "../hooks/usePersistedState";

const STORAGE_KEY_PREFIX = "@search_history";
const STORAGE_VERSION = "v3"; // Updated version to include schoolId
const MAX_HISTORY_ITEMS = 20;

function getStorageKey(userId: string | null, schoolId: string | null): string {
  return getScopedStorageKey("search-history", { uid: userId, schoolId });
}

function getLegacyStorageKey(userId: string | null, schoolId: string | null): string {
  const userPart = userId || "anonymous";
  const schoolPart = schoolId || "default";
  return `${STORAGE_KEY_PREFIX}.${userPart}.${schoolPart}.${STORAGE_VERSION}`;
}

export type SearchHistoryItem = {
  query: string;
  type: "announcement" | "event" | "poi" | "menu" | "group" | "all";
  timestamp: number;
};

type SearchHistoryContextValue = {
  history: SearchHistoryItem[];
  addSearch: (query: string, type: SearchHistoryItem["type"]) => void;
  removeSearch: (timestamp: number) => void;
  clearHistory: () => void;
  recentSearches: (type?: SearchHistoryItem["type"], limit?: number) => SearchHistoryItem[];
};

const SearchHistoryContext = createContext<SearchHistoryContextValue | null>(null);

export function SearchHistoryProvider(props: { 
  children: React.ReactNode; 
  userId?: string | null;
  schoolId?: string | null;
}) {
  const userId = props.userId ?? null;
  const schoolId = props.schoolId ?? null;
  const { value: history, setValue: setHistory } = usePersistedState<SearchHistoryItem[]>({
    storageKey: getStorageKey(userId, schoolId),
    legacyKeys: [getLegacyStorageKey(userId, schoolId)],
    defaultValue: [],
    deserialize: (raw) => {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    },
  });

  const addSearch = useCallback((query: string, type: SearchHistoryItem["type"]) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setHistory((prev) => {
      const filtered = prev.filter(
        (item) => !(item.query.toLowerCase() === trimmed.toLowerCase() && item.type === type)
      );
      const newItem: SearchHistoryItem = {
        query: trimmed,
        type,
        timestamp: Date.now(),
      };
      return [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
    });
  }, []);

  const removeSearch = useCallback((timestamp: number) => {
    setHistory((prev) => prev.filter((item) => item.timestamp !== timestamp));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const recentSearches = useCallback(
    (type?: SearchHistoryItem["type"], limit = 5): SearchHistoryItem[] => {
      const filtered = type ? history.filter((item) => item.type === type) : history;
      return filtered.slice(0, limit);
    },
    [history]
  );

  const contextValue = useMemo(
    () => ({
      history,
      addSearch,
      removeSearch,
      clearHistory,
      recentSearches,
    }),
    [history, addSearch, removeSearch, clearHistory, recentSearches]
  );

  return (
    <SearchHistoryContext.Provider value={contextValue}>
      {props.children}
    </SearchHistoryContext.Provider>
  );
}

export function useSearchHistory() {
  const ctx = useContext(SearchHistoryContext);
  if (!ctx) {
    return {
      history: [],
      addSearch: () => {},
      removeSearch: () => {},
      clearHistory: () => {},
      recentSearches: () => [],
    };
  }
  return ctx;
}

export const POPULAR_SEARCHES = {
  announcement: ["期中考", "放假", "獎學金", "選課", "宿舍"],
  event: ["社團", "講座", "招生", "徵才", "展覽"],
  poi: ["圖書館", "餐廳", "體育館", "停車場", "教室"],
  menu: ["便當", "麵", "飲料", "素食", "早餐"],
  all: ["圖書館", "選課", "社團活動", "餐廳", "考試"],
};
