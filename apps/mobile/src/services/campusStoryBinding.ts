import { getAuthInstance, hasUsableFirebaseConfig, isFirebaseMockMode } from '../firebase';

const HOSTED_BINDING_URL = 'https://nuni.tw/api/fn/ensureCampusStoryBinding';

// Called after Firebase Auth profile load. Production Google (nuni sessionHandle)
// never reaches this callable because it has no Firebase user.
export async function ensureCampusStoryBinding(): Promise<void> {
  try {
    if (!hasUsableFirebaseConfig() || isFirebaseMockMode()) return;
    const user = getAuthInstance().currentUser;
    if (!user || typeof user.getIdToken !== 'function') return;
    const token = await user.getIdToken();
    await fetch(HOSTED_BINDING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: {} }),
    });
  } catch {
    // Storage stays fail-closed until a later restamp.
  }
}
