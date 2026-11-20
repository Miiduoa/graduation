import { collection, getDocsFromServer } from 'firebase/firestore';
import { getDb } from '../firebase';
import { privateAttachmentPaths } from '@campus/shared/src/privateFileMedia';

export async function listGroupSubmissionFiles(groupId: string, assignmentId: string) {
  const snap = await getDocsFromServer(
    collection(getDb(), 'groups', groupId, 'assignments', assignmentId, 'submissions'),
  );
  return snap.docs.map((entry) => ({
    uid: entry.id,
    paths: privateAttachmentPaths(entry.data().attachments),
  }));
}
