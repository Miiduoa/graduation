import { doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  ASSISTANT_PERMISSIONS_DOC_ID,
  createDefaultAssistantWritePermissions,
  normalizeAssistantWritePermissions,
  serializeAssistantWritePermissions,
  type AssistantWritePermissions,
} from '@campus/shared/src/assistantPermissions';
import { getDb } from '../firebase';

export type AssistantPermissionState = {
  permissions: AssistantWritePermissions;
  source: 'server' | 'unavailable';
};

export async function loadAssistantWritePermissionsState(
  uid: string,
): Promise<AssistantPermissionState> {
  try {
    const snap = await getDocFromServer(
      doc(getDb(), 'users', uid, 'settings', ASSISTANT_PERMISSIONS_DOC_ID),
    );
    return {
      permissions: normalizeAssistantWritePermissions(snap.exists() ? snap.data() : null),
      source: 'server',
    };
  } catch {
    return {
      permissions: createDefaultAssistantWritePermissions(),
      source: 'unavailable',
    };
  }
}

export async function saveAssistantWritePermissions(
  uid: string,
  permissions: AssistantWritePermissions,
): Promise<void> {
  const normalized = serializeAssistantWritePermissions(permissions);
  const ref = doc(getDb(), 'users', uid, 'settings', ASSISTANT_PERMISSIONS_DOC_ID);
  await setDoc(
    ref,
    {
      ...normalized,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
