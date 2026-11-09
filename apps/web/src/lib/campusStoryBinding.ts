import { httpsCallable } from 'firebase/functions';

import { getFunctionsInstance } from '@/lib/firebase';

export async function ensureCampusStoryBinding(): Promise<void> {
  try {
    const callable = httpsCallable(getFunctionsInstance(), 'ensureCampusStoryBinding');
    await callable({});
  } catch {
    // Storage stays fail-closed until a later restamp.
  }
}
