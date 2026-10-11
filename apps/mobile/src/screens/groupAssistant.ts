/** 群組提問時，校園助理留下的回覆用這組作者資料，不掛在發問的學生名下。 */
export const ASSISTANT_AUTHOR_ID = 'campus-assistant';
export const ASSISTANT_AUTHOR_NAME = '助理回覆';
/** 伺服器寫入的助理回覆固定放在 comments/assistant。 */
export const ASSISTANT_COMMENT_ID = 'assistant';
export const ASSISTANT_PENDING_COPY = '助理回覆中';
export const ASSISTANT_UNAVAILABLE_COPY = '助理暫時沒辦法回答，可以等其他同學回覆';

type CommentLike = {
  id?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  isAI?: boolean | null;
  generatedBy?: string | null;
};

/** 只有伺服器寫在 comments/assistant 的那一則才算助理回覆。 */
export function isAssistantComment(comment: CommentLike): boolean {
  return (
    comment.id === ASSISTANT_COMMENT_ID &&
    comment.authorId === ASSISTANT_AUTHOR_ID &&
    comment.generatedBy === 'server'
  );
}

/** 自稱是助理、但不是伺服器寫的（例如舊版 App 自己寫的那則），不顯示。 */
export function isFakeAssistantComment(comment: CommentLike): boolean {
  if (isAssistantComment(comment)) return false;
  return (
    comment.isAI === true ||
    comment.authorId === ASSISTANT_AUTHOR_ID ||
    comment.authorId === 'ai-assistant' ||
    comment.authorName === ASSISTANT_AUTHOR_NAME
  );
}

export function visibleComments<T extends CommentLike>(comments: T[]): T[] {
  return comments.filter((comment) => !isFakeAssistantComment(comment));
}
