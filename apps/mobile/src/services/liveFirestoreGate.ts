import { getDataSourceEvidence } from '../data/source';
import { hasUsableFirebaseConfig, isFirebaseMockMode } from '../firebase';

export function isDemoUid(uid?: string | null): boolean {
  return typeof uid === 'string' && uid.startsWith('demo_');
}

export function shouldUseLiveFirestoreListeners(input: { uid?: string | null } = {}): boolean {
  if (!hasUsableFirebaseConfig() || isFirebaseMockMode()) return false;

  const evidence = getDataSourceEvidence();
  if (evidence?.mode === 'mock' || evidence?.sourceLabel === 'mock') return false;
  if (isDemoUid(input.uid)) return false;

  return true;
}
