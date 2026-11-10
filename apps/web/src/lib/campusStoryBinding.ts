import { getAuth } from '@/features/auth/client';
import { getCloudFunctionUrl } from '@/lib/cloudFunctions';

// Called after Firebase Auth is present. Production Google (nuni sessionHandle)
// never reaches this callable because it has no Firebase user.
export async function ensureCampusStoryBinding(): Promise<void> {
  try {
    const user = getAuth()?.currentUser;
    if (!user || typeof user.getIdToken !== 'function') return;
    const token = await user.getIdToken();
    if (getAuth()?.currentUser !== user) return;
    await fetch(getCloudFunctionUrl('ensureCampusStoryBinding'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: {} }),
      cache: 'no-store',
    });
  } catch {
    // Storage stays fail-closed until a later restamp.
  }
}
