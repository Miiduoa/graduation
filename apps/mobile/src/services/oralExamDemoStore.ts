import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ORAL_EXAM_PLAY_DEFAULT,
  ORAL_EXAM_STORAGE_KEY,
  emptyOralExamPlayState,
  type OralExamPlayState,
} from '@campus/shared/src/oralExamDemo';

export async function readOralExamPlayState(): Promise<OralExamPlayState> {
  try {
    const raw = await AsyncStorage.getItem(ORAL_EXAM_STORAGE_KEY);
    if (!raw) return emptyOralExamPlayState();
    return { ...ORAL_EXAM_PLAY_DEFAULT, ...(JSON.parse(raw) as Partial<OralExamPlayState>) };
  } catch {
    return emptyOralExamPlayState();
  }
}

export async function writeOralExamPlayState(next: OralExamPlayState): Promise<void> {
  await AsyncStorage.setItem(ORAL_EXAM_STORAGE_KEY, JSON.stringify(next));
}
