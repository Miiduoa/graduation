import { httpsCallable } from 'firebase/functions';

import { getFunctionsInstance, hasUsableFirebaseConfig, isFirebaseMockMode } from '../firebase';

export async function ensureCampusStoryBinding(): Promise<void> {
  try {
    if (!hasUsableFirebaseConfig() || isFirebaseMockMode()) return;
    const callable = httpsCallable(getFunctionsInstance(), 'ensureCampusStoryBinding');
    await callable({});
  } catch {
    // Storage stays fail-closed until a later restamp.
  }
}
