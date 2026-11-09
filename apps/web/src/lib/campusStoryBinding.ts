import { httpsCallable } from 'firebase/functions';

import { getFunctionsInstance } from '@/lib/firebase';

// Called after Firebase Auth is present. Production Google (nuni sessionHandle)
// never reaches this callable because it has no Firebase user.
export async function ensureCampusStoryBinding(): Promise<void> {
  try {
    const callable = httpsCallable(getFunctionsInstance(), 'ensureCampusStoryBinding');
    await callable({});
  } catch {
    // Storage stays fail-closed until a later restamp.
  }
}
