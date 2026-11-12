import { httpsCallable } from 'firebase/functions';
import { getAuthInstance, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { deriveDmConversationId } from '../utils/conversationAccess';
import { isDemoUid } from './demoSession';

type StoryReplyInput = {
  viewerUid: string;
  schoolId: string;
  storyId: string;
  authorUid: string;
  replyId: string;
  content: string;
};

type StoryReplyReceipt = { conversationId: string; messageId: string };

export async function sendStoryReply(input: StoryReplyInput) {
  const hasSession = () =>
    !isFirebaseMockMode() &&
    !isDemoUid(input.viewerUid) &&
    getAuthInstance().currentUser?.uid === input.viewerUid;
  if (!hasSession()) throw new Error('Story reply session changed');
  const send = httpsCallable<StoryReplyInput, StoryReplyReceipt>(
    getFunctionsInstance(),
    'replyToCampusStory',
  );
  const { data } = await send(input);
  if (
    !hasSession() ||
    data?.conversationId !==
      deriveDmConversationId(input.schoolId, input.viewerUid, input.authorUid) ||
    typeof data.messageId !== 'string' ||
    !data.messageId.trim()
  ) {
    throw new Error('Unconfirmed story reply');
  }
  return data.conversationId;
}
