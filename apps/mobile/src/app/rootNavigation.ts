/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Root tab 導向（給 Modal / _singleton_ 等非巢狀導頁環境）
 * ───────────────────────────────────────────────────────────────
 * HeaderDrawerHost、全域推播等非 Tab Screen 的子樹會拿不到 useNavigation，
 * 改由 NavigationContainer ref + CommonActions 一致地派送巢狀路由。
 */

import { CommonActions, createNavigationContainerRef } from '@react-navigation/native';

export type RootTabParamList = {
  Today: undefined;
  學習: undefined;
  校園: undefined;
  訊息: undefined;
  我的: undefined;
};

export type RootTabName = keyof RootTabParamList;

export const rootNavigationRef = createNavigationContainerRef<RootTabParamList>();

type SchoolReadyListener = () => void;
const schoolReadyListeners = new Set<SchoolReadyListener>();
let schoolNavigationReady = false;

/** Compose with SchoolNavigation onReady — no reminder-owned 300ms polling. */
export function markSchoolNavigationReady() {
  schoolNavigationReady = true;
  for (const listener of [...schoolReadyListeners]) {
    try {
      listener();
    } catch {
      /* readiness adapters must not throw into NavigationContainer */
    }
  }
}

export function markSchoolNavigationUnready() {
  schoolNavigationReady = false;
}

export function subscribeSchoolNavigationReady(listener: SchoolReadyListener) {
  schoolReadyListeners.add(listener);
  if (schoolNavigationReady && rootNavigationRef.isReady()) listener();
  return () => {
    schoolReadyListeners.delete(listener);
  };
}

export function isSchoolNavigationReady() {
  return schoolNavigationReady && rootNavigationRef.isReady();
}

function dispatchWhenReady(dispatch: () => void): boolean {
  if (rootNavigationRef.isReady()) {
    dispatch();
    return true;
  }
  requestAnimationFrame(() => {
    if (rootNavigationRef.isReady()) dispatch();
    else console.warn('[rootNavigation] NavigationContainer not ready');
  });
  return false;
}

/** 切換根 Tab（不開子螢幕） */
export function rootNavigate(tab: RootTabName) {
  return dispatchWhenReady(() => {
    rootNavigationRef.dispatch(CommonActions.navigate({ name: tab }));
  });
}

/** 根 Tab → 嵌 Stack 某一 screen（params 為子 screen 的 route params） */
export function rootNavigateNested(
  tab: RootTabName,
  screen: string,
  params?: Record<string, unknown>,
) {
  return dispatchWhenReady(() => {
    const nestPayload =
      params !== undefined && Object.keys(params).length > 0 ? { screen, params } : { screen };
    rootNavigationRef.dispatch(
      CommonActions.navigate({
        name: tab as any,
        params: nestPayload as any,
      }),
    );
  });
}

/** 「我的」隱藏 Tab 內的 MeStack route */
export function rootNavigateMeScreen(screen: string, screenParams?: Record<string, unknown>) {
  return rootNavigateNested('我的', screen, screenParams);
}

/** Today Tab → CampusSocialScreen */
export function rootNavigateCampusCommunity() {
  return rootNavigateNested('Today', 'CampusSocialScreen');
}
