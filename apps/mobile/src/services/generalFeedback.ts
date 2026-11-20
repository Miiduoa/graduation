import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';

export type GeneralFeedbackInput = {
  requestId: string;
  schoolId: string;
  kind: 'general';
  feedbackType: 'bug' | 'feature' | 'improvement' | 'other';
  title: string;
  description: string;
  rating: number;
  contactEmail: string | null;
};
export type GeneralFeedbackReceipt = { ok: true; feedbackId: string; reused: boolean };

export async function submitGeneralFeedback(
  input: GeneralFeedbackInput,
  expectedUid: string,
  isCurrent: () => boolean,
): Promise<GeneralFeedbackReceipt> {
  const assertCurrent = () => {
    if (
      !isCurrent() ||
      isFirebaseMockMode() ||
      getAuthInstance().currentUser?.uid !== expectedUid
    ) {
      throw new Error('Feedback account changed');
    }
  };
  assertCurrent();
  const submit = httpsCallable<GeneralFeedbackInput, GeneralFeedbackReceipt>(
    getFunctionsInstance(),
    'submitProductFeedback',
  );
  const response = await submit(input);
  assertCurrent();
  if (
    response.data?.ok !== true ||
    typeof response.data.feedbackId !== 'string' ||
    !response.data.feedbackId.trim()
  ) {
    throw new Error('Feedback receipt not confirmed');
  }
  return response.data;
}
