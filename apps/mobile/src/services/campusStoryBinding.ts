import { httpsCallable } from 'firebase/functions';

import { getFunctionsInstance, hasUsableFirebaseConfig, isFirebaseMockMode } from '../firebase';

// Called after Firebase Auth profile load. Production Google (nuni sessionHandle)
// never reaches this callable because it has no Firebase user.
export async function ensureCampusStoryBinding(): Promise<void> {
  try {
    if (!hasUsableFirebaseConfig() || isFirebaseMockMode()) return;
    const callable = httpsCallable(getFunctionsInstance(), 'ensureCampusStoryBinding');
    await callable({});
  } catch {
    // Storage stays fail-closed until a later restamp.
  }
}
