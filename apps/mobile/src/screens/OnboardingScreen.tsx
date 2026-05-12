/* eslint-disable */
/**
 * OnboardingScreen — DEPRECATED STUB
 * 此頁面已從導航中移除，但 App.tsx 仍引用 hasSeenOnboarding。
 * 保留最小相容介面。
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_KEY = '@onboarding_seen';

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === 'true';
  } catch {
    return true; // 預設跳過
  }
}

export function OnboardingScreen({ onComplete }: { onComplete?: () => void }) {
  useEffect(() => {
    // 自動完成 onboarding
    AsyncStorage.setItem(ONBOARDING_KEY, 'true').catch(() => {});
    onComplete?.();
  }, [onComplete]);

  return <View style={{ flex: 1 }} />;
}

export default OnboardingScreen;
