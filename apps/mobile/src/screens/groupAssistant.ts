/** 群組提問時，校園助理留下的回覆用這組作者資料，不掛在發問的學生名下。 */
export const ASSISTANT_AUTHOR_ID = 'campus-assistant';
export const ASSISTANT_AUTHOR_NAME = '助理回覆';

export function isAssistantComment(comment: { authorId?: string | null; isAI?: boolean | null }): boolean {
  return comment.isAI === true || comment.authorId === ASSISTANT_AUTHOR_ID;
}
