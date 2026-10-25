import { httpsCallable } from 'firebase/functions';
import {
  normalizeCampusSemanticResult,
  type CampusSemanticResult,
} from '@campus/shared/src/campusSemantic';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';

export async function interpretMobileCampusRequest(input: {
  uid: string;
  schoolId: string;
  utterance: string;
  isCurrent: () => boolean;
}): Promise<CampusSemanticResult> {
  const assertCurrent = () => {
    if (!input.uid || isFirebaseMockMode() ||
        !input.isCurrent() ||
        getAuthInstance().currentUser?.uid !== input.uid) {
      throw new Error('semantic-session-changed');
    }
  };
  assertCurrent();
  const callable = httpsCallable<
    { schoolId: string; utterance: string },
    unknown
  >(getFunctionsInstance(), 'understandCampusRequest');
  const answer = await callable({
    schoolId: input.schoolId,
    utterance: input.utterance.trim().slice(0, 400),
  });
  assertCurrent();
  const normalized = normalizeCampusSemanticResult(answer.data);
  if (!normalized) throw new Error('semantic-invalid-response');
  return normalized;
}
