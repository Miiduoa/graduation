import AsyncStorage from '@react-native-async-storage/async-storage';

import { getReleaseConfig } from './release';

import type { UserRole } from '../state/auth';

export type MockAuthSession = {
  uid: string;
  email: string;
  schoolId: string;
  displayName: string;
  role: UserRole;
  department?: string | null;
  studentId?: string | null;
  /** 使用者原始輸入的登入帳號（可能與學號不同，如 B11234567 vs 411211325） */
  loginAccount?: string | null;
};

const STORAGE_KEY = 'campus.mockAuthSession.v1';

export async function loadMockAuthSession(): Promise<MockAuthSession | null> {
  if (getReleaseConfig().appEnv === 'production') return null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<MockAuthSession>;
    if (!parsed.uid || !parsed.email || !parsed.schoolId || !parsed.displayName || !parsed.role) {
      return null;
    }

    return {
      uid: parsed.uid,
      email: parsed.email,
      schoolId: parsed.schoolId,
      displayName: parsed.displayName,
      role: parsed.role,
      department: parsed.department ?? null,
      studentId: parsed.studentId ?? null,
      loginAccount: parsed.loginAccount ?? null,
    };
  } catch {
    return null;
  }
}

export async function saveMockAuthSession(session: MockAuthSession): Promise<void> {
  if (getReleaseConfig().appEnv === 'production') throw new Error('正式環境不支援測試帳號');
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export async function clearMockAuthSession(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
