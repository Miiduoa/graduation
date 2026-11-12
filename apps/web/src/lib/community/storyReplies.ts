import { callWithHostedFallback } from '@/lib/callableFallback';
import { deriveDmConversationId } from '@/lib/conversationAccess';
import { getAuth, isFirebaseConfigured } from '@/lib/firebase';

type StoryReplyInput = {
  schoolId: string;
  storyId: string;
  authorUid: string;
  replyId: string;
  content: string;
};

export async function sendStoryReply(viewerUid: string, input: StoryReplyInput): Promise<string> {
  if (!isFirebaseConfigured() || !viewerUid || getAuth()?.currentUser?.uid !== viewerUid) {
    throw new Error('reply-session');
  }
  const { data } = await callWithHostedFallback<
    StoryReplyInput & { viewerUid: string },
    { conversationId: string; messageId: string }
  >('replyToCampusStory', { ...input, viewerUid }, viewerUid);
  if (getAuth()?.currentUser?.uid !== viewerUid) throw new Error('reply-session');
  if (
    typeof data?.messageId !== 'string' ||
    !data.messageId ||
    data.conversationId !== deriveDmConversationId(input.schoolId, viewerUid, input.authorUid)
  ) {
    throw new Error('reply-unconfirmed');
  }
  return data.conversationId;
}
