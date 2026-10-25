import { httpsCallable } from 'firebase/functions';
import {
  normalizeCampusSemanticResult,
  type CampusSemanticResult,
} from '@campus/shared/src/campusSemantic';
import { areFunctionsConfigured } from './functionsUrl';
import { getAuth, getFunctionsInstance, isFirebaseConfigured } from './firebase';

export async function interpretCampusRequest(input: {
  uid: string;
  schoolId: string;
  utterance: string;
}): Promise<CampusSemanticResult> {
  if (!input.uid || !isFirebaseConfigured() || !areFunctionsConfigured()) {
    throw new Error('semantic-unavailable');
  }
  if (getAuth()?.currentUser?.uid !== input.uid) throw new Error('semantic-session-changed');
  const callable = httpsCallable<
    { schoolId: string; utterance: string },
    unknown
  >(getFunctionsInstance(), 'understandCampusRequest');
  const answer = await callable({
    schoolId: input.schoolId,
    utterance: input.utterance.trim().slice(0, 400),
  });
  if (getAuth()?.currentUser?.uid !== input.uid) throw new Error('semantic-session-changed');
  const result = normalizeCampusSemanticResult(answer.data);
  if (!result) throw new Error('semantic-invalid-response');
  return result;
}
