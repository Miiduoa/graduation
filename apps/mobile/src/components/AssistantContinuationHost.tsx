import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  dismissAssistantContinuation, getAssistantContinuation, subscribeAssistantContinuation,
  type AssistantContinuation,
} from '../services/assistantContinuation';
import { theme } from '../ui/theme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';

type NavigationRef = {
  isReady: () => boolean;
  getRootState: () => { key: string };
  getCurrentRoute: () => { key: string } | undefined;
  addListener: (event: 'state', listener: () => void) => () => void;
};

/** One optional return action above the existing navigation, never a second chat. */
export function AssistantContinuationHost({ navigationRef, hasTabBar = false }: {
  navigationRef: NavigationRef;
  hasTabBar?: boolean;
}) {
  useThemeVersion();
  const insets = useSafeAreaInsets();
  const tabPadding = useTabBarContentBottomPadding();
  const [, updateNavigation] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const ticket = useSyncExternalStore(subscribeAssistantContinuation, getAssistantContinuation, getAssistantContinuation);
  const observedAway = useRef<AssistantContinuation | null>(null);
  useEffect(() => {
    const observeReturn = () => {
      const current = getAssistantContinuation();
      if (observedAway.current !== current) observedAway.current = null;
      if (!current || !navigationRef.isReady() ||
          navigationRef.getRootState().key !== current.rootKey) return;
      const activeKey = navigationRef.getCurrentRoute()?.key;
      if (!activeKey) return;
      if (activeKey !== current.sourceRouteKey) {
        observedAway.current = current;
      } else if (observedAway.current === current) {
        // A manual back/tab return completes the handoff just like the return button.
        observedAway.current = null;
        dismissAssistantContinuation(current);
      }
    };
    const unsubscribeState = navigationRef.addListener('state', () => {
      observeReturn();
      updateNavigation((value) => value + 1);
    });
    const unsubscribeTicket = subscribeAssistantContinuation(observeReturn);
    observeReturn();
    return () => { unsubscribeState(); unsubscribeTicket(); };
  }, [navigationRef]);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (!ticket || keyboardOpen || !ticket.isCurrent() || !navigationRef.isReady() ||
      navigationRef.getRootState().key !== ticket.rootKey ||
      navigationRef.getCurrentRoute()?.key === ticket.sourceRouteKey) return null;
  return (
    <View style={{ position: 'absolute', right: 16, bottom: hasTabBar ? tabPadding + 8 : insets.bottom + 12,
      flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface,
      borderRadius: 24, borderWidth: 1, borderColor: theme.colors.border,
      shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="接著問 nuni"
        onPress={() => ticket.resume()} style={{ minHeight: 48, justifyContent: 'center', paddingLeft: 18, paddingRight: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.accent }}>接著問 nuni</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="收起接續入口"
        onPress={() => dismissAssistantContinuation(ticket)}
        style={{ minWidth: 44, minHeight: 48, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 20, color: theme.colors.muted }}>×</Text>
      </Pressable>
    </View>
  );
}
