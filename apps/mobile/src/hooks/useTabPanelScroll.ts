import { useLayoutEffect, useRef } from 'react';
import type { ScrollView } from 'react-native';

/** A new panel starts at its heading while a reselected panel keeps its place. */
export function useTabPanelScroll(tab: string) {
  const scrollRef = useRef<ScrollView>(null);
  const previousTab = useRef(tab);
  useLayoutEffect(() => {
    if (previousTab.current === tab) return;
    previousTab.current = tab;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [tab]);
  return scrollRef;
}
