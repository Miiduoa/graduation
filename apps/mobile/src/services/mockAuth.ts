import AsyncStorage from "@react-native-async-storage/async-storage";

import type { UserRole } from "../state/auth";

export type MockAuthSession = {
  uid: string;
  email: string;
  schoolId: string;
  displayName: string;
  role: UserRole;
  department?: string | null;
  studentId?: string | null;
};

const STORAGE_KEY = "campus.mockAuthSession.v1";

export async function loadMockAuthSession(): Promise<MockAuthSession | null> {
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
    };
  } catch {
    return null;
  }
}

export async function saveMockAuthSession(session: MockAuthSession): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export async function clearMockAuthSession(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
